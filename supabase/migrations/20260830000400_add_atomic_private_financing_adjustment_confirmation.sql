-- Atomic confirmation boundary for seller/lender adjustments.
--
-- The preview token is signed in the application, but the database remains authoritative: this RPC locks
-- the financing account, compares the ledger sequence observed by the preview, and appends the immutable
-- event in the same transaction. A confirmation id is reused as the ledger idempotency key, so concurrent
-- submissions of the same signed preview return the one existing event instead of posting twice.

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
    if p_event_payload is null or jsonb_typeof(p_event_payload) <> 'object' then
        raise exception 'p_event_payload must be an object.' using errcode = '22023';
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
       and idempotency_key = p_confirmation_id;
    if v_existing.id is not null then
        return v_existing;
    end if;

    if v_next_sequence - 1 <> p_expected_ledger_sequence then
        raise exception 'The financing ledger changed after preview.'
            using errcode = '40001';
    end if;

    v_row := append_private_financing_event(
        p_owner_id := p_owner_id,
        p_account_id := p_account_id,
        p_event_type := p_event_payload->>'p_event_type',
        p_event_origin := 'interactive_user',
        p_effective_date := (p_event_payload->>'p_effective_date')::date,
        p_source_reference := null,
        p_idempotency_key := p_confirmation_id,
        p_reverses_event_id := p_event_payload->>'p_reverses_event_id',
        p_reason := p_event_payload->>'p_reason',
        p_internal_note := p_event_payload->>'p_internal_note',
        p_borrower_visible_explanation := p_event_payload->>'p_borrower_visible_explanation',
        p_amount_cents := (p_event_payload->>'p_amount_cents')::bigint,
        p_interest_paid_by_component_cents := p_event_payload->'p_interest_paid_by_component_cents',
        p_principal_paid_by_component_cents := p_event_payload->'p_principal_paid_by_component_cents',
        p_unallocated_cents := (p_event_payload->>'p_unallocated_cents')::bigint,
        p_principal_remaining_by_component_cents := p_event_payload->'p_principal_remaining_by_component_cents',
        p_selected_extra_component_id := p_event_payload->>'p_selected_extra_component_id',
        p_payment_method := null,
        p_external_evidence_reference := null,
        p_component_id := p_event_payload->>'p_component_id',
        p_correction_basis := p_event_payload->>'p_correction_basis',
        p_delta_cents := (p_event_payload->>'p_delta_cents')::bigint,
        p_corrected_component_principal_remaining_cents_after :=
            (p_event_payload->>'p_corrected_component_principal_remaining_cents_after')::bigint,
        p_delta_cents_by_component_cents := p_event_payload->'p_delta_cents_by_component_cents',
        p_closure_reason := p_event_payload->>'p_closure_reason',
        p_payoff_concession_event_id := p_event_payload->>'p_payoff_concession_event_id'
    );

    return v_row;
end;
$$;

revoke all on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) from public;
grant execute on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) to authenticated;

comment on function confirm_private_financing_adjustment(text, text, bigint, text, jsonb) is
'Atomically verifies a signed-preview ledger sequence and appends one idempotent interactive adjustment.';
