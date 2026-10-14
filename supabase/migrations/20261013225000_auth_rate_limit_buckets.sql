-- Security Layer 2 — distributed authentication admission limiter.
--
-- One server-only Postgres atomic admission RPC (auth_admission_check)
-- transactionally evaluates every relevant token bucket before the
-- gateway authorizes a provider auth operation. There is no in-memory
-- production counter and no allow-on-error fallback: when the limiter
-- store is unavailable the RPC reports unavailable=true and the gateway
-- answers generic 503 with NO provider call. Already-authorized sessions
-- continue; new auth operations and refresh fail closed.
--
-- Buckets are keyed by opaque server-constructed strings, e.g.
--   signin:acct:<hmac-of-normalized-account>
--   signin:ip:<trusted-deployment-derived-ip>
--   refresh:sess:<verified-session-id>
-- Key construction (HMAC, normalization, trusted IP extraction) lives in
-- the gateway, never in SQL: the RPC treats keys as opaque.
--
-- STAGING DEFAULTS (reference only -- limits are passed as the JSONB
-- argument, never hardcoded; tune in the gateway config, no migration):
--   sign-in : account/IP 5 failed attempts/5 min (capacity 5, window 300),
--             account-wide 30/15 min, IP 100/5 min
--   sign-up : IP 20/10 min, account 3/hour
--   reset   : account 3/hour, IP 30/hour
--   refresh : session 30/5 min, account 120/5 min, IP 1000/5 min
--   mfa/recovery: account 5 failures/5 min, IP 60/5 min
-- Backoff after repeated failures: 2,4,8,16,32,60 seconds, capped at 60,
-- then bounded bucket cooldown. No permanent attacker-triggerable
-- account lock. Successful MFA clears applicable failure backoff, never
-- refunds IP abuse budgets.
--
-- ROLLBACK (manual, forward-only migration -- no down migration):
--   1. Confirm AUTH_RATE_LIMIT_ENABLED=false everywhere (gateway config)
--      so no new auth operation depends on these tables.
--   2. DROP FUNCTION public.auth_record_attempt_outcome(text,text,text);
--      DROP FUNCTION public.auth_admission_check(text,text[],jsonb,text,timestamptz);
--   3. DROP TABLE public.auth_backoff_clears, public.auth_operation_log,
--      public.auth_rate_limit_buckets (order irrelevant, no FKs).
-- Data loss is limited to limiter state: budgets reset to full on
-- re-install, which is the permissive direction and therefore safe to
-- re-tune. Rollback does NOT grant access -- with the flag off, auth
-- flows behave exactly as before Layer 2. Never roll back while the
-- limiter is enforced: new auth operations would fail closed until a
-- compatible gateway version is restored.
--
-- DEPLOY NOTE: migration file only. Applying to any database is a
-- separate, explicit Jason authorization (not granted by the build).

-- ---------------------------------------------------------------------------
-- Bucket store. tokens is a fractional token-bucket balance; last_refill
-- is the server-clock instant the balance was last reconciled.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_rate_limit_buckets (
  bucket_key text primary key,
  tokens double precision not null default 0,
  last_refill timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Operation dedupe log. One row per gateway auth attempt, claimed by the
-- RPC before any bucket is touched, so a retried operation_id replays the
-- recorded verdict instead of consuming tokens twice. Also the source of
-- truth for failure-backoff accounting (outcomes 'denied' and
-- 'credential_failed').
-- ---------------------------------------------------------------------------
create table if not exists public.auth_operation_log (
  operation_id text primary key,
  action text not null,
  bucket_keys text[] not null,
  outcome text not null
    check (outcome in (
      'evaluating', 'admitted', 'denied',
      'credential_failed', 'credential_succeeded', 'mfa_succeeded'
    )),
  retry_after_seconds integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists auth_operation_log_action_keys_created_idx
  on public.auth_operation_log (action, created_at);

-- ---------------------------------------------------------------------------
-- Backoff clear markers. A credential/MFA success records the account key
-- here; the admission RPC ignores failures older than the latest clear.
-- IP token budgets are separate bucket rows and are never refunded.
-- ---------------------------------------------------------------------------
create table if not exists public.auth_backoff_clears (
  action text not null,
  key_fingerprint text not null,
  cleared_at timestamptz not null default now(),
  primary key (action, key_fingerprint)
);

-- ---------------------------------------------------------------------------
-- Restrictive RLS: service-role only. RLS is enabled on every table and
-- the ONLY policy grants full access to service_role (which bypasses RLS
-- in Supabase regardless -- the policy documents intent). There are NO
-- policies for anon or authenticated, and their table privileges are
-- revoked below, so no client-side role can read or write limiter state.
-- The application reaches these tables exclusively through the server
-- gateway routes running as service_role. This is deliberate: limiter
-- state must never be OR-ed around by a permissive client policy.
-- ---------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'auth_rate_limit_buckets',
    'auth_operation_log',
    'auth_backoff_clears'
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
end
$$;

-- ---------------------------------------------------------------------------
-- Atomic admission check. Evaluates ALL buckets for one auth attempt in a
-- single transaction, reserves admissions before returning allowed, and
-- records the attempt idempotently by operation_id.
--
-- Returns exactly one row:
--   allowed            -- every bucket had a token; all were decremented
--   retry_after_seconds-- when denied: seconds until the most constrained
--                        bucket refills one token (for the 429 Retry-After)
--   backoff_seconds    -- advisory failure backoff: 0,2,4,8,16,32,60
--   unavailable        -- true when the limiter could not evaluate
--                        (storage down, misconfiguration, lock failure):
--                        the gateway must answer generic 503 and make NO
--                        provider call.
--
-- p_limits is a JSONB array aligned positionally with p_keys; each
-- element is {"capacity": <tokens>, "window_seconds": <seconds>}.
-- p_now exists for deterministic tests; production callers pass NULL and
-- the SERVER clock (now()) governs refill math.
-- ---------------------------------------------------------------------------
create or replace function public.auth_admission_check(
  p_action text,
  p_keys text[],
  p_limits jsonb,
  p_operation_id text,
  p_now timestamptz default null
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  backoff_seconds integer,
  unavailable boolean
)
language plpgsql
as $$
declare
  v_now timestamptz := coalesce(p_now, now());
  backoff_steps constant integer[] := array[0, 2, 4, 8, 16, 32, 60];
  v_n integer;
  v_order integer[];
  v_ord integer;
  v_i integer;
  v_key text;
  v_limit jsonb;
  v_capacity double precision;
  v_window double precision;
  v_rate double precision;
  v_tokens double precision;
  v_last_refill timestamptz;
  v_elapsed double precision;
  v_refilled double precision;
  v_retry integer := 0;
  v_bucket_retry integer;
  v_denied boolean := false;
  v_replay_outcome text;
  v_replay_retry integer;
  v_failures integer;
  v_clear_at timestamptz;
begin
  -- Malformed input fails closed: it can never admit, and it surfaces as
  -- unavailable so the gateway answers 503 with no provider call.
  if p_action is null or p_operation_id is null
     or p_keys is null or coalesce(array_length(p_keys, 1), 0) = 0
     or p_limits is null or jsonb_typeof(p_limits) <> 'array'
     or jsonb_array_length(p_limits) < array_length(p_keys, 1) then
    allowed := false;
    retry_after_seconds := null;
    backoff_seconds := 0;
    unavailable := true;
    return next;
    return;
  end if;

  begin
    -- Claim the operation id FIRST. Exactly one evaluator per operation:
    -- a concurrent replay of the same operation_id blocks on this row's
    -- lock (SELECT ... FOR UPDATE below) until the owner commits, then
    -- replays the owner's recorded verdict instead of consuming tokens a
    -- second time. A retried gateway call is therefore idempotent.
    insert into public.auth_operation_log
      (operation_id, action, bucket_keys, outcome, created_at, updated_at)
    values
      (p_operation_id, p_action, p_keys, 'evaluating', v_now, v_now)
    on conflict (operation_id) do nothing;

    if not found then
      select o.outcome, o.retry_after_seconds
        into v_replay_outcome, v_replay_retry
        from public.auth_operation_log o
       where o.operation_id = p_operation_id
       for update;

      if not found then
        -- Owner rolled back between the claim race and our read; retry
        -- once as the owner.
        insert into public.auth_operation_log
          (operation_id, action, bucket_keys, outcome, created_at, updated_at)
        values
          (p_operation_id, p_action, p_keys, 'evaluating', v_now, v_now)
        on conflict (operation_id) do nothing;

        if not found then
          -- Lost the race twice: fail closed, never double-evaluate.
          allowed := false;
          retry_after_seconds := null;
          backoff_seconds := 0;
          unavailable := true;
          return next;
          return;
        end if;
      else
        -- Replay path: the owner's verdict stands. Backoff is advisory
        -- and is recomputed on the next fresh evaluation.
        allowed := (v_replay_outcome = 'admitted');
        retry_after_seconds := v_replay_retry;
        backoff_seconds := 0;
        unavailable := false;
        return next;
        return;
      end if;
    end if;

    v_n := array_length(p_keys, 1);

    -- Lock buckets in deterministic key order: concurrent evaluators of
    -- overlapping key sets always acquire row locks in the same order,
    -- so they serialize instead of deadlocking. The function never
    -- throws on contention; lock waits resolve in commit order.
    select array_agg(u.idx order by u.k)
      into v_order
      from unnest(p_keys) with ordinality as u(k, idx);

    foreach v_ord in array v_order loop
      v_i := v_ord;
      v_key := p_keys[v_i];
      v_limit := p_limits -> (v_i - 1);

      v_capacity := nullif(v_limit ->> 'capacity', '')::double precision;
      v_window := nullif(v_limit ->> 'window_seconds', '')::double precision;

      -- Misconfigured limits fail closed and loud (caught below ->
      -- unavailable; the gateway answers 503 and makes no provider call).
      -- Windows are capped at 24h: the pruning bound below is only safe
      -- for windows at or under that bound.
      if v_capacity is null or v_capacity <= 0
         or v_window is null or v_window <= 0 or v_window > 86400 then
        raise exception
          'auth_admission_check: invalid limit for action % key %',
          p_action, v_key;
      end if;

      v_rate := v_capacity / v_window;

      insert into public.auth_rate_limit_buckets
        (bucket_key, tokens, last_refill, created_at, updated_at)
      values
        (v_key, v_capacity, v_now, v_now, v_now)
      on conflict (bucket_key) do nothing;

      select b.tokens, b.last_refill
        into v_tokens, v_last_refill
        from public.auth_rate_limit_buckets b
       where b.bucket_key = v_key
       for update;

      -- Token-bucket refill on the SERVER clock: elapsed time since the
      -- last touch, capped at capacity.
      v_elapsed := greatest(0, extract(epoch from (v_now - v_last_refill)));
      v_refilled := least(v_capacity, v_tokens + (v_elapsed * v_rate));

      if v_refilled >= 1.0 then
        -- Reserve the admission BEFORE returning allowed: the decrement
        -- happens inside the same row lock, so N concurrent evaluators
        -- can never admit more than the available tokens.
        v_tokens := v_refilled - 1.0;
      else
        v_denied := true;
        v_bucket_retry :=
          greatest(1, ceil((1.0 - v_refilled) / v_rate)::integer);
        v_retry := greatest(v_retry, v_bucket_retry);
      end if;

      update public.auth_rate_limit_buckets
         set tokens = v_tokens,
             last_refill = v_now,
             updated_at = v_now
       where bucket_key = v_key;
    end loop;

    -- Opportunistic TTL pruning keeps bucket cardinality bounded. A row
    -- idle for 24h is fully refilled for every supported window (capped
    -- at 24h above), so deleting it is exactly equivalent to a full
    -- refill -- pruning can never make a bucket MORE permissive than its
    -- configured limit. A dedicated scheduled pruning job is documented
    -- in the runbook; this in-path prune only bounds growth between runs.
    delete from public.auth_rate_limit_buckets
     where last_refill < v_now - interval '24 hours';

    -- Backoff after repeated failures: 2,4,8,16,32,60 seconds, capped at
    -- 60. Counts admission denials AND recorded credential failures for
    -- this action on overlapping keys in the trailing 15 minutes. A
    -- later success clears the failure history for the account key
    -- (successful MFA clears backoff); IP token budgets are separate
    -- bucket rows and are never refunded by success.
    select max(c.cleared_at)
      into v_clear_at
      from public.auth_backoff_clears c
     where c.action = p_action
       and c.key_fingerprint = any (p_keys);

    select count(*)::integer
      into v_failures
      from public.auth_operation_log o
     where o.action = p_action
       and o.bucket_keys && p_keys
       and o.outcome in ('denied', 'credential_failed')
       and o.created_at > v_now - interval '15 minutes'
       and (v_clear_at is null or o.created_at > v_clear_at);

    backoff_seconds := backoff_steps[least(v_failures, 6) + 1];

    -- Publish the verdict on the claimed row, then return it. Replayers
    -- blocked on the row lock observe exactly this committed state. The
    -- outcome='evaluating' guard means a (mis-sequenced) outcome write
    -- that landed first is never clobbered: the terminal outcome stands.
    update public.auth_operation_log
       set outcome = case when v_denied then 'denied' else 'admitted' end,
           retry_after_seconds =
             case when v_denied then v_retry else null end,
           updated_at = v_now
     where operation_id = p_operation_id
       and outcome = 'evaluating';

    allowed := not v_denied;
    retry_after_seconds := case when v_denied then v_retry else null end;
    unavailable := false;
    return next;
    return;

  exception when others then
    -- The limiter NEVER throws to the caller: lock contention, missing
    -- tables (migration not applied), or misconfiguration all surface as
    -- unavailable, and the gateway answers generic 503 with NO provider
    -- call. Already-authorized sessions continue; new auth operations
    -- fail closed.
    allowed := false;
    retry_after_seconds := null;
    backoff_seconds := 0;
    unavailable := true;
    return next;
    return;
  end;
end;
$$;

-- ---------------------------------------------------------------------------
-- Idempotent attempt-outcome recorder. The gateway calls this after the
-- provider operation to record credential/MFA outcomes against the
-- operation_id claimed by auth_admission_check. Transitions are
-- forward-only (evaluating/admitted -> terminal); the first terminal
-- outcome wins and replays are idempotent. A success records an
-- account-key clear marker so failure backoff resets; IP token budgets
-- are never refunded.
-- Returns true when the outcome is (now) recorded, false otherwise.
-- ---------------------------------------------------------------------------
create or replace function public.auth_record_attempt_outcome(
  p_operation_id text,
  p_outcome text,
  p_account_key text default null
)
returns boolean
language plpgsql
as $$
declare
  v_action text;
  v_existing text;
  v_recorded boolean := false;
begin
  if p_outcome not in
     ('credential_failed', 'credential_succeeded', 'mfa_succeeded') then
    raise exception
      'auth_record_attempt_outcome: invalid outcome %', p_outcome;
  end if;

  update public.auth_operation_log
     set outcome = p_outcome,
         updated_at = now()
   where operation_id = p_operation_id
     and outcome in ('evaluating', 'admitted');

  if found then
    v_recorded := true;
    select o.action into v_action
      from public.auth_operation_log o
     where o.operation_id = p_operation_id;
  else
    select o.outcome, o.action into v_existing, v_action
      from public.auth_operation_log o
     where o.operation_id = p_operation_id;

    if not found then
      return false; -- unknown operation: nothing recorded
    end if;

    if v_existing = p_outcome then
      v_recorded := true; -- idempotent replay
    else
      return false; -- a terminal outcome is already recorded; first wins
    end if;
  end if;

  if v_recorded
     and p_outcome in ('credential_succeeded', 'mfa_succeeded')
     and p_account_key is not null
     and v_action is not null then
    insert into public.auth_backoff_clears (action, key_fingerprint, cleared_at)
    values (v_action, p_account_key, now())
    on conflict (action, key_fingerprint)
    do update set cleared_at = excluded.cleared_at;
  end if;

  return v_recorded;

exception when others then
  -- Outcome recording must never break the auth path: the caller already
  -- has its admission verdict. A false return is logged gateway-side.
  return false;
end;
$$;

-- ---------------------------------------------------------------------------
-- Execute grants: service-role only, matching the table posture. The
-- gateway calls these RPCs as service_role; no client role may call them
-- directly.
-- ---------------------------------------------------------------------------
do $$
declare
  fn text;
begin
  foreach fn in array array[
    'auth_admission_check(text,text[],jsonb,text,timestamptz)',
    'auth_record_attempt_outcome(text,text,text)'
  ] loop
    execute format('revoke all on function public.%s from public', fn);
    execute format('revoke all on function public.%s from anon', fn);
    execute format('revoke all on function public.%s from authenticated', fn);
    execute format('grant execute on function public.%s to service_role', fn);
  end loop;
end
$$;

-- Re-applying this migration is a no-op: CREATE TABLE IF NOT EXISTS,
-- CREATE OR REPLACE FUNCTION, guarded policy creation, and idempotent
-- revoke/grant statements leave existing rows untouched.
