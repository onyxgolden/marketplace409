-- Atomic confirmation boundary for seller/lender adjustments.
--
-- The preview token is signed in the application, but the database remains authoritative: this RPC locks
-- the financing account, compares the ledger sequence observed by the preview, and appends the immutable
-- event in the same transaction. A confirmation id is reused as the ledger idempotency key, so concurrent
-- submissions of the same signed preview return the one existing event instead of posting twice.

-- The foundation deliberately forbids caller-supplied idempotency keys on ordinary interactive
-- activity. A signed adjustment confirmation is different: its server-generated confirmation id is the
-- concurrency boundary. Permit that key only on non-cash adjustment/reversal/closure facts; interactive
-- account_opened and payment_posted events remain unable to carry one.
alter table private_financing_events
    drop constraint if exists private_financing_events_check3;
alter table private_financing_events
    add constraint private_financing_events_interactive_confirmation_idempotency_check check (
        event_origin <> 'interactive_user'
        or (
            source_reference is null
            and (
                idempotency_key is null
                or event_type in (
                    'payment_reversal', 'principal_correction', 'interest_correction',
                    'compensating_correction', 'payoff_concession', 'account_closed'
                )
            )
        )
    );

create function confirm_private_financing_adjustment(
    p_owner_id text,
    p_account_id text,
    p_expected_ledger_sequence bigint,
    p_confirmation_id text,
    p_event_payload jsonb
)
returns private_financing_events
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_next_sequence bigint;
    v_existing public.private_financing_events%rowtype;
    v_row public.private_financing_events%rowtype;
    v_payloads jsonb;
    v_payload jsonb;
    v_index integer;
    v_count integer;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_confirmation_id is null or btrim(p_confirmation_id) = '' then
        raise exception 'p_confirmation_id is required.' using errcode = '22023';
    end if;
    if p_event_payload is null or jsonb_typeof(p_event_payload) not in ('object', 'array') then
        raise exception 'p_event_payload must be an event object or a non-empty array of event objects.' using errcode = '22023';
    end if;
    v_payloads := case when jsonb_typeof(p_event_payload) = 'array' then p_event_payload else jsonb_build_array(p_event_payload) end;
    v_count := jsonb_array_length(v_payloads);
    if v_count = 0 then
        raise exception 'p_event_payload must contain at least one event.' using errcode = '22023';
    end if;

    select next_ledger_sequence into v_next_sequence
      from public.private_financing_accounts
     where owner_id = p_owner_id and id = p_account_id
       for update;
    if v_next_sequence is null then
        raise exception 'Financing account was not found.' using errcode = '22023';
    end if;

    select * into v_existing
      from public.private_financing_events
     where owner_id = p_owner_id
       and account_id = p_account_id
       and idempotency_key = case when v_count = 1 then p_confirmation_id else p_confirmation_id || ':' || v_count::text end;
    if v_existing.id is not null then
        return v_existing;
    end if;

    if v_next_sequence - 1 <> p_expected_ledger_sequence then
        raise exception 'The financing ledger changed after preview.'
            using errcode = '40001';
    end if;

    for v_index in 1..v_count
    loop
        v_payload := v_payloads->(v_index - 1);
        if jsonb_typeof(v_payload) <> 'object' then
            raise exception 'Every p_event_payload entry must be an object.' using errcode = '22023';
        end if;
        v_row := append_private_financing_event(
            p_owner_id := p_owner_id,
            p_account_id := p_account_id,
            p_event_type := v_payload->>'p_event_type',
            p_event_origin := 'interactive_user',
            p_effective_date := (v_payload->>'p_effective_date')::date,
            p_source_reference := null,
            p_idempotency_key := case when v_count = 1 then p_confirmation_id else p_confirmation_id || ':' || v_index::text end,
            p_reverses_event_id := v_payload->>'p_reverses_event_id',
            p_reason := v_payload->>'p_reason',
            p_internal_note := v_payload->>'p_internal_note',
            p_borrower_visible_explanation := v_payload->>'p_borrower_visible_explanation',
            p_amount_cents := (v_payload->>'p_amount_cents')::bigint,
            p_interest_paid_by_component_cents := case when jsonb_typeof(v_payload->'p_interest_paid_by_component_cents') = 'object' then v_payload->'p_interest_paid_by_component_cents' else null end,
            p_principal_paid_by_component_cents := case when jsonb_typeof(v_payload->'p_principal_paid_by_component_cents') = 'object' then v_payload->'p_principal_paid_by_component_cents' else null end,
            p_unallocated_cents := (v_payload->>'p_unallocated_cents')::bigint,
            p_principal_remaining_by_component_cents := case when jsonb_typeof(v_payload->'p_principal_remaining_by_component_cents') = 'object' then v_payload->'p_principal_remaining_by_component_cents' else null end,
            p_selected_extra_component_id := v_payload->>'p_selected_extra_component_id',
            p_payment_method := null,
            p_external_evidence_reference := null,
            p_component_id := v_payload->>'p_component_id',
            p_correction_basis := v_payload->>'p_correction_basis',
            p_delta_cents := (v_payload->>'p_delta_cents')::bigint,
            p_corrected_component_principal_remaining_cents_after :=
                (v_payload->>'p_corrected_component_principal_remaining_cents_after')::bigint,
            p_delta_cents_by_component_cents := case when jsonb_typeof(v_payload->'p_delta_cents_by_component_cents') = 'object' then v_payload->'p_delta_cents_by_component_cents' else null end,
            p_closure_reason := v_payload->>'p_closure_reason',
            p_payoff_concession_event_id := v_payload->>'p_payoff_concession_event_id'
        );
    end loop;

    return v_row;
end;
$$;

revoke all on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) from public;
grant execute on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) to authenticated;

comment on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) is
'Atomically verifies a signed-preview ledger sequence and appends one idempotent interactive adjustment.';
