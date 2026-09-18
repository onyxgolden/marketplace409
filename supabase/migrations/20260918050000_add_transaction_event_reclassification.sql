-- Fixes existing raw bank-feed (source_system='transaction') rows that predate the
-- correctRawBankFeedDirection.js / classifyTransferPairs.js fixes: a real deposit mis-signed and
-- mis-kinded as a negative expense, or an internal transfer / owner distribution never recognized
-- as such at all (both landed as generic 'other'/'expense'). No CHECK constraint exists on
-- financial_events.transaction_kind or .normalized_category (free text), and 'transfer' is already
-- a valid ForgeTransactionKind (knowledge.types.ts) -- this migration adds no new enum values, only
-- the RPC that lets a human-reviewed correction actually get applied to one row at a time.
--
-- No RLS policy changes needed: same reasoning as 20260918040000_add_financial_event_duplicate_link
-- -- the existing owner-scoped UPDATE policy only allows direct client updates to source_system =
-- 'manual' rows, so this needs a SECURITY DEFINER function exactly like that migration's
-- mark_financial_event_as_duplicate().
--
-- Deliberately narrow and non-destructive: this RPC can only change transaction_kind,
-- normalized_category, tax_deductible, and affects_noi on a 'transaction'-sourced row, and can only
-- change the amount's SIGN (never its magnitude -- p_amount must equal the row's current
-- abs(amount) within half a cent), so it can never be used to alter what a transaction was actually
-- for financially, only how it's classified.
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
    if p_amount is null or p_amount <= 0 then
        raise exception 'amount must be a positive number.' using errcode = '22023';
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
    if abs(p_amount - abs(v_current_amount)) > 0.005 then
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
