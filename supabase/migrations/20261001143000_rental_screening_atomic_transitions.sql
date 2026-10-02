-- 20261001143000_rental_screening_atomic_transitions.sql
--
-- Rentec-parity R22 follow-up: close the ChatGPT NO-GO findings on PR #527.
--
-- FINDING 1 (blocking, compliance/audit integrity): screening state
-- mutations and their claimed append-only audit events were separate
-- database requests. mark_in_progress, record_results, set_recommendation,
-- complete, token regeneration, and the request flow updated/inserted the
-- screening first and called recordEvent afterward. If the event insert
-- failed, the route returned 500 AFTER the screening mutation had already
-- committed — a completed/result-bearing/recommended screening could exist
-- with no corresponding audit event, despite the slice's contract that every
-- screening action is audited.
--
-- THE FIX: each state transition + its audit event append now happen inside
-- ONE database transaction via the RPCs below. If any step fails, the whole
-- transaction rolls back — a screening mutation can never commit without its
-- audit event, and an audit event can never commit without its mutation:
--   * request_screening(...) — insert screening + 'requested' event.
--     Re-verifies the application is pending and consent is recorded inside
--     the transaction (the route keeps the same checks for fast 404/409 UX;
--     this is the enforcement boundary). The partial unique index on open
--     screenings is the last defense against two concurrent requests; the
--     unique_violation is mapped to a clean SCREENING_CONFLICT.
--   * transition_screening(...) — SELECT ... FOR UPDATE on the screening
--     row serializes competing transitions; the status-machine check, the
--     mutation, and the event append are one transaction. Covers
--     mark_in_progress, record_results, set_recommendation, complete,
--     regenerate_token, and provider_attempt_blocked (a blocked provider
--     attempt is itself an audited action with no screening mutation).
--   * record_applicant_screening_info(...) — the consent-sensitive public
--     transition: the applicant's consent/info update plus BOTH the
--     'consent_recorded' and 'applicant_info_received' events in one
--     transaction. Called with the service-role client; the 24-char random
--     token is the authorization (scoped to exactly one screening).
--
-- FINDING 2 (correctness) is fixed in the domain layer
-- (src/domains/rental-screening/screening.js): screeningHasResults() now
-- treats results_recorded_at — written atomically with the results by
-- record_results — as the source of truth, so explicit "no flags" results
-- (criminalFlag=false, evictionFlag=false) complete the screening. The
-- complete branch below enforces the same rule server-side.
--
-- FINDING 3 (authorization) is fixed in the route layer: screening writes
-- are gated by isOwnerOrActiveCoOwner (primary owner or active co_owner),
-- not merely "not read_only". (The original R22 migration's header comment
-- still names getActiveWorkspaceRole; the contract it states —
-- owner/co-owner write — is what the routes now actually enforce.)
--
-- This is a NEW migration on top of
-- 20261001142000_rental_application_screening.sql (the already-reviewed R22
-- migration is not rewritten). Runs after it: 20261001143000 >
-- 20261001142000, and the only tables touched are created there.
--
-- Security model: security invoker everywhere (the caller's RLS applies —
-- the workspace RPCs run under the authenticated member's JWT, gated by the
-- existing has_workspace_access policies). The applicant RPC is executed by
-- the service-role client and granted to service_role only; its token check
-- is the access control.

create or replace function request_screening(
  p_owner_id text,
  p_application_id text,
  p_token text,
  p_consent_verified_on_application boolean,
  p_consent_recorded boolean,
  p_requested_by text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_app record;
  v_row rental_application_screenings%rowtype;
  v_now timestamptz := now();
  v_actor text := nullif(btrim(coalesce(p_requested_by, '')), '');
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if p_token is null or length(p_token) <> 24 then
    raise exception 'SCREENING_INVALID: a 24-character screening token is required.' using errcode = 'P0001';
  end if;

  -- Fail closed: re-verify the application inside the transaction. The route
  -- performs the same checks for fast 404/409 UX; this is the enforcement
  -- boundary so a direct RPC caller cannot skip them.
  select * into v_app from rental_applications
    where owner_id = effective_owner_id and id = p_application_id;
  if not found then
    raise exception 'SCREENING_INVALID: application was not found.' using errcode = 'P0001';
  end if;
  if v_app.status <> 'pending' then
    raise exception 'SCREENING_CONFLICT: screening can only be requested on a pending application.' using errcode = 'P0001';
  end if;
  if not (coalesce((v_app.answers ->> 'consent') = 'true', false) or coalesce(p_consent_recorded, false)) then
    raise exception 'SCREENING_CONFLICT: applicant screening consent is not recorded.' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from rental_application_screenings
    where owner_id = effective_owner_id and application_id = p_application_id
      and status in ('requested', 'in_progress')
  ) then
    raise exception 'SCREENING_CONFLICT: a screening is already open on this application.' using errcode = 'P0001';
  end if;

  insert into rental_application_screenings (
    owner_id, application_id, status, screening_token,
    consent_verified_on_application, consent_recorded, consent_recorded_at,
    requested_by, requested_at, provider_status
  ) values (
    effective_owner_id, p_application_id, 'requested', p_token,
    coalesce(p_consent_verified_on_application, false),
    coalesce(p_consent_recorded, false),
    case when coalesce(p_consent_recorded, false) then v_now else null end,
    v_actor, v_now, 'not_connected'
  )
  returning * into v_row;

  -- The audit event is appended in the SAME transaction: if this insert
  -- fails, the screening insert above rolls back with it — a screening can
  -- never exist without its 'requested' event.
  insert into rental_screening_events (owner_id, screening_id, application_id, event, actor_user_id, note)
  values (
    effective_owner_id, v_row.id, p_application_id, 'requested', v_actor,
    case when coalesce(p_consent_verified_on_application, false)
      then 'Consent verified on the application.'
      else 'Consent previously recorded via the applicant link.' end
  );

  return to_jsonb(v_row);
exception
  when unique_violation then
    -- The partial unique index on open screenings is the last line of
    -- defense against two concurrent requests for the same application.
    raise exception 'SCREENING_CONFLICT: a screening is already open on this application.' using errcode = 'P0001';
end;
$$;

create or replace function transition_screening(
  p_owner_id text,
  p_screening_id text,
  p_action text,
  p_actor_user_id text,
  p_payload jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_row rental_application_screenings%rowtype;
  v_now timestamptz := now();
  v_event text;
  v_note text := null;
  v_actor text := nullif(btrim(coalesce(p_actor_user_id, '')), '');
  v_credit_score integer;
  v_credit_band text;
  v_token text;
  v_recommendation text;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Serialize competing transitions on the same screening: the row lock is
  -- held until commit, so two concurrent transitions cannot interleave and
  -- the status-machine check below always sees the latest committed state.
  select * into v_row from rental_application_screenings
    where owner_id = effective_owner_id and id = p_screening_id
    for update;
  if not found then
    raise exception 'SCREENING_INVALID: screening was not found.' using errcode = 'P0001';
  end if;

  if p_action = 'mark_in_progress' then
    if v_row.status <> 'requested' then
      raise exception 'SCREENING_CONFLICT: cannot mark in-progress from status "%".', v_row.status using errcode = 'P0001';
    end if;
    update rental_application_screenings
      set status = 'in_progress', updated_at = v_now
      where owner_id = effective_owner_id and id = p_screening_id;
    v_event := 'marked_in_progress';

  elsif p_action = 'record_results' then
    if v_row.status not in ('requested', 'in_progress') then
      raise exception 'SCREENING_CONFLICT: results cannot be recorded on a "%" screening.', v_row.status using errcode = 'P0001';
    end if;
    -- Server-side floor validation. The route performs the full validation;
    -- this keeps direct RPC callers honest without duplicating the validator.
    v_credit_score := nullif(p_payload ->> 'credit_score', '')::integer;
    if v_credit_score is not null and (v_credit_score < 300 or v_credit_score > 850) then
      raise exception 'SCREENING_INVALID: credit score must be between 300 and 850.' using errcode = 'P0001';
    end if;
    v_credit_band := nullif(p_payload ->> 'credit_band', '');
    if v_credit_band is not null and v_credit_band not in ('poor', 'fair', 'good', 'very_good', 'excellent') then
      raise exception 'SCREENING_INVALID: credit band is not recognized.' using errcode = 'P0001';
    end if;
    update rental_application_screenings set
      credit_score = v_credit_score,
      credit_band = v_credit_band,
      criminal_flag = coalesce((p_payload ->> 'criminal_flag')::boolean, false),
      criminal_notes = nullif(p_payload ->> 'criminal_notes', ''),
      eviction_flag = coalesce((p_payload ->> 'eviction_flag')::boolean, false),
      eviction_notes = nullif(p_payload ->> 'eviction_notes', ''),
      results_recorded_by = v_actor,
      -- Written atomically with the results: this timestamp is the source
      -- of truth for "results were recorded" (finding 2).
      results_recorded_at = v_now,
      updated_at = v_now
    where owner_id = effective_owner_id and id = p_screening_id;
    v_event := 'results_recorded';

  elsif p_action = 'set_recommendation' then
    v_recommendation := nullif(p_payload ->> 'recommendation', '');
    if v_recommendation not in ('approve', 'conditional', 'deny') then
      raise exception 'SCREENING_INVALID: recommendation must be approve, conditional, or deny.' using errcode = 'P0001';
    end if;
    update rental_application_screenings set
      recommendation = v_recommendation,
      recommendation_reasons = nullif(p_payload ->> 'reasons', ''),
      updated_at = v_now
    where owner_id = effective_owner_id and id = p_screening_id;
    v_event := 'recommendation_set';
    v_note := 'Recommendation: ' || v_recommendation || '.';

  elsif p_action = 'complete' then
    if v_row.status not in ('requested', 'in_progress') then
      raise exception 'SCREENING_CONFLICT: cannot complete a "%" screening.', v_row.status using errcode = 'P0001';
    end if;
    -- results_recorded_at is written atomically with the results, so it is
    -- the source of truth (an explicit "no flags" result still completes).
    -- The legacy value check covers results recorded before the atomic
    -- write existed.
    if v_row.results_recorded_at is null
       and v_row.credit_score is null and v_row.credit_band is null
       and v_row.criminal_notes is null and v_row.eviction_notes is null
       and not coalesce(v_row.criminal_flag, false)
       and not coalesce(v_row.eviction_flag, false) then
      raise exception 'SCREENING_CONFLICT: record manual results before completing the screening.' using errcode = 'P0001';
    end if;
    update rental_application_screenings set
      status = 'complete', completed_by = v_actor, completed_at = v_now, updated_at = v_now
    where owner_id = effective_owner_id and id = p_screening_id;
    v_event := 'completed';

  elsif p_action = 'regenerate_token' then
    v_token := p_payload ->> 'token';
    if v_token is null or length(v_token) <> 24 then
      raise exception 'SCREENING_INVALID: a 24-character screening token is required.' using errcode = 'P0001';
    end if;
    update rental_application_screenings set
      screening_token = v_token, updated_at = v_now
    where owner_id = effective_owner_id and id = p_screening_id;
    v_event := 'token_regenerated';

  elsif p_action = 'provider_attempt_blocked' then
    -- No screening mutation: the blocked provider attempt is itself the
    -- audited action. It still goes through this RPC so the audit write is
    -- never separated from the action it records.
    v_event := 'provider_attempt_blocked';
    v_note := 'Provider pull attempted for "' || coalesce(nullif(p_payload ->> 'provider_key', ''), 'unknown')
      || '" — blocked: providers are not connected (needs Jason''s word).';

  else
    raise exception 'SCREENING_INVALID: unknown screening action.' using errcode = 'P0001';
  end if;

  -- The audit event is appended in the SAME transaction as the mutation
  -- above: a transition can never commit without its event.
  insert into rental_screening_events (owner_id, screening_id, application_id, event, actor_user_id, note)
  values (effective_owner_id, p_screening_id, v_row.application_id, v_event, v_actor, v_note);

  select * into v_row from rental_application_screenings
    where owner_id = effective_owner_id and id = p_screening_id;
  return to_jsonb(v_row);
end;
$$;

create or replace function record_applicant_screening_info(
  p_token text,
  p_consent_text text,
  p_applicant_provided jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_row rental_application_screenings%rowtype;
  v_now timestamptz := now();
begin
  -- The 24-char random token is the authorization: the no-login applicant
  -- link is scoped to exactly one screening. Called with the service-role
  -- client (RLS bypassed); the token lookup below is the access control, and
  -- the row lock serializes concurrent submissions on the same link.
  select * into v_row from rental_application_screenings
    where screening_token = p_token
    for update;
  if not found then
    raise exception 'SCREENING_NOT_FOUND: this screening link is not valid.' using errcode = 'P0001';
  end if;
  if v_row.status not in ('requested', 'in_progress') then
    raise exception 'SCREENING_CLOSED: this screening is closed.' using errcode = 'P0001';
  end if;

  update rental_application_screenings set
    consent_recorded = true,
    consent_recorded_at = v_now,
    consent_text_shown = left(nullif(p_consent_text, ''), 4000),
    applicant_provided = coalesce(p_applicant_provided, '{}'::jsonb),
    updated_at = v_now
  where owner_id = v_row.owner_id and id = v_row.id;

  -- Both audit events are appended in the SAME transaction as the consent
  -- update: consent can never be recorded without its audit trail.
  insert into rental_screening_events (owner_id, screening_id, application_id, event, actor_user_id, note)
  values
    (v_row.owner_id, v_row.id, v_row.application_id, 'consent_recorded', null,
     'Applicant confirmed screening consent through the link.'),
    (v_row.owner_id, v_row.id, v_row.application_id, 'applicant_info_received', null,
     'Applicant submitted screening info through the link.');

  return jsonb_build_object(
    'status', v_row.status,
    'consent_recorded', true,
    'info_received', coalesce(p_applicant_provided, '{}'::jsonb) <> '{}'::jsonb
  );
end;
$$;

-- Least privilege: the workspace RPCs run under the authenticated member's
-- JWT (their RLS policies apply); the applicant RPC is service-role only and
-- its token check is the access control.
revoke all on function request_screening(text, text, text, boolean, boolean, text) from public;
grant execute on function request_screening(text, text, text, boolean, boolean, text) to authenticated;
revoke all on function transition_screening(text, text, text, text, jsonb) from public;
grant execute on function transition_screening(text, text, text, text, jsonb) to authenticated;
revoke all on function record_applicant_screening_info(text, text, jsonb) from public;
grant execute on function record_applicant_screening_info(text, text, jsonb) to service_role;
