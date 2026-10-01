-- Rentec parity R26 follow-up: ChatGPT NO-GO findings on PR #531.
--
-- Finding 1 (blocking accounting/workflow defect): one-click apply allowed
-- receiptCents > billBalance, recorded a vendor payment for only billBalance,
-- then marked the ENTIRE receipt status='applied'. The unapplied remainder
-- disappeared from the receipt workflow ($300 receipt vs $250 bill -> $250
-- paid, receipt fully applied, $50 neither allocated nor visible). Required
-- fix: until true split allocation exists, the one-click whole-receipt apply
-- requires receiptCents === billBalance, with a clear split-required error
-- for either direction of mismatch.
--
-- Finding 2 (correctness): record_vendor_payment committed in its own RPC
-- transaction and the rental_receipts status/link update was a separate
-- request. If the update failed, the endpoint reported 500 while the real
-- payment and ledger events had already committed. Required fix: make
-- payment + receipt application one atomic database operation.
--
-- This migration adds apply_receipt_to_bill: one RPC, one transaction. It
-- locks the receipt row first (competing applies serialize; the loser sees
-- status <> 'inbox'), re-validates everything under the lock, enforces the
-- exact-match rule at the database boundary, invokes the VALIDATED R4
-- record_vendor_payment logic (not a fork of it) with amounts normalized from
-- the locked bill, then updates the receipt linkage — all commit together or
-- nothing commits. The route keeps its application-level prechecks for fast
-- UX failures; this RPC is the enforcer.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

create or replace function apply_receipt_to_bill(p_owner_id text, p_receipt_id text, p_payment jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_receipt_id text := nullif(btrim(p_receipt_id), '');
  v_receipt rental_receipts%rowtype;
  v_apps jsonb := coalesce(p_payment -> 'applications', '[]'::jsonb);
  v_bill_id text;
  v_bill rental_vendor_bills%rowtype;
  v_balance bigint;
  v_payment jsonb;
  v_result jsonb;
  v_payment_id text;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_receipt_id is null then
    raise exception 'A receipt id is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_apps) <> 'array' or jsonb_array_length(v_apps) <> 1 then
    raise exception 'Receipt apply takes exactly one bill application.' using errcode = '22023';
  end if;
  v_bill_id := nullif(btrim(v_apps -> 0 ->> 'billId'), '');
  if v_bill_id is null then
    raise exception 'An application bill is required.' using errcode = '22023';
  end if;

  -- Lock the receipt first: competing applies of the same receipt serialize
  -- on this row. The loser blocks until the winner commits, then sees
  -- status <> 'inbox' and is rejected — no double-apply is possible.
  select * into v_receipt from rental_receipts
   where owner_id = effective_owner_id and id = v_receipt_id
   for update;
  if not found then
    raise exception 'Receipt not found.' using errcode = 'P0002';
  end if;
  if v_receipt.status <> 'inbox' then
    raise exception 'Only inbox receipts can be applied.' using errcode = '22023';
  end if;

  -- Lock the bill and recompute its live balance under the lock, so the
  -- exact-match check below cannot race a concurrent payment.
  select * into v_bill from rental_vendor_bills
   where owner_id = effective_owner_id and id = v_bill_id
   for update;
  if not found then
    raise exception 'Bill not found.' using errcode = 'P0002';
  end if;
  if v_bill.status not in ('open', 'partial') then
    raise exception 'Only open bills can be paid.' using errcode = '22023';
  end if;
  if v_receipt.vendor_id is not null and v_receipt.vendor_id <> v_bill.vendor_id then
    raise exception 'The receipt''s vendor does not match this bill''s vendor.' using errcode = '22023';
  end if;

  v_balance := v_bill.amount_cents - coalesce(v_bill.paid_amount_cents, 0);
  if v_balance <= 0 then
    raise exception 'This bill has no remaining balance.' using errcode = '22023';
  end if;

  -- One-click apply is whole-receipt only: until split allocation exists, the
  -- receipt total must EXACTLY equal the bill's remaining balance. Either
  -- direction of mismatch is a clear split-required error — never a silent
  -- partial application that makes the remainder disappear.
  if v_receipt.amount_cents <> v_balance then
    raise exception 'SPLIT_REQUIRED: the receipt total does not equal the bill''s remaining balance. Split application is not supported yet — pay the bill from the vendor payment screen instead; the receipt stays in the inbox.'
      using errcode = '22023';
  end if;

  -- Amounts are normalized from the locked rows (not trusted from the
  -- caller): the payment always equals the live balance, which the
  -- exact-match check above proved equals the receipt total.
  v_payment := p_payment || jsonb_build_object(
    'vendorId', v_bill.vendor_id,
    'amountCents', v_balance,
    'applications', jsonb_build_array(
      jsonb_build_object('billId', v_bill.id, 'amountCents', v_balance)
    )
  );

  -- The validated R4 payment logic runs inside this same transaction:
  -- payment header, applications, ledger events, and bill updates all commit
  -- together with the receipt linkage below, or nothing commits at all.
  v_result := record_vendor_payment(p_owner_id, v_payment);
  v_payment_id := v_result ->> 'paymentId';

  -- Adopt the bill's vendor when the receipt came in as "unknown vendor",
  -- and link the receipt to the bill + payment.
  update rental_receipts
     set vendor_id = coalesce(v_receipt.vendor_id, v_bill.vendor_id),
         vendor_name_hint = null,
         status = 'applied',
         applied_bill_id = v_bill.id,
         applied_payment_id = v_payment_id
   where owner_id = effective_owner_id and id = v_receipt.id;

  return jsonb_build_object(
    'paymentId', v_payment_id,
    'eventIds', coalesce(v_result -> 'eventIds', '[]'::jsonb),
    'receiptId', v_receipt.id,
    'billId', v_bill.id,
    'appliedAmountCents', v_balance
  );
end;
$$;

revoke all on function apply_receipt_to_bill(text, text, jsonb) from public, anon;
grant execute on function apply_receipt_to_bill(text, text, jsonb) to authenticated;
