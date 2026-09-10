-- Explicit, user-confirmed equivalence between multiple representations (manual/CSV, Stripe,
-- Plaid, ...) of ONE real-world financial account. Never automatically merges accounts by name,
-- balance, or institution -- a group is created only by an explicit human action (via the
-- SECURITY DEFINER RPCs below), never inferred.
--
-- A group-of-members model, not a pairwise link table: supports three or more representations of
-- one account (manual + Stripe + Plaid, all at once) from the start, rather than needing a
-- second migration later to generalize a 2-column pair table. "One active membership per
-- account" is then a single partial unique index on the member table's own financial_account_id
-- column -- no self-referencing exclusivity trigger needed, since membership (not a two-column
-- pair) is the row, and revoked_at lives exactly once, on that row.
--
-- financial_account_groups: the canonical real-world account -- authority (which member's
-- balance is currently trusted) and transaction-coverage state (whether/when provider history
-- has been verified complete enough to take over from manual/CSV transaction history).
--
-- financial_account_group_members: one row per representation. Each account may belong to at
-- most one ACTIVE group at a time (enforced below); a revoked membership does not block
-- rejoining a group later.
create table if not exists financial_account_groups (
    id text primary key,
    owner_id text not null,
    relationship text not null default 'same_real_account'
        check (relationship in ('same_real_account')),

    -- Which member's balance is CURRENTLY trusted -- a pointer, not a "stripe wins" flag, so
    -- Stripe and Plaid have equal standing; recomputed by application logic per the health/
    -- freshness rules in FinancialPositionQueryService, written back through
    -- set_financial_account_group_balance_authority. Enforced (by trigger, below) to always be
    -- an ACTIVE member of this same group.
    balance_authority_account_id text references financial_accounts(id) on delete restrict,

    -- Transaction authority is a SEPARATE pointer from balance authority -- balance can move to
    -- a live connection immediately, but which member's transaction history is authoritative
    -- going forward is a distinct decision, made only by an explicit human call to
    -- set_financial_account_group_transaction_authority once provider coverage has actually been
    -- verified (see transaction_coverage_status below). Never defaults to and never derived from
    -- balance_authority_account_id -- a 3-member group can easily have Plaid as balance
    -- authority and Stripe as transaction authority. Left null until that explicit call;
    -- set_financial_account_group_transaction_cutover refuses to record a cutover date until
    -- this is set (enforced there, not by a table constraint, since that RPC is this column's
    -- only meaningful consumer). Enforced (by trigger, below) to always be an ACTIVE member of
    -- this same group, exactly like balance_authority_account_id.
    transaction_authority_account_id text references financial_accounts(id) on delete restrict,

    -- Transaction COVERAGE is the state machine that decides WHETHER provider history has been
    -- verified complete enough to trust at all; transaction_authority_account_id (above) is WHICH
    -- member that trust applies to once coverage says so. Never inferred from webhook processing
    -- order or a non-null cursor -- see advance_financial_account_group_coverage_status's
    -- forward-only transition guard.
    transaction_coverage_status text not null default 'not_started'
        check (transaction_coverage_status in
            ('not_started', 'importing', 'pending_reconciliation', 'reconciled', 'stale_retry_detected')),
    transaction_coverage_verified_by_user_id text,
    transaction_coverage_verified_at timestamptz,
    -- Calendar date, UTC-defined (see transaction_cutover_timezone) -- half-open interval
    -- semantics applied at read time: linked/manual events are authoritative for
    -- event_date < transaction_cutover_at, canonical/provider events for event_date >=
    -- transaction_cutover_at. Only settable once transaction_coverage_status = 'reconciled'
    -- (enforced by set_financial_account_group_transaction_cutover, not by a table trigger,
    -- since the RPC is the only write path for this column and already re-checks status itself
    -- inside the same transaction as the UPDATE).
    transaction_cutover_at date,
    transaction_cutover_timezone text not null default 'UTC'
        check (transaction_cutover_timezone = 'UTC'),

    created_by_user_id text not null,
    created_at timestamptz not null default now(),
    -- Dissolves the WHOLE group (cascades to every active member via trigger, below). Never
    -- deleted -- no DELETE RLS policy exists on this table at all (see the RLS section).
    revoked_at timestamptz,
    revoked_by_user_id text,
    note text
);

create table if not exists financial_account_group_members (
    id text primary key,
    group_id text not null references financial_account_groups(id) on delete restrict,
    financial_account_id text not null references financial_accounts(id) on delete restrict,
    owner_id text not null,

    confirmed_by_user_id text not null,
    confirmed_at timestamptz not null default now(),
    -- Unlinks just THIS representation -- the group and its other members stay active. Never
    -- deleted, matching the parent table's own "never delete" invariant.
    revoked_at timestamptz,
    revoked_by_user_id text,

    unique (group_id, financial_account_id)
);

-- The core "one account, one active group" invariant -- a single partial unique index, made
-- possible precisely because membership is its own row (not a column on financial_accounts,
-- which would be a second, independently-writable source of truth for the same fact).
create unique index if not exists idx_financial_account_group_members_active_account
    on financial_account_group_members (financial_account_id)
    where revoked_at is null;

create index if not exists idx_financial_account_group_members_group
    on financial_account_group_members (group_id);

-- Owner consistency: a member's owner_id must match both its group's and its account's real
-- owner_id. Cannot be a plain CHECK (needs to read two other tables).
create or replace function enforce_financial_account_group_member_owner()
returns trigger as $$
declare
  v_group_owner text;
  v_account_owner text;
begin
  select owner_id into v_group_owner from financial_account_groups where id = new.group_id;
  select owner_id into v_account_owner from financial_accounts where id = new.financial_account_id;
  if v_group_owner is null then
    raise exception 'financial_account_groups % does not exist.', new.group_id;
  end if;
  if v_account_owner is null then
    raise exception 'financial_account_id % does not exist.', new.financial_account_id;
  end if;
  if new.owner_id <> v_group_owner or new.owner_id <> v_account_owner then
    raise exception 'A financial_account_group_member must share owner_id with its group and its financial account.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_financial_account_group_member_owner on financial_account_group_members;
create trigger trg_enforce_financial_account_group_member_owner
before insert or update on financial_account_group_members
for each row execute function enforce_financial_account_group_member_owner();

-- balance_authority_account_id and transaction_authority_account_id must EACH always be an
-- active member of THIS group -- never an arbitrary account id, never a revoked membership.
-- Checked independently: a group can (and often will) have different accounts for each.
create or replace function enforce_financial_account_group_authority_is_active()
returns trigger as $$
begin
  if new.balance_authority_account_id is not null and not exists (
    select 1 from financial_account_group_members
    where group_id = new.id
      and financial_account_id = new.balance_authority_account_id
      and revoked_at is null
  ) then
    raise exception 'balance_authority_account_id must be an active member of this group.';
  end if;

  if new.transaction_authority_account_id is not null and not exists (
    select 1 from financial_account_group_members
    where group_id = new.id
      and financial_account_id = new.transaction_authority_account_id
      and revoked_at is null
  ) then
    raise exception 'transaction_authority_account_id must be an active member of this group.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_financial_account_group_balance_authority on financial_account_groups;
create trigger trg_enforce_financial_account_group_balance_authority
before insert or update on financial_account_groups
for each row execute function enforce_financial_account_group_authority_is_active();

-- Immutability of confirmation/audit fields -- the actual mechanism behind "never delete, never
-- rewrite history." Only revoked_at/revoked_by_user_id/note/balance_authority_account_id/
-- transaction_coverage_*/transaction_cutover_at may ever change after insert.
create or replace function enforce_financial_account_group_immutability()
returns trigger as $$
begin
  if new.owner_id <> old.owner_id
     or new.relationship <> old.relationship
     or new.created_by_user_id <> old.created_by_user_id
     or new.created_at <> old.created_at
  then
    raise exception 'financial_account_groups audit fields are immutable.';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked financial_account_group cannot be un-revoked or re-revoked.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_financial_account_group_immutability on financial_account_groups;
create trigger trg_enforce_financial_account_group_immutability
before update on financial_account_groups
for each row execute function enforce_financial_account_group_immutability();

create or replace function enforce_financial_account_group_member_immutability()
returns trigger as $$
begin
  if new.group_id <> old.group_id
     or new.financial_account_id <> old.financial_account_id
     or new.owner_id <> old.owner_id
     or new.confirmed_by_user_id <> old.confirmed_by_user_id
     or new.confirmed_at <> old.confirmed_at
  then
    raise exception 'financial_account_group_members confirmation fields are immutable.';
  end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then
    raise exception 'A revoked financial_account_group_member cannot be un-revoked or re-revoked.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_financial_account_group_member_immutability on financial_account_group_members;
create trigger trg_enforce_financial_account_group_member_immutability
before update on financial_account_group_members
for each row execute function enforce_financial_account_group_member_immutability();

-- Never leave balance_authority_account_id/transaction_authority_account_id pointing at a
-- revoked member. revoke_financial_account_group_member (a standalone "unlink just this
-- representation" action) is rejected outright while the target is either authority pointer for
-- its own (still-active) group -- the caller must reassign authority first, via
-- set_financial_account_group_balance_authority/set_financial_account_group_transaction_authority.
-- This is deliberately NOT checked by enforce_financial_account_group_authority_is_active, which
-- only fires on writes to financial_account_groups itself -- a member-only revoke never touches
-- that table's row, so without this trigger the pointer would silently go stale.
-- A whole-group revoke (revoke_financial_account_group) is exempt: it cascades to every member
-- in the same transaction, and by the time that cascade's own member UPDATE runs, this same
-- group's own revoked_at is already committed -- the check below sees that and steps aside, since
-- "the whole group, authority included, is being dissolved together" is exactly the sanctioned
-- path, not a dangling pointer.
create or replace function enforce_financial_account_group_member_not_authority_on_revoke()
returns trigger as $$
declare
  v_group financial_account_groups;
begin
  if old.revoked_at is not null or new.revoked_at is null then
    return new;
  end if;

  select * into v_group from financial_account_groups where id = new.group_id;

  if v_group.revoked_at is not null then
    return new;
  end if;

  if v_group.balance_authority_account_id = new.financial_account_id then
    raise exception 'Cannot revoke the active balance authority member; reassign balance authority first.';
  end if;

  if v_group.transaction_authority_account_id = new.financial_account_id then
    raise exception 'Cannot revoke the active transaction authority member; reassign transaction authority first.';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_block_authority_member_revoke on financial_account_group_members;
create trigger trg_block_authority_member_revoke
before update on financial_account_group_members
for each row execute function enforce_financial_account_group_member_not_authority_on_revoke();

-- Group revocation cascades to every currently-active member IN THE SAME TRANSACTION, via
-- trigger -- this is the mechanism, not a second independently-writable fact: a client only
-- ever sets the GROUP's own revoked_at (through revoke_financial_account_group); members' own
-- revoked_at in that scenario is always a trigger-driven side effect of that one write, never a
-- separate client action for this case (revoke_financial_account_group_member is the distinct,
-- narrower action for unlinking just one representation).
create or replace function cascade_financial_account_group_revocation()
returns trigger as $$
begin
  if new.revoked_at is not null and old.revoked_at is null then
    update financial_account_group_members
    set revoked_at = new.revoked_at, revoked_by_user_id = new.revoked_by_user_id
    where group_id = new.id and revoked_at is null;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_cascade_financial_account_group_revocation on financial_account_groups;
create trigger trg_cascade_financial_account_group_revocation
after update on financial_account_groups
for each row execute function cascade_financial_account_group_revocation();

-- RLS: SELECT-only for authenticated (has_workspace_access, the same predicate every other
-- workspace-scoped table in this schema already uses) -- no INSERT/UPDATE/DELETE policy exists
-- for that role at all. Every mutation goes through a SECURITY DEFINER RPC below. Table
-- privileges are also explicitly revoked from authenticated, belt-and-suspenders: even a future
-- RLS misconfiguration cannot reopen a direct write path.
alter table financial_account_groups enable row level security;
alter table financial_account_groups force row level security;
alter table financial_account_group_members enable row level security;
alter table financial_account_group_members force row level security;

drop policy if exists financial_account_groups_owner_select on financial_account_groups;
create policy financial_account_groups_owner_select on financial_account_groups
    for select using (has_workspace_access(owner_id));

drop policy if exists financial_account_group_members_owner_select on financial_account_group_members;
create policy financial_account_group_members_owner_select on financial_account_group_members
    for select using (has_workspace_access(owner_id));

revoke insert, update, delete on financial_account_groups from authenticated;
revoke insert, update, delete on financial_account_group_members from authenticated;

-- --- SECURITY DEFINER RPCs -- every mutation's ONLY path. ---
--
-- SECURITY INVOKER cannot do this: it runs with the CALLING role's privileges, and Postgres RLS
-- (plus the revoked table grants above) blocks that role identically to a raw client .update()
-- call. Only SECURITY DEFINER (running as the function owner, which does have table privileges)
-- can perform the write while the calling role itself has none -- with search_path pinned to
-- prevent the classic search-path-hijack privilege-escalation hole, and an internal
-- has_workspace_access() check replacing what RLS would otherwise do (since RLS's SELECT policy
-- does not gate what a SECURITY DEFINER function itself can see/write).
--
-- owner_id/actor_user_id are NEVER accepted as parameters -- every function derives them
-- internally via resolve_effective_owner_id()/auth.uid(), which remain correctly populated
-- inside a SECURITY DEFINER function (they read a session-level GUC, unaffected by the
-- privilege-elevating role switch).

create or replace function create_financial_account_group(
    p_canonical_financial_account_id text,
    p_note text default null
) returns financial_account_groups
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_account_owner text;
  v_group_id text;
  v_result financial_account_groups;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id into v_account_owner from financial_accounts where id = p_canonical_financial_account_id;
  if v_account_owner is null then
    raise exception 'Financial account not found.';
  end if;
  if not has_workspace_access(v_account_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;
  if exists (select 1 from financial_account_group_members where financial_account_id = p_canonical_financial_account_id and revoked_at is null) then
    raise exception 'This account already belongs to an active group.';
  end if;

  v_group_id := 'financial_account_group_' || gen_random_uuid()::text;

  insert into financial_account_groups (id, owner_id, created_by_user_id, note)
  values (v_group_id, v_account_owner, v_actor_id, p_note);

  insert into financial_account_group_members (id, group_id, financial_account_id, owner_id, confirmed_by_user_id)
  values ('financial_account_group_member_' || gen_random_uuid()::text, v_group_id, p_canonical_financial_account_id, v_account_owner, v_actor_id);

  update financial_account_groups
  set balance_authority_account_id = p_canonical_financial_account_id
  where id = v_group_id
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function add_financial_account_group_member(
    p_group_id text,
    p_financial_account_id text
) returns financial_account_group_members
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_group_owner text;
  v_account_owner text;
  v_result financial_account_group_members;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id into v_group_owner from financial_account_groups where id = p_group_id and revoked_at is null;
  if v_group_owner is null then
    raise exception 'Group not found or revoked.';
  end if;
  if not has_workspace_access(v_group_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;

  select owner_id into v_account_owner from financial_accounts where id = p_financial_account_id;
  if v_account_owner is null then
    raise exception 'Financial account not found.';
  end if;
  if v_account_owner <> v_group_owner then
    raise exception 'Account must belong to the same workspace as the group.';
  end if;
  if exists (select 1 from financial_account_group_members where financial_account_id = p_financial_account_id and revoked_at is null) then
    raise exception 'This account already belongs to an active group.';
  end if;

  insert into financial_account_group_members (id, group_id, financial_account_id, owner_id, confirmed_by_user_id)
  values ('financial_account_group_member_' || gen_random_uuid()::text, p_group_id, p_financial_account_id, v_group_owner, v_actor_id)
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function revoke_financial_account_group_member(
    p_member_id text
) returns void
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_owner text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id into v_owner from financial_account_group_members where id = p_member_id;
  if v_owner is null then
    raise exception 'Member not found.';
  end if;
  if not has_workspace_access(v_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;

  update financial_account_group_members
  set revoked_at = now(), revoked_by_user_id = v_actor_id
  where id = p_member_id and revoked_at is null;
end;
$$;

create or replace function revoke_financial_account_group(
    p_group_id text
) returns void
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_owner text;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id into v_owner from financial_account_groups where id = p_group_id;
  if v_owner is null then
    raise exception 'Group not found.';
  end if;
  if not has_workspace_access(v_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;

  update financial_account_groups
  set revoked_at = now(), revoked_by_user_id = v_actor_id
  where id = p_group_id and revoked_at is null;
end;
$$;

create or replace function set_financial_account_group_balance_authority(
    p_group_id text,
    p_financial_account_id text
) returns financial_account_groups
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_owner text;
  v_result financial_account_groups;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id into v_owner from financial_account_groups where id = p_group_id and revoked_at is null;
  if v_owner is null then
    raise exception 'Group not found or revoked.';
  end if;
  if not has_workspace_access(v_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;

  -- The enforce_financial_account_group_balance_authority trigger rejects this update outright
  -- if p_financial_account_id is not an active member of this group -- no duplicate check needed
  -- here.
  update financial_account_groups
  set balance_authority_account_id = p_financial_account_id
  where id = p_group_id
  returning * into v_result;

  return v_result;
end;
$$;

create or replace function set_financial_account_group_transaction_authority(
    p_group_id text,
    p_financial_account_id text
) returns financial_account_groups
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_owner text;
  v_result financial_account_groups;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id into v_owner from financial_account_groups where id = p_group_id and revoked_at is null;
  if v_owner is null then
    raise exception 'Group not found or revoked.';
  end if;
  if not has_workspace_access(v_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;

  -- enforce_financial_account_group_authority_is_active rejects this update outright if
  -- p_financial_account_id is not an active member of this group -- no duplicate check needed
  -- here.
  update financial_account_groups
  set transaction_authority_account_id = p_financial_account_id
  where id = p_group_id
  returning * into v_result;

  return v_result;
end;
$$;

-- Forward-only state machine, matching the documented design exactly -- never a shortcut
-- straight to 'reconciled', never backward except the explicit 'stale_retry_detected' recovery
-- paths. Setting 'reconciled' is the ONLY transition that stamps
-- transaction_coverage_verified_by_user_id/_at -- the human-confirmation record required before
-- transaction_cutover_at can ever be set (see set_financial_account_group_transaction_cutover).
create or replace function advance_financial_account_group_coverage_status(
    p_group_id text,
    p_new_status text,
    p_note text default null
) returns financial_account_groups
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_owner text;
  v_current_status text;
  v_allowed boolean := false;
  v_result financial_account_groups;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id, transaction_coverage_status into v_owner, v_current_status
    from financial_account_groups where id = p_group_id and revoked_at is null;
  if v_owner is null then
    raise exception 'Group not found or revoked.';
  end if;
  if not has_workspace_access(v_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;

  if p_new_status not in ('not_started', 'importing', 'pending_reconciliation', 'reconciled', 'stale_retry_detected') then
    raise exception 'Invalid transaction_coverage_status: %', p_new_status;
  end if;

  v_allowed :=
       (v_current_status = 'not_started' and p_new_status in ('importing', 'stale_retry_detected'))
    or (v_current_status = 'importing' and p_new_status in ('pending_reconciliation', 'stale_retry_detected', 'not_started'))
    or (v_current_status = 'pending_reconciliation' and p_new_status in ('reconciled', 'stale_retry_detected'))
    or (v_current_status = 'stale_retry_detected' and p_new_status in ('not_started', 'importing'));

  if not v_allowed then
    raise exception 'Invalid transaction_coverage_status transition: % -> %', v_current_status, p_new_status;
  end if;

  update financial_account_groups
  set transaction_coverage_status = p_new_status,
      transaction_coverage_verified_by_user_id = case when p_new_status = 'reconciled' then v_actor_id else transaction_coverage_verified_by_user_id end,
      transaction_coverage_verified_at = case when p_new_status = 'reconciled' then now() else transaction_coverage_verified_at end,
      note = coalesce(p_note, note)
  where id = p_group_id
  returning * into v_result;

  return v_result;
end;
$$;

-- transaction_cutover_at may only ever be set while transaction_coverage_status = 'reconciled'
-- AND transaction_authority_account_id has been explicitly identified -- both re-checked here,
-- inside the same transaction as the write, rather than relying on a separate table trigger,
-- since this RPC is this column's only write path.
create or replace function set_financial_account_group_transaction_cutover(
    p_group_id text,
    p_cutover_date date
) returns financial_account_groups
security definer
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_actor_id text := auth.uid()::text;
  v_owner text;
  v_status text;
  v_transaction_authority_account_id text;
  v_result financial_account_groups;
begin
  if v_actor_id is null then
    raise exception 'Authentication required.';
  end if;

  select owner_id, transaction_coverage_status, transaction_authority_account_id
    into v_owner, v_status, v_transaction_authority_account_id
    from financial_account_groups where id = p_group_id and revoked_at is null;
  if v_owner is null then
    raise exception 'Group not found or revoked.';
  end if;
  if not has_workspace_access(v_owner) then
    raise exception 'Not authorized for this workspace.';
  end if;
  if v_status <> 'reconciled' then
    raise exception 'transaction_cutover_at may only be set once transaction_coverage_status is reconciled.';
  end if;
  if v_transaction_authority_account_id is null then
    raise exception 'transaction_cutover_at may only be set once a transaction authority member has been identified via set_financial_account_group_transaction_authority.';
  end if;

  update financial_account_groups
  set transaction_cutover_at = p_cutover_date
  where id = p_group_id
  returning * into v_result;

  return v_result;
end;
$$;

revoke all on function create_financial_account_group(text, text) from public;
revoke all on function add_financial_account_group_member(text, text) from public;
revoke all on function revoke_financial_account_group_member(text) from public;
revoke all on function revoke_financial_account_group(text) from public;
revoke all on function set_financial_account_group_balance_authority(text, text) from public;
revoke all on function set_financial_account_group_transaction_authority(text, text) from public;
revoke all on function advance_financial_account_group_coverage_status(text, text, text) from public;
revoke all on function set_financial_account_group_transaction_cutover(text, date) from public;

grant execute on function create_financial_account_group(text, text) to authenticated;
grant execute on function add_financial_account_group_member(text, text) to authenticated;
grant execute on function revoke_financial_account_group_member(text) to authenticated;
grant execute on function revoke_financial_account_group(text) to authenticated;
grant execute on function set_financial_account_group_balance_authority(text, text) to authenticated;
grant execute on function set_financial_account_group_transaction_authority(text, text) to authenticated;
grant execute on function advance_financial_account_group_coverage_status(text, text, text) to authenticated;
grant execute on function set_financial_account_group_transaction_cutover(text, date) to authenticated;
