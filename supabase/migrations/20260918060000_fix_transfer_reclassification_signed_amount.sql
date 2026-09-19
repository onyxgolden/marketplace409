-- Fix for HELOC transfer sign destruction (2026-09-18).
--
-- Root cause: reclassify_transaction_financial_event required p_amount > 0 for ALL kinds,
-- and POST /api/financial/reconcile-transfers passed p_amount: Math.abs(amount) for every leg.
-- classifyTransferPairs identifies inbound transfer legs by negative sign, so every confirmed
-- transfer pair was written back with both legs positive and could never pair again.
--
-- This migration permits signed p_amount for transaction_kind='transfer' (negative = inbound,
-- positive = outbound), while keeping the positive-only requirement for income/expense.
-- The magnitude guard is preserved: abs(p_amount) must match abs(current amount) within half a cent.

create or replace function reclassify_transaction_financial_event(
    p_owner_id text,
    p_event_id text,
    p_transaction_kind text,
    p_normalized_category text,
    p_amount numeric
)
returns financial_events
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
    v_authenticated_user uuid := auth.uid();
    v_event_source_system text;
    v_current_amount numeric;
    v_row public.financial_events%rowtype;
begin
    if v_authenticated_user is null then
        raise exception 'An authenticated user is required.' using errcode = '42501';
    end if;
    if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> v_authenticated_user::text then
        raise exception 'Owner does not match authenticated workspace.' using errcode = '42501';
    end if;
    if p_event_id is null or btrim(p_event_id) = '' then
        raise exception 'event_id is required.' using errcode = '22023';
    end if;
    if p_transaction_kind not in ('income', 'expense', 'transfer') then
        raise exception 'Unrecognized transaction_kind: %', p_transaction_kind using errcode = '22023';
    end if;
    if p_normalized_category not in ('other', 'owner_distribution', 'internal_transfer') then
        raise exception 'Unrecognized normalized_category: %', p_normalized_category using errcode = '22023';
    end if;
    -- Transfers are the only kind that carries signed direction: negative = inbound leg
    -- (this account received the money), positive = outbound leg. Income/expense are stored
    -- as positive magnitudes with direction in transaction_kind.
    if p_transaction_kind = 'transfer' then
        if p_amount is null or p_amount = 0 then
            raise exception 'amount must be a non-zero signed number for transfers.' using errcode = '22023';
        end if;
    else
        if p_amount is null or p_amount <= 0 then
            raise exception 'amount must be a positive number.' using errcode = '22023';
        end if;
    end if;
    -- A transfer/distribution row is never plain 'other' once reclassified -- 'other' is only valid
    -- alongside a direction-only correction (transaction_kind flips, category stays whatever it was).
    if p_normalized_category in ('owner_distribution', 'internal_transfer') and p_transaction_kind not in ('income', 'expense', 'transfer') then
        raise exception 'owner_distribution/internal_transfer must pair with income, expense, or transfer.' using errcode = '22023';
    end if;

    select source_system, amount into v_event_source_system, v_current_amount
      from public.financial_events
     where id = p_event_id and owner_id = p_owner_id;

    if not found then
        raise exception 'Unknown financial event for this owner.' using errcode = 'P0002';
    end if;
    if v_event_source_system <> 'transaction' then
        raise exception 'Only transaction-sourced events can be reclassified through this function.' using errcode = '22023';
    end if;
    -- Magnitude guard: compare absolute values so a sign-preserving transfer rewrite still passes.
    if abs(abs(p_amount) - abs(v_current_amount)) > 0.005 then
        raise exception 'amount must match this event''s current magnitude -- this function corrects classification, not the dollar value.' using errcode = '22023';
    end if;

    update public.financial_events
       set transaction_kind = p_transaction_kind,
           normalized_category = p_normalized_category,
           amount = p_amount,
           tax_deductible = case when p_normalized_category in ('owner_distribution', 'internal_transfer') then false else tax_deductible end,
           affects_noi = case when p_normalized_category in ('owner_distribution', 'internal_transfer') then false else affects_noi end,
           updated_by = v_authenticated_user::text,
           updated_at = now()
     where id = p_event_id and owner_id = p_owner_id
    returning * into v_row;

    return v_row;
end;
$$;

revoke all on function reclassify_transaction_financial_event(text, text, text, text, numeric) from public;
grant execute on function reclassify_transaction_financial_event(text, text, text, text, numeric) to authenticated;
