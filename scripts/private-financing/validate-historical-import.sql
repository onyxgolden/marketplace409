\set ON_ERROR_STOP on

-- Disposable local validation only. Run after a fresh local Supabase reset.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select public.import_private_financing_historical_account(
  '11111111-1111-1111-1111-111111111111',
  'validation-history-1',
  '{
    "product":"personal_loan",
    "openedDate":"2026-01-01",
    "lateFeePolicy":"disabled",
    "platformFeeCents":0,
    "feePayer":"lender",
    "paymentAcceptancePolicy":"partial_allowed",
    "components":[
      {"componentKey":"primary","label":"Primary","originalPrincipalCents":100000,"rateBps":0,"dayCountConvention":"actual_365","scheduledComponentAmountCents":5000,"allocationPriority":1},
      {"componentKey":"secondary","label":"Secondary","originalPrincipalCents":20000,"rateBps":0,"dayCountConvention":"actual_365","scheduledComponentAmountCents":1000,"allocationPriority":2}
    ],
    "paymentFrequency":"monthly",
    "firstPaymentDueDate":"2026-02-01",
    "regularScheduledPaymentAmountCents":6000,
    "allocationPolicy":"scheduled_component_order",
    "extraPaymentAllocationPolicy":"highest_rate_first_extra",
    "prepaymentPolicy":"allowed_without_penalty_does_not_advance_due_date",
    "dayCountConvention":"actual_365"
  }'::jsonb,
  '[
    {"ledgerOrder":1,"effectiveDate":"2026-02-01","sourceReference":"history-1","amountCents":6000,"interestPaidByComponentCents":{},"principalPaidByComponentCents":{"primary":5000,"secondary":1000},"unallocatedCents":0,"principalRemainingByComponentCents":{"primary":95000,"secondary":19000}},
    {"ledgerOrder":2,"effectiveDate":"2026-03-01","sourceReference":"history-2","amountCents":1000,"interestPaidByComponentCents":{},"principalPaidByComponentCents":{"primary":1000},"unallocatedCents":0,"principalRemainingByComponentCents":{"primary":94000,"secondary":19000}}
  ]'::jsonb,
  '[
    {"ledgerOrder":3,"effectiveDate":"2026-03-01","sourceReference":"credit-1","componentId":"primary","amountCents":500,"correctionBasis":"discretionary_concession","correctedComponentPrincipalRemainingCentsAfter":93500,"reason":"Validation credit","borrowerVisibleExplanation":"One-time lender credit."}
  ]'::jsonb
) as first_result
\gset

\echo First result: :first_result

reset role;
do $validation$
declare
  b public.private_financing_import_batches%rowtype;
  event_count integer;
  next_seq bigint;
  final_primary bigint;
begin
  select * into b from public.private_financing_import_batches
   where owner_id = '11111111-1111-1111-1111-111111111111' and source_key = 'validation-history-1';
  select count(*), max(ledger_sequence) into event_count, next_seq
    from public.private_financing_events where account_id = b.account_id;
  select corrected_component_principal_remaining_cents_after into final_primary
    from public.private_financing_events
   where account_id = b.account_id and event_type = 'principal_correction';
  if b.payment_event_count <> 2 or b.credit_event_count <> 1
     or event_count <> 4 or next_seq <> 4 or final_primary <> 93500 then
    raise exception 'Imported history assertion failed.';
  end if;
  raise notice 'PASS: account, two payments, and one credit imported atomically with sequences 1-4';
end;
$validation$;

set role authenticated;
select public.import_private_financing_historical_account(
  '11111111-1111-1111-1111-111111111111',
  'validation-history-1',
  '{}'::jsonb,
  '[]'::jsonb,
  '[]'::jsonb
) as retry_result
\gset
reset role;

do $validation$
declare account_count integer; batch_count integer;
begin
  select count(*) into account_count from public.private_financing_accounts
   where owner_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into batch_count from public.private_financing_import_batches
   where owner_id = '11111111-1111-1111-1111-111111111111';
  if account_count <> 1 or batch_count <> 1 then
    raise exception 'Exact retry duplicated the import.';
  end if;
  raise notice 'PASS: exact source-key retry returned the existing account without duplication';
end;
$validation$;

create temporary table before_failed_import(account_count integer, batch_count integer);
insert into before_failed_import
select
  (select count(*) from public.private_financing_accounts),
  (select count(*) from public.private_financing_import_batches);

set role authenticated;
do $failed$
begin
  begin
    perform public.import_private_financing_historical_account(
      '11111111-1111-1111-1111-111111111111',
      'validation-history-bad',
      '{
        "product":"personal_loan","openedDate":"2026-01-01","lateFeePolicy":"disabled",
        "platformFeeCents":0,"feePayer":"lender","paymentAcceptancePolicy":"partial_allowed",
        "components":[{"componentKey":"primary","label":"Primary","originalPrincipalCents":100000,"rateBps":0,"dayCountConvention":"actual_365","scheduledComponentAmountCents":5000,"allocationPriority":1}],
        "paymentFrequency":"monthly","firstPaymentDueDate":"2026-02-01",
        "regularScheduledPaymentAmountCents":5000,"allocationPolicy":"scheduled_component_order",
        "extraPaymentAllocationPolicy":"highest_rate_first_extra",
        "prepaymentPolicy":"allowed_without_penalty_does_not_advance_due_date","dayCountConvention":"actual_365"
      }'::jsonb,
      '[{"ledgerOrder":1,"effectiveDate":"2026-02-01","sourceReference":"bad","amountCents":5000,"interestPaidByComponentCents":{},"principalPaidByComponentCents":{"primary":4000},"unallocatedCents":0,"principalRemainingByComponentCents":{"primary":96000}}]'::jsonb,
      '[]'::jsonb
    );
    raise exception 'Expected invalid allocation to fail.';
  exception
    when sqlstate '22023' then null;
  end;
end;
$failed$;
reset role;

do $validation$
declare before_accounts integer; before_batches integer; after_accounts integer; after_batches integer;
begin
  select account_count, batch_count into before_accounts, before_batches from before_failed_import;
  select count(*) into after_accounts from public.private_financing_accounts;
  select count(*) into after_batches from public.private_financing_import_batches;
  if before_accounts <> after_accounts or before_batches <> after_batches then
    raise exception 'Failed import left partial account or batch rows.';
  end if;
  raise notice 'PASS: invalid event rolled back the entire account import';
end;
$validation$;
