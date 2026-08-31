-- SF-4: generic, atomic historical Private Financing import boundary.
-- This migration creates no account and imports no customer data by itself.
-- The authenticated owner must separately call the RPC with an owner-approved preview plan.

create table if not exists public.private_financing_import_batches (
    owner_id text not null,
    source_key text not null,
    account_id text not null,
    plan_digest text not null check (plan_digest ~ '^[0-9a-f]{64}$'),
    payment_event_count integer not null check (payment_event_count >= 0),
    credit_event_count integer not null check (credit_event_count >= 0),
    created_by text not null,
    created_at timestamptz not null default now(),
    primary key (owner_id, source_key),
    foreign key (owner_id, account_id)
      references public.private_financing_accounts(owner_id, id)
      on delete restrict
);

alter table public.private_financing_import_batches enable row level security;
alter table public.private_financing_import_batches force row level security;

create policy "private_financing_import_batches_owner_select"
on public.private_financing_import_batches
for select to authenticated
using (public.has_workspace_access(owner_id));

revoke all on public.private_financing_import_batches from anon;
revoke insert, update, delete on public.private_financing_import_batches from authenticated;
grant select on public.private_financing_import_batches to authenticated;

create or replace function public.import_private_financing_historical_account(
    p_owner_id text,
    p_source_key text,
    p_account jsonb,
    p_payments jsonb,
    p_principal_credits jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_existing public.private_financing_import_batches%rowtype;
    v_account public.private_financing_accounts%rowtype;
    v_payment jsonb;
    v_credit jsonb;
    v_event public.private_financing_events%rowtype;
    v_payment_count integer := 0;
    v_credit_count integer := 0;
    v_plan_digest text;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if not public.has_workspace_access(p_owner_id) then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_source_key is null or btrim(p_source_key) = '' then
        raise exception 'source_key is required.' using errcode = '22023';
    end if;
    if p_account is null or jsonb_typeof(p_account) <> 'object' then
        raise exception 'account must be a JSON object.' using errcode = '22023';
    end if;
    if p_payments is null or jsonb_typeof(p_payments) <> 'array' or jsonb_array_length(p_payments) = 0 then
        raise exception 'payments must be a non-empty JSON array.' using errcode = '22023';
    end if;
    if p_principal_credits is null or jsonb_typeof(p_principal_credits) <> 'array' then
        raise exception 'principal_credits must be a JSON array.' using errcode = '22023';
    end if;

    v_plan_digest := encode(
        extensions.digest(convert_to(p_account::text || '|' || p_payments::text || '|' || p_principal_credits::text, 'UTF8'), 'sha256'),
        'hex'
    );

    -- Serialize retries for this exact owner/source pair without blocking imports for other accounts.
    perform pg_advisory_xact_lock(hashtextextended(p_owner_id || ':' || p_source_key, 0));

    select * into v_existing
      from public.private_financing_import_batches
     where owner_id = p_owner_id and source_key = p_source_key;

    if v_existing.source_key is not null then
        if v_existing.plan_digest <> v_plan_digest then
            raise exception 'source_key already belongs to a different historical import plan.'
                using errcode = '23505';
        end if;
        return jsonb_build_object(
            'status', 'already_imported',
            'accountId', v_existing.account_id,
            'paymentEventCount', v_existing.payment_event_count,
            'creditEventCount', v_existing.credit_event_count
        );
    end if;

    v_account := public.open_private_financing_account(
        p_owner_id := p_owner_id,
        p_product := p_account->>'product',
        p_opened_date := (p_account->>'openedDate')::date,
        p_late_fee_policy := p_account->>'lateFeePolicy',
        p_platform_fee_cents := (p_account->>'platformFeeCents')::integer,
        p_fee_payer := p_account->>'feePayer',
        p_payment_acceptance_policy := p_account->>'paymentAcceptancePolicy',
        p_components := p_account->'components',
        p_payment_frequency := p_account->>'paymentFrequency',
        p_first_payment_due_date := (p_account->>'firstPaymentDueDate')::date,
        p_regular_scheduled_payment_amount_cents := (p_account->>'regularScheduledPaymentAmountCents')::bigint,
        p_allocation_policy := p_account->>'allocationPolicy',
        p_extra_payment_allocation_policy := p_account->>'extraPaymentAllocationPolicy',
        p_prepayment_policy := p_account->>'prepaymentPolicy',
        p_day_count_convention := p_account->>'dayCountConvention',
        p_maturity_date := nullif(p_account->>'maturityDate', '')::date
    );

    for v_payment in
        select value from jsonb_array_elements(p_payments)
        order by (value->>'ledgerOrder')::integer
    loop
        v_event := public.append_private_financing_event(
            p_owner_id := p_owner_id,
            p_account_id := v_account.id,
            p_event_type := 'payment_posted',
            p_event_origin := 'manual_import',
            p_effective_date := (v_payment->>'effectiveDate')::date,
            p_source_reference := v_payment->>'sourceReference',
            p_idempotency_key := p_source_key || ':payment:' || (v_payment->>'ledgerOrder'),
            p_reason := 'Owner-approved historical payment import',
            p_borrower_visible_explanation := 'Historical payment recorded from the seller-provided payment history.',
            p_amount_cents := (v_payment->>'amountCents')::bigint,
            p_interest_paid_by_component_cents := v_payment->'interestPaidByComponentCents',
            p_principal_paid_by_component_cents := v_payment->'principalPaidByComponentCents',
            p_unallocated_cents := (v_payment->>'unallocatedCents')::bigint,
            p_principal_remaining_by_component_cents := v_payment->'principalRemainingByComponentCents'
        );
        v_payment_count := v_payment_count + 1;
    end loop;

    for v_credit in
        select value from jsonb_array_elements(p_principal_credits)
        order by (value->>'ledgerOrder')::integer
    loop
        v_event := public.append_private_financing_event(
            p_owner_id := p_owner_id,
            p_account_id := v_account.id,
            p_event_type := 'principal_correction',
            p_event_origin := 'manual_import',
            p_effective_date := (v_credit->>'effectiveDate')::date,
            p_source_reference := v_credit->>'sourceReference',
            p_idempotency_key := p_source_key || ':credit:' || (v_credit->>'ledgerOrder'),
            p_reason := v_credit->>'reason',
            p_borrower_visible_explanation := v_credit->>'borrowerVisibleExplanation',
            p_component_id := v_credit->>'componentId',
            p_correction_basis := v_credit->>'correctionBasis',
            p_delta_cents := -((v_credit->>'amountCents')::bigint),
            p_corrected_component_principal_remaining_cents_after :=
                (v_credit->>'correctedComponentPrincipalRemainingCentsAfter')::bigint
        );
        v_credit_count := v_credit_count + 1;
    end loop;

    insert into public.private_financing_import_batches (
        owner_id, source_key, account_id, plan_digest, payment_event_count, credit_event_count, created_by
    ) values (
        p_owner_id, p_source_key, v_account.id, v_plan_digest, v_payment_count, v_credit_count,
        v_authenticated_user::text
    );

    return jsonb_build_object(
        'status', 'imported',
        'accountId', v_account.id,
        'paymentEventCount', v_payment_count,
        'creditEventCount', v_credit_count,
        'finalLedgerSequence', 1 + v_payment_count + v_credit_count
    );
end;
$$;

revoke all on function public.import_private_financing_historical_account(
    text, text, jsonb, jsonb, jsonb
) from public;
grant execute on function public.import_private_financing_historical_account(
    text, text, jsonb, jsonb, jsonb
) to authenticated;
