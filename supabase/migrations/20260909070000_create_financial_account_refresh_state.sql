-- Durable, generic (provider-neutral, feature-neutral: 'balance' | 'transactions') refresh-work
-- state machine, replacing the vaulted, write-only-and-never-actually-read transaction cursor a
-- production audit found regressible by out-of-order Stripe webhook retries. See
-- src/domains/financial-account-refresh/* and the Stripe Financial Connections adapter's own
-- refresh coordinator for the full design; this migration is schema + atomicity-critical
-- functions only.
--
-- Two separate durable concepts -- never merged into one row with "claimed"/"confirmed" scalar
-- fields, which cannot express a real state machine or retain per-attempt history:
--
-- financial_account_refresh_watermarks: one row per (financial_account_id, feature) -- "what is
-- CURRENTLY confirmed as fully, successfully imported." Advanced by exactly one atomic,
-- monotonic compare-and-swap, only after the corresponding persistence has already succeeded.
--
-- financial_account_refresh_work_items: one row per (financial_account_id, feature, refresh_id)
-- attempt. Each Stripe refresh gets its own durable, auditable row with its own status/attempts/
-- lease, rather than being folded into a shared cursor row.
--
-- Ordering is deliberately NOT decided by comparing timestamps in these tables/functions at all.
-- The caller (the adapter's refresh coordinator) always performs a read-only
-- retrieveFinancialConnectionsAccount call first and passes in ONLY a refresh_id it has already
-- confirmed, live, IS Stripe's current refresh for this account+feature -- this is what correctly
-- resolves "different ids with identical second-level timestamps" (Stripe's own answer settles
-- it, not local arithmetic) and makes a bootstrapped watermark with no known timestamp perfectly
-- safe (there is no timestamp comparison left to be unsafe about). Stripe's opaque refresh id is
-- still never compared LEXICALLY anywhere -- it is only ever used as an equality/identity key.
create table if not exists financial_account_refresh_watermarks (
    financial_account_id text not null references financial_accounts(id),
    feature text not null check (feature in ('balance', 'transactions')),
    owner_id text not null,
    committed_refresh_id text,
    -- Stripe's own `last_attempted_at` (epoch seconds) for the committed refresh -- kept purely
    -- for audit/observability ("when did the currently-trusted data actually come from"), not
    -- read by any ordering decision (see header comment).
    committed_refresh_last_attempted_at bigint,
    committed_at timestamptz,
    primary key (financial_account_id, feature)
);

create table if not exists financial_account_refresh_work_items (
    id text primary key,
    financial_account_id text not null references financial_accounts(id),
    feature text not null check (feature in ('balance', 'transactions')),
    owner_id text not null,
    refresh_id text not null,
    refresh_last_attempted_at bigint not null,
    -- The Stripe webhook event id that produced this attempt -- nullable because a future
    -- non-webhook trigger could create a work item with none. Deliberately NOT a foreign key to
    -- connection_webhook_events: that table's per-EVENT idempotency and this table's per-REFRESH
    -- idempotency are independent (one refresh can be described by several redelivered events).
    triggering_event_id text,
    status text not null check (status in ('queued', 'claimed', 'importing', 'committed', 'superseded', 'failed')),
    attempts integer not null default 0,
    leased_at timestamptz,
    lease_expires_at timestamptz,
    -- Set only when status = 'superseded' -- the authoritative newer refresh id this attempt lost
    -- to, so a superseded event is always reported as an explicit no-op, never as if imported.
    superseded_by_refresh_id text,
    failure_message text,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (financial_account_id, feature, refresh_id)
);

-- The core per-account-per-feature serialization guarantee: only one work item may be actively
-- claimed/importing for a given (account, feature) at a time. A newer refresh arriving while an
-- older one is in flight cannot claim this slot -- its own work item is inserted as 'queued' and
-- stays that way (retryable on a later delivery) until the slot frees up; it is never falsely
-- marked processed just because it arrived while something else was running.
create unique index if not exists idx_refresh_work_items_active_slot
    on financial_account_refresh_work_items (financial_account_id, feature)
    where status in ('claimed', 'importing');

create index if not exists idx_refresh_work_items_account_feature
    on financial_account_refresh_work_items (financial_account_id, feature, created_at desc);

-- Owner consistency, enforced at the database layer (cannot be a plain CHECK -- needs to read
-- financial_accounts): a BEFORE INSERT/UPDATE trigger rejects any row whose owner_id doesn't
-- match its own financial_account_id's real owner. Shared by both tables.
create or replace function enforce_financial_account_refresh_owner()
returns trigger as $$
declare
  account_owner text;
begin
  select owner_id into account_owner from financial_accounts where id = new.financial_account_id;
  if account_owner is null then
    raise exception 'financial_account_id % does not exist.', new.financial_account_id;
  end if;
  if account_owner <> new.owner_id then
    raise exception 'owner_id must match the financial account''s own owner_id.';
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists trg_enforce_refresh_watermark_owner on financial_account_refresh_watermarks;
create trigger trg_enforce_refresh_watermark_owner
before insert or update on financial_account_refresh_watermarks
for each row execute function enforce_financial_account_refresh_owner();

drop trigger if exists trg_enforce_refresh_work_item_owner on financial_account_refresh_work_items;
create trigger trg_enforce_refresh_work_item_owner
before insert or update on financial_account_refresh_work_items
for each row execute function enforce_financial_account_refresh_owner();

-- Service-role-only access, RLS force-enabled with zero policies -- identical precedent to
-- connection_webhook_events (see its own migration): no authenticated user session exists on
-- this webhook-triggered path. Confirmed via information_schema.role_table_grants that
-- connection_webhook_events itself carries no custom grants at all, relying on Supabase's default
-- service_role RLS-bypass -- deliberately no explicit revoke/grant here either, for the same
-- reason: this is new schema, not a table whose default grants need tightening.
alter table financial_account_refresh_watermarks enable row level security;
alter table financial_account_refresh_watermarks force row level security;
alter table financial_account_refresh_work_items enable row level security;
alter table financial_account_refresh_work_items force row level security;

-- Atomic claim: called ONLY with a refresh_id the caller has already confirmed, via a live,
-- read-only Stripe retrieve, to be that account+feature's CURRENT refresh -- this function makes
-- no currency judgement of its own, it only enforces per-account-per-feature exclusivity and
-- crash-recoverable leasing. search_path pinned defensively (this function needs no elevated
-- privilege -- callers are always the service-role client, which bypasses RLS regardless -- but
-- fixing search_path costs nothing and matches this schema's general discipline).
create or replace function claim_financial_account_refresh_work(
    p_financial_account_id text,
    p_feature text,
    p_owner_id text,
    p_refresh_id text,
    p_refresh_last_attempted_at bigint,
    p_triggering_event_id text,
    p_lease_seconds integer default 300
) returns table (outcome text, work_item_id text)
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_work_item_id text;
  v_committed_refresh_id text;
  v_claimed_count int;
begin
  v_work_item_id := 'refresh_work_' || p_financial_account_id || '_' || p_feature || '_' || p_refresh_id;

  select committed_refresh_id into v_committed_refresh_id
    from financial_account_refresh_watermarks
    where financial_account_id = p_financial_account_id and feature = p_feature;

  -- Redelivery of the exact refresh that is already the confirmed, committed truth: a genuine
  -- no-op, distinct from 'superseded' (this IS the current data, nothing lost to it) and from
  -- 'claimed' (nothing left to import).
  if v_committed_refresh_id = p_refresh_id then
    return query select 'already_committed'::text, v_work_item_id;
    return;
  end if;

  insert into financial_account_refresh_work_items (
      id, financial_account_id, feature, owner_id, refresh_id, refresh_last_attempted_at,
      triggering_event_id, status
  ) values (
      v_work_item_id, p_financial_account_id, p_feature, p_owner_id, p_refresh_id, p_refresh_last_attempted_at,
      p_triggering_event_id, 'queued'
  )
  on conflict (financial_account_id, feature, refresh_id) do nothing;

  -- Release a DIFFERENT refresh's stale (lease-expired) hold on this account+feature's slot --
  -- a crashed attempt can never block a later, genuinely-current refresh forever.
  update financial_account_refresh_work_items
  set status = 'failed',
      failure_message = 'Lease expired -- presumed crashed attempt, released for reclaim.',
      updated_at = now()
  where financial_account_id = p_financial_account_id
    and feature = p_feature
    and id <> v_work_item_id
    and status in ('claimed', 'importing')
    and lease_expires_at < now();

  -- The actual claim. The partial unique index on (financial_account_id, feature) WHERE status
  -- IN ('claimed','importing') is the real, unbypassable backstop against a true concurrent race
  -- between two different refresh_ids for the same slot -- this WHERE clause is the readable
  -- expression of the same invariant, and the exception handler below catches the rare case
  -- where a genuinely concurrent request wins the index race between this statement's own
  -- evaluation and commit.
  begin
    update financial_account_refresh_work_items
    set status = 'claimed', leased_at = now(),
        lease_expires_at = now() + (p_lease_seconds || ' seconds')::interval,
        attempts = attempts + 1, updated_at = now()
    where id = v_work_item_id
      and (
        status in ('queued', 'failed')
        or (status in ('claimed', 'importing') and lease_expires_at < now())
      )
    returning 1 into v_claimed_count;
  exception when unique_violation then
    v_claimed_count := null;
  end;

  if v_claimed_count is null then
    return query select 'slot_busy'::text, v_work_item_id;
    return;
  end if;

  return query select 'claimed'::text, v_work_item_id;
end;
$$;

-- Atomic, monotonic watermark commit -- called ONLY after the feature-specific persistence
-- (balance upsert, or transactions-to-financial_events import) has already reported success.
-- Never advances the watermark otherwise. If a newer refresh committed concurrently while this
-- one was in flight, this attempt is marked 'superseded' (not 'failed') -- it was not wrong, it
-- was beaten -- and the caller is told exactly what won.
create or replace function commit_financial_account_refresh_work(
    p_work_item_id text,
    p_financial_account_id text,
    p_feature text,
    p_owner_id text,
    p_refresh_id text,
    p_refresh_last_attempted_at bigint
) returns table (outcome text, superseded_by_refresh_id text)
set search_path = public, pg_temp
language plpgsql as $$
declare
  v_updated_watermark_id text;
  v_current_committed_refresh_id text;
begin
  insert into financial_account_refresh_watermarks (
      financial_account_id, feature, owner_id, committed_refresh_id,
      committed_refresh_last_attempted_at, committed_at
  ) values (
      p_financial_account_id, p_feature, p_owner_id, p_refresh_id, p_refresh_last_attempted_at, now()
  )
  on conflict (financial_account_id, feature) do update
    set committed_refresh_id = excluded.committed_refresh_id,
        committed_refresh_last_attempted_at = excluded.committed_refresh_last_attempted_at,
        committed_at = now()
    where financial_account_refresh_watermarks.committed_refresh_last_attempted_at is null
       or financial_account_refresh_watermarks.committed_refresh_last_attempted_at < excluded.committed_refresh_last_attempted_at
  returning financial_account_id into v_updated_watermark_id;

  if v_updated_watermark_id is not null then
    update financial_account_refresh_work_items
    set status = 'committed', updated_at = now()
    where id = p_work_item_id;
    return query select 'committed'::text, null::text;
    return;
  end if;

  select committed_refresh_id into v_current_committed_refresh_id
    from financial_account_refresh_watermarks
    where financial_account_id = p_financial_account_id and feature = p_feature;

  update financial_account_refresh_work_items
  set status = 'superseded', superseded_by_refresh_id = v_current_committed_refresh_id, updated_at = now()
  where id = p_work_item_id;

  return query select 'superseded'::text, v_current_committed_refresh_id;
end;
$$;
