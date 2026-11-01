-- Controls-sweep follow-up G21 (O-10, O-11): reopen paths for final
-- decisions. NOT YET APPLIED — joins a later approval ask; the code below
-- degrades plainly without it (see the route comments).
--
-- 1. Screening reopen: the events CHECK gains 'reopened', and
--    transition_screening gains a 'reopen' arm (complete -> in_progress,
--    completion stamp cleared, audited as 'reopened'). The function below
--    is the 20261001143000 definition verbatim plus that one arm — no
--    other arm changed.
-- 2. Application reopen: the decisions CHECK gains 'reopened' so the
--    manage route's reopen audit row is accepted. The audit insert runs
--    BEFORE the status flip, so pre-migration the CHECK violation (23514)
--    surfaces as a plain 503 with the status untouched.

alter table rental_screening_events drop constraint if exists rental_screening_events_event_check;
alter table rental_screening_events add constraint rental_screening_events_event_check check (event in (
  'requested', 'marked_in_progress', 'consent_recorded',
  'applicant_info_received', 'results_recorded', 'recommendation_set',
  'provider_attempt_blocked', 'completed', 'token_regenerated', 'reopened'
));

alter table rental_application_decisions drop constraint if exists rental_application_decisions_action_check;
alter table rental_application_decisions add constraint rental_application_decisions_action_check check (action in (
  'approved', 'denied', 'withdrawn', 'reopened'
));

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

  elsif p_action = 'reopen' then
    -- Controls-sweep follow-up G21 (O-10): a completed screening can be
    -- reopened for correction (typo'd score/band/recommendation). Only
    -- from 'complete', back to 'in_progress' so results and recommendation
    -- can be re-recorded and the screening re-completed. The completion
    -- stamp is cleared so the re-completion re-stamps it; recorded results
    -- stay on the row for correction (record_results overwrites them).
    if v_row.status <> 'complete' then
      raise exception 'SCREENING_CONFLICT: cannot reopen a "%" screening.', v_row.status using errcode = 'P0001';
    end if;
    update rental_application_screenings set
      status = 'in_progress', completed_by = null, completed_at = null, updated_at = v_now
      where owner_id = effective_owner_id and id = p_screening_id;
    v_event := 'reopened';
    v_note := 'Screening reopened for correction.'
      || case when nullif(p_payload ->> 'reason', '') is not null
           then ' Reason: ' || nullif(p_payload ->> 'reason', '') else '' end;

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
