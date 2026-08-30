-- Atomic confirmation boundary for seller-confirmed external payments.
--
-- Unapplied proposal. This function records money the authenticated seller/co-owner confirms has already
-- arrived through Venmo, Cash App, Zelle, PayPal, bank transfer, cash, check, money order, or another
-- external method. It never initiates money movement and is never callable by a borrower identity unless
-- that identity independently has workspace access.

create function confirm_private_financing_external_payment(
    p_owner_id text,
    p_account_id text,
    p_expected_ledger_sequence bigint,
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
    v_payment_method text;
    v_source_reference text;
    v_idempotency_key text;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_event_payload is null or jsonb_typeof(p_event_payload) <> 'object' then
        raise exception 'p_event_payload must be one external-payment event object.' using errcode = '22023';
    end if;
    if p_event_payload->>'p_event_type' <> 'payment_posted'
       or p_event_payload->>'p_event_origin' <> 'manual_external' then
        raise exception 'Only a manual_external payment_posted event may be confirmed here.' using errcode = '22023';
    end if;

    v_payment_method := p_event_payload->>'p_payment_method';
    v_source_reference := nullif(btrim(p_event_payload->>'p_source_reference'), '');
    if v_payment_method not in (
        'venmo', 'cash_app', 'zelle', 'paypal', 'bank_transfer',
        'cash', 'check', 'money_order', 'other'
    ) then
        raise exception 'Unsupported external payment method.' using errcode = '22023';
    end if;
    if v_source_reference is null then
        raise exception 'An external source reference is required.' using errcode = '22023';
    end if;

    -- Derived server-side from normalized provenance, never accepted from the browser.
    v_idempotency_key := 'manual_external:' || v_payment_method || ':' || v_source_reference;

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
       and idempotency_key = v_idempotency_key;

    if v_existing.id is not null then
        -- An exact network retry is safe. Reusing a real-world reference for different facts is not.
        if v_existing.event_type = 'payment_posted'
           and v_existing.event_origin = 'manual_external'
           and v_existing.effective_date = (p_event_payload->>'p_effective_date')::date
           and v_existing.amount_cents = (p_event_payload->>'p_amount_cents')::bigint
           and v_existing.payment_method = v_payment_method
           and v_existing.source_reference = v_source_reference
           and v_existing.interest_paid_by_component_cents =
               p_event_payload->'p_interest_paid_by_component_cents'
           and v_existing.principal_paid_by_component_cents =
               p_event_payload->'p_principal_paid_by_component_cents'
           and v_existing.unallocated_cents =
               (p_event_payload->>'p_unallocated_cents')::bigint
           and v_existing.principal_remaining_by_component_cents =
               p_event_payload->'p_principal_remaining_by_component_cents'
           and v_existing.selected_extra_component_id is not distinct from
               nullif(p_event_payload->>'p_selected_extra_component_id', '')
        then
            return v_existing;
        end if;
        raise exception 'This external payment reference is already attached to a different ledger event.'
            using errcode = '23505';
    end if;

    if v_next_sequence - 1 <> p_expected_ledger_sequence then
        raise exception 'The financing ledger changed after preview.' using errcode = '40001';
    end if;

    v_row := append_private_financing_event(
        p_owner_id := p_owner_id,
        p_account_id := p_account_id,
        p_event_type := 'payment_posted',
        p_event_origin := 'manual_external',
        p_effective_date := (p_event_payload->>'p_effective_date')::date,
        p_source_reference := v_source_reference,
        p_idempotency_key := v_idempotency_key,
        p_reverses_event_id := null,
        p_reason := p_event_payload->>'p_reason',
        p_internal_note := p_event_payload->>'p_internal_note',
        p_borrower_visible_explanation := p_event_payload->>'p_borrower_visible_explanation',
        p_amount_cents := (p_event_payload->>'p_amount_cents')::bigint,
        p_interest_paid_by_component_cents :=
            p_event_payload->'p_interest_paid_by_component_cents',
        p_principal_paid_by_component_cents :=
            p_event_payload->'p_principal_paid_by_component_cents',
        p_unallocated_cents := (p_event_payload->>'p_unallocated_cents')::bigint,
        p_principal_remaining_by_component_cents :=
            p_event_payload->'p_principal_remaining_by_component_cents',
        p_selected_extra_component_id :=
            nullif(p_event_payload->>'p_selected_extra_component_id', ''),
        p_payment_method := v_payment_method,
        p_external_evidence_reference :=
            nullif(btrim(p_event_payload->>'p_external_evidence_reference'), ''),
        p_component_id := null,
        p_correction_basis := null,
        p_delta_cents := null,
        p_corrected_component_principal_remaining_cents_after := null,
        p_delta_cents_by_component_cents := null,
        p_closure_reason := null,
        p_payoff_concession_event_id := null
    );

    return v_row;
end;
$$;

revoke all on function confirm_private_financing_external_payment(text, text, bigint, jsonb) from public;
grant execute on function confirm_private_financing_external_payment(text, text, bigint, jsonb) to authenticated;

comment on function confirm_private_financing_external_payment(text, text, bigint, jsonb) is
'Atomically verifies a signed-preview ledger sequence and records one idempotent seller-confirmed external payment.';
