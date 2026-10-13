-- Receipt-delivery confirmation ledger: RDL-004A atomic attempt recording
-- (2026-10-13 re-review 2, PR #619).
--
-- RDL-004A.1: the claim-token check was a separate read before the attempt
-- insert, so a takeover rotating the token between the check and the
-- insert let a stale generation append evidence. Fixed by moving the
-- whole check + ordinal allocation + insert into ONE database function
-- (record_rental_send_attempt) that holds a row lock (SELECT ... FOR
-- UPDATE) on the ledger row for the entire operation. There is no longer
-- any interleaving point between verification and append.
-- takeoverLedgerRow participates in the same fencing: its UPDATE takes
-- the identical row lock, so a takeover and an attempt recording always
-- serialize at the database -- a stale worker can never slip an insert
-- past a token rotation.
--
-- RDL-004A.2: concurrent writers read the same prior rows and computed
-- the same max+1 ordinal. Fixed by allocating the ordinal INSIDE the
-- locked function, plus a UNIQUE (ledger_id, delivery_id,
-- attempt_ordinal) constraint as a backstop. Because allocation happens
-- under the ledger-row lock, the constraint is unreachable in practice;
-- if it ever fires it is a loud error, never a silent duplicate.
--
-- Explicit semantics defined by this change:
--   * stale generation: presented claim_token differs from the row's
--     CURRENT token -> refused, {recorded:false,reason:'stale_claim_token'},
--     zero rows appended.
--   * legacy rows (claim_token IS NULL, pre-token claims): explicitly
--     unfenced on generation -- attempts are accepted -- but still
--     serialized by the row lock, so ordinals stay unique. The attempt
--     row records claim_token NULL.
--   * idempotency: an identical outcome recorded twice for the same
--     attempt identity (same delivery, same run, same state and outcome
--     payload) is a re-record, NOT a new attempt: the function returns
--     the existing row with duplicate:true and appends nothing. Genuine
--     new evidence (different outcome, different run, or a retry's new
--     outcome) always mints a fresh ordinal.
--
-- RDL-004A.3: the backfill below runs ONLY on initial installation,
-- inside the same "constraint does not exist" guard as the constraint
-- creation. A replay of this migration must leave existing attempt rows
-- byte-for-byte unchanged: re-ranking by attempted_at,id would overwrite
-- authoritative ordinals allocated under the ledger-row lock and could
-- flip which outcome authoritativeLatestAttempts treats as latest (or
-- raise a uniqueness violation mid-replay). Never re-rank
-- already-authoritative nonzero ordinals.
--
-- DEPLOY NOTE: migration file only. Applying to production Supabase is a
-- separate, explicit Jason authorization (not granted by the proposal or
-- by this PR).

-- Initial-install backfill + constraint, guarded as one unit: on first
-- application, give every pre-existing attempt row a distinct
-- per-delivery ordinal (ordered by attempted_at, then id) so the
-- uniqueness constraint applies cleanly to rows recorded before atomic
-- recording existed. attempt_ordinal was advisory-only before this
-- change; nothing depends on the old all-zero values. On any later
-- application the constraint already exists and this whole block is a
-- no-op -- existing rows are never touched.
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'scheduled_send_attempts_ordinal_unique'
  ) then
    with ranked as (
      select id,
             row_number() over (
               partition by ledger_id, delivery_id
               order by attempted_at, id
             ) as rn
        from scheduled_send_attempts
    )
    update scheduled_send_attempts a
       set attempt_ordinal = ranked.rn
      from ranked
     where a.id = ranked.id;

    alter table scheduled_send_attempts
      add constraint scheduled_send_attempts_ordinal_unique
      unique (ledger_id, delivery_id, attempt_ordinal);
  end if;
end
$$;

-- Atomic attempt recorder. Single transaction, single row lock on the
-- ledger row: token verification, ordinal allocation, and the insert are
-- inseparable.
create or replace function public.record_rental_send_attempt(
  p_ledger_id uuid,
  p_delivery_id text,
  p_state text,
  p_provider_message_id text default null,
  p_failure_reason text default null,
  p_run_id text default null,
  p_claim_token text default null
)
returns jsonb
language plpgsql
as $$
declare
  v_claim_token text;
  v_ordinal integer;
  v_existing jsonb;
  v_row jsonb;
begin
  if p_state not in ('provider_accepted', 'provider_failed') then
    raise exception 'record_rental_send_attempt: invalid attempt state %', p_state;
  end if;

  -- Serialize on the ledger row: concurrent recorders of the same row
  -- queue here, and takeoverLedgerRow's UPDATE takes this same lock, so
  -- no takeover can slip between the token check and the insert below.
  select l.claim_token
    into v_claim_token
    from scheduled_send_ledger l
   where l.id = p_ledger_id
     for update;

  if not found then
    return jsonb_build_object('recorded', false, 'reason', 'no_ledger_row');
  end if;

  -- Generation fence. NULL token = legacy pre-token row: explicitly
  -- accepted (backfill semantics), still serialized by the lock above.
  if v_claim_token is not null
     and p_claim_token is distinct from v_claim_token then
    return jsonb_build_object('recorded', false, 'reason', 'stale_claim_token');
  end if;

  -- Idempotency: same attempt identity + identical outcome payload is a
  -- re-record, not a new attempt. Genuine new evidence falls through.
  select to_jsonb(a)
    into v_existing
    from scheduled_send_attempts a
   where a.ledger_id = p_ledger_id
     and a.delivery_id = p_delivery_id
     and a.run_id is not distinct from p_run_id
     and a.state = p_state
     and a.provider_message_id is not distinct from p_provider_message_id
     and a.failure_reason is not distinct from p_failure_reason
   limit 1;

  if v_existing is not null then
    return jsonb_build_object(
      'recorded', true,
      'duplicate', true,
      'attempt_ordinal', (v_existing ->> 'attempt_ordinal')::integer,
      'attempt', v_existing
    );
  end if;

  -- Ordinal allocated inside the lock: two concurrent recorders can never
  -- observe the same max.
  select coalesce(max(a.attempt_ordinal), 0) + 1
    into v_ordinal
    from scheduled_send_attempts a
   where a.ledger_id = p_ledger_id
     and a.delivery_id = p_delivery_id;

  insert into scheduled_send_attempts
    (ledger_id, delivery_id, state, provider_message_id, failure_reason,
     run_id, claim_token, attempt_ordinal, attempted_at)
  values
    (p_ledger_id, p_delivery_id, p_state, p_provider_message_id,
     p_failure_reason, p_run_id, v_claim_token, v_ordinal, now())
  returning to_jsonb(scheduled_send_attempts.*) into v_row;

  return jsonb_build_object(
    'recorded', true,
    'duplicate', false,
    'attempt_ordinal', v_ordinal,
    'attempt', v_row
  );
end;
$$;

-- Service-role only: the sweep routes call this from server code.
-- Matches the RLS posture of the ledger tables (no policies; service role
-- bypasses RLS).
do $$
declare
  fn text := 'record_rental_send_attempt(uuid,text,text,text,text,text,text)';
begin
  execute format('revoke all on function public.%s from public', fn);
  execute format('revoke all on function public.%s from anon', fn);
  execute format('revoke all on function public.%s from authenticated', fn);
  execute format('grant execute on function public.%s to service_role', fn);
end
$$;
