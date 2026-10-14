-- Security Layer 2 — MFA recovery generations, atomic code consume,
-- idempotent recovery operations, security latch, append-only audit log,
-- and the session grandfather registry.
--
-- DESIGN NOTES (binding, from the implementation brief):
-- * Recovery codes are stored as KEYED cryptographic digests with a key
--   version (mfa_recovery_generations.key_version). Plaintext codes are
--   NEVER persisted, logged, or returned by any function here. Digest
--   computation (HMAC with a server-side secret) and constant-time
--   comparison happen in the server gateway; the database matches on
--   digest equality and the auth limiter gates online guessing.
-- * One code authorizes exactly one reset: mfa_consume_recovery_code
--   consumes atomically under a row lock; consumed_by_operation is UNIQUE
--   so one operation can never consume two codes and replays are
--   idempotent. Concurrent racers serialize; exactly one wins.
-- * Recovery is permission to RESET enrollment, NOT proof of AAL2 and NOT
--   workspace access. The user must enroll and verify a real new TOTP
--   factor before privileged access resumes.
-- * The security latch (mfa_security_latch) independently denies old JWTs
--   during recovery, even while provider session revocation propagates.
--   A latch is cleared only after verified reenrollment -- never merely
--   because a provider call failed, and never by rolling back this
--   migration (see ROLLBACK below).
-- * Regeneration requires recent verified AAL2 and invalidates the whole
--   old generation (invalidated_at). Fresh password alone can never
--   disable mandatory MFA. Password reset never clears MFA.
--
-- SCHEMA CONVENTION NOTE: the brief suggested an `auth_security`
-- schema; this repo keeps security tables in the public schema with
-- prefixed names (cf. scheduled_send_ledger, rental_*). These tables
-- follow the repo convention (public.mfa_*/public.session_*), enforced by
-- restrictive RLS instead of schema separation.
--
-- ROLLBACK (manual, forward-only migration -- no down migration):
--   1. Confirm MFA_LAYER2_ENABLED=false everywhere and that ZERO rows
--      remain in mfa_security_latch (every latched user must complete
--      reenrollment first -- deleting the latch table while a latch is
--      active would silently un-latch users and re-admit old JWTs).
--   2. Confirm no mfa_recovery_operations row is in a non-terminal
--      status ('started' etc.); reconcile or fail them with an audit
--      entry first.
--   3. DROP FUNCTION public.mfa_consume_recovery_code(uuid,text,text,text);
--      DROP FUNCTION public.mfa_assert_recovery_latch(uuid,text,text);
--      DROP FUNCTION public.mfa_audit_log_block_mutation();
--   4. DROP TABLE in dependency order: mfa_recovery_codes,
--      mfa_recovery_generations, mfa_recovery_operations,
--      mfa_security_latch, mfa_audit_log, session_grandfather_registry.
-- Rolling back DESTROYS recovery capability (generations, codes) and the
-- audit trail -- it is a data-destructive, Jason-authorized-only step,
-- never part of a routine deploy rollback. Rollback must NOT restore
-- consumed codes and must NOT clear latches; if the old app version
-- lacks enforcement, fail closed for affected new sessions until a
-- compatible version is restored.
--
-- DEPLOY NOTE: migration file only. Applying to any database is a
-- separate, explicit Jason authorization (not granted by the build).

-- ---------------------------------------------------------------------------
-- Recovery generations: one ACTIVE generation per user (partial unique
-- index). Regeneration inserts a new row and stamps invalidated_at on the
-- old one -- the old generation's codes stop working immediately.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_recovery_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  key_version integer not null,
  created_at timestamptz not null default now(),
  invalidated_at timestamptz
);

do $$
begin
  if not exists (
    select 1 from pg_indexes
     where schemaname = 'public'
       and indexname = 'mfa_recovery_generations_one_active_per_user'
  ) then
    create unique index mfa_recovery_generations_one_active_per_user
      on public.mfa_recovery_generations (user_id)
      where invalidated_at is null;
  end if;
end
$$;

create index if not exists mfa_recovery_generations_user_idx
  on public.mfa_recovery_generations (user_id);

-- ---------------------------------------------------------------------------
-- Recovery codes: digests only, never plaintext. consumed_by_operation is
-- UNIQUE: one operation consumes exactly one code, and replaying the same
-- operation id is idempotent.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_recovery_codes (
  id uuid primary key default gen_random_uuid(),
  generation_id uuid not null
    references public.mfa_recovery_generations (id) on delete cascade,
  code_digest text not null,
  consumed_at timestamptz,
  consumed_by_operation text unique
);

create index if not exists mfa_recovery_codes_generation_idx
  on public.mfa_recovery_codes (generation_id);

-- ---------------------------------------------------------------------------
-- Idempotent recovery operation tracking for partial-failure
-- reconciliation. The gateway mints one operation id per recovery
-- attempt; provider admin steps (factor removal, session revocation)
-- advance the status so a crashed or retried recovery resumes instead of
-- double-executing. Terminal: 'completed', 'failed'.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_recovery_operations (
  id text primary key,
  user_id uuid not null,
  status text not null
    check (status in (
      'started', 'code_consumed', 'latched', 'factor_removed',
      'generations_invalidated', 'sessions_revoked', 'reenrolled',
      'completed', 'failed'
    )),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists mfa_recovery_operations_user_idx
  on public.mfa_recovery_operations (user_id);

-- ---------------------------------------------------------------------------
-- Security latch: while a row exists for a user, old JWTs are denied
-- independently of provider revocation propagation. Inserted when
-- recovery enters RECOVERY_PENDING (or on Jason break-glass reset);
-- DELETED only after the user enrolls and verifies a real new TOTP
-- factor. Never cleared merely because a provider call failed.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_security_latch (
  user_id uuid primary key,
  latched_at timestamptz not null default now(),
  reason text not null,
  audit_id text not null
);

-- ---------------------------------------------------------------------------
-- Append-only audit log. UPDATE/DELETE are blocked by trigger (defense in
-- depth on top of the revoke below): the log can only grow.
-- ---------------------------------------------------------------------------
create table if not exists public.mfa_audit_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  action text not null,
  actor text not null,
  audit_id text not null,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index if not exists mfa_audit_log_user_idx
  on public.mfa_audit_log (user_id);
create index if not exists mfa_audit_log_audit_id_idx
  on public.mfa_audit_log (audit_id);

create or replace function public.mfa_audit_log_block_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'mfa_audit_log is append-only';
end;
$$;

drop trigger if exists mfa_audit_log_no_mutation on public.mfa_audit_log;

create trigger mfa_audit_log_no_mutation
  before update or delete on public.mfa_audit_log
  for each row
  execute function public.mfa_audit_log_block_mutation();

-- ---------------------------------------------------------------------------
-- Grandfather registry: server-owned snapshot of legitimate session
-- families existing at activation. Keyed by authenticated user +
-- Supabase session_id. Refresh of the SAME family preserves eligibility
-- until that family ends under the existing session lifetime/sign-out
-- policy; new families can never join the snapshot. No browser timestamp
-- or newly refreshed JWT iat determines grandfathering. Revoked or
-- recovery-pending families never regain access via grandfathering --
-- recovery deletes the user's rows here when the latch is set.
-- ---------------------------------------------------------------------------
create table if not exists public.session_grandfather_registry (
  user_id uuid not null,
  session_id text not null,
  family_id text not null,
  created_at timestamptz not null default now(),
  primary key (user_id, session_id)
);

-- ---------------------------------------------------------------------------
-- Restrictive RLS: service-role only, on every table. RLS is enabled and
-- the ONLY policy grants full access to service_role. There are NO
-- policies for anon or authenticated, and their table privileges are
-- revoked, so no client-side role can read recovery digests, latches,
-- operations, or the audit log. The application reaches these tables
-- exclusively through server gateway routes as service_role. This is
-- deliberate: recovery and latch state must never be OR-ed around by a
-- permissive client policy, and no authenticated user may enumerate
-- another user's recovery generations.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'mfa_recovery_generations',
    'mfa_recovery_codes',
    'mfa_recovery_operations',
    'mfa_security_latch',
    'mfa_audit_log',
    'session_grandfather_registry'
  ] loop
    execute format('alter table public.%I enable row level security', t);

    if not exists (
      select 1 from pg_policies
       where schemaname = 'public'
         and tablename = t
         and policyname = 'service_role_full_access'
    ) then
      execute format(
        'create policy service_role_full_access on public.%I ' ||
        'for all to service_role using (true) with check (true)', t);
    end if;

    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant all on public.%I to service_role', t);
  end loop;

  -- Append-only hardening: even service_role cannot UPDATE/DELETE the
  -- audit log at the privilege level (the trigger is the backstop).
  revoke update, delete on public.mfa_audit_log from service_role;
end
$$;

-- ---------------------------------------------------------------------------
-- Atomic recovery-code consume + latch. Exactly one concurrent winner per
-- code; the UNIQUE(consumed_by_operation) column makes one operation
-- consume exactly one code and makes replays idempotent.
--
-- L2-005: the idempotent replay path is BOUND to the consuming user AND
-- the presented digest. A replay of another user's operation id, or the
-- same operation id with a different digest, returns consumed=false with
-- NO side effects -- cross-user replay can never inherit a consumed code.
--
-- L2-006: a successful consume atomically (same transaction) enters
-- RECOVERY_PENDING by upserting the mfa_security_latch row, records the
-- recovery operation row, appends the audit row, and deletes the user's
-- grandfather-registry rows (revoked/recovery-pending families never
-- regain access via grandfathering). The gateway performs NO separate
-- latch insert -- there is no window where the code is consumed but the
-- latch is missing, and no "use a different code" retry path.
--
-- Returns one row: (code_id, generation_id, consumed). consumed=false
-- means: unknown digest, code already consumed, the generation is
-- invalidated, or a mismatched replay -- the gateway answers all
-- identically (generic error) so callers cannot enumerate which case hit.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_consume_recovery_code(
  p_user_id uuid,
  p_code_digest text,
  p_operation_id text,
  p_audit_id text
)
returns table (
  code_id uuid,
  generation_id uuid,
  consumed boolean
)
language plpgsql
as $$
declare
  v_code_id uuid;
  v_gen_id uuid;
begin
  if p_user_id is null or p_code_digest is null
     or p_operation_id is null or p_audit_id is null then
    code_id := null; generation_id := null; consumed := false;
    return next;
    return;
  end if;

  -- Idempotent replay, BOUND to user + digest: this operation already
  -- consumed a code belonging to THIS user with THIS digest. Any other
  -- combination falls through to consumed=false with no side effects.
  select c.id, c.generation_id
    into v_code_id, v_gen_id
    from public.mfa_recovery_codes c
    join public.mfa_recovery_generations g
      on g.id = c.generation_id
   where c.consumed_by_operation = p_operation_id
     and g.user_id = p_user_id
     and c.code_digest = p_code_digest
   limit 1;

  if found then
    -- Ensure the latch/operation/audit side effects of the original
    -- consume (self-healing if the first attempt crashed mid-transaction
    -- after consume but before commit -- impossible in one transaction,
    -- but harmless to re-assert).
    perform public.mfa_assert_recovery_latch(p_user_id, p_operation_id, p_audit_id);
    code_id := v_code_id; generation_id := v_gen_id; consumed := true;
    return next;
    return;
  end if;

  -- A DIFFERENT user or digest replaying this operation id: no side
  -- effects, no information. The caller must mint its own operation id.
  if exists (
    select 1 from public.mfa_recovery_codes c
     where c.consumed_by_operation = p_operation_id
  ) then
    code_id := null; generation_id := null; consumed := false;
    return next;
    return;
  end if;

  -- Atomic consume: the row lock serializes racers; the loser observes
  -- consumed_at NOT NULL and consumes nothing. Only codes from the
  -- user's ACTIVE generation are eligible -- invalidated generations
  -- are dead the moment invalidated_at is stamped.
  select c.id, c.generation_id
    into v_code_id, v_gen_id
    from public.mfa_recovery_codes c
    join public.mfa_recovery_generations g
      on g.id = c.generation_id
   where g.user_id = p_user_id
     and g.invalidated_at is null
     and c.code_digest = p_code_digest
     and c.consumed_at is null
   limit 1
   for update of c;

  if not found then
    code_id := null; generation_id := null; consumed := false;
    return next;
    return;
  end if;

  begin
    update public.mfa_recovery_codes
       set consumed_at = now(),
           consumed_by_operation = p_operation_id
     where id = v_code_id
       and consumed_at is null;
  exception when unique_violation then
    -- The same operation id raced itself through two paths: re-read the
    -- winner and report idempotent success rather than throwing.
    select c.id, c.generation_id
      into v_code_id, v_gen_id
      from public.mfa_recovery_codes c
      join public.mfa_recovery_generations g
        on g.id = c.generation_id
     where c.consumed_by_operation = p_operation_id
       and g.user_id = p_user_id
       and c.code_digest = p_code_digest
     limit 1;

    if found then
      perform public.mfa_assert_recovery_latch(p_user_id, p_operation_id, p_audit_id);
      code_id := v_code_id; generation_id := v_gen_id; consumed := true;
    else
      code_id := null; generation_id := null; consumed := false;
    end if;
    return next;
    return;
  end;

  if not found then
    -- Lost the race between SELECT and UPDATE: another transaction
    -- consumed this code first. One code, one reset -- the loser gets
    -- nothing.
    code_id := null; generation_id := null; consumed := false;
  else
    -- Atomic latch entry: same transaction as the consume.
    perform public.mfa_assert_recovery_latch(p_user_id, p_operation_id, p_audit_id);
    code_id := v_code_id; generation_id := v_gen_id; consumed := true;
  end if;
  return next;
  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent recovery-latch assertion, called by the consume RPC inside
-- its own transaction. Upserts the mfa_security_latch row, records the
-- recovery operation row, appends the audit row, and deletes the user's
-- grandfather-registry rows. Never clears the latch.
-- ---------------------------------------------------------------------------
create or replace function public.mfa_assert_recovery_latch(
  p_user_id uuid,
  p_operation_id text,
  p_audit_id text
)
returns void
language plpgsql
as $$
begin
  insert into public.mfa_security_latch (user_id, reason, audit_id)
  values (p_user_id, 'recovery_code_consumed', p_audit_id)
  on conflict (user_id) do update
     set latched_at = now(),
         reason = excluded.reason,
         audit_id = excluded.audit_id;

  insert into public.mfa_recovery_operations (id, user_id, status)
  values (p_operation_id, p_user_id, 'latched')
  on conflict (id) do update
     set status = 'latched',
         updated_at = now()
   where mfa_recovery_operations.status not in ('completed', 'failed');

  insert into public.mfa_audit_log (user_id, action, actor, audit_id, metadata)
  values (
    p_user_id,
    'recovery_code_consumed',
    'gateway',
    p_audit_id,
    jsonb_build_object('operation_id', p_operation_id)
  );

  -- Revoked/recovery-pending families never regain access via
  -- grandfathering: entering RECOVERY_PENDING deletes the snapshot rows.
  delete from public.session_grandfather_registry
   where user_id = p_user_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants: service-role only. The gateway calls the consume RPC as
-- service_role; no client role may call it directly (it would let a
-- caller brute-force digests outside the gateway's limiter).
-- ---------------------------------------------------------------------------
do $$
begin
  execute 'revoke all on function public.mfa_consume_recovery_code(uuid,text,text,text) from public';
  execute 'revoke all on function public.mfa_consume_recovery_code(uuid,text,text,text) from anon';
  execute 'revoke all on function public.mfa_consume_recovery_code(uuid,text,text,text) from authenticated';
  execute 'grant execute on function public.mfa_consume_recovery_code(uuid,text,text,text) to service_role';
  execute 'revoke all on function public.mfa_assert_recovery_latch(uuid,text,text) from public';
  execute 'revoke all on function public.mfa_assert_recovery_latch(uuid,text,text) from anon';
  execute 'revoke all on function public.mfa_assert_recovery_latch(uuid,text,text) from authenticated';
  execute 'grant execute on function public.mfa_assert_recovery_latch(uuid,text,text) to service_role';
end
$$;

-- Re-applying this migration is a no-op: CREATE TABLE IF NOT EXISTS,
-- guarded index/policy/trigger creation, CREATE OR REPLACE FUNCTION, and
-- idempotent revoke/grant statements leave existing rows untouched.
-- Consumed codes stay consumed; latches stay latched.
