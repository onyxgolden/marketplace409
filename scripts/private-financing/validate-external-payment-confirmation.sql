\set ON_ERROR_STOP on

-- Disposable local validation only. Run after a fresh local Supabase reset.
set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select (open_private_financing_account(
  p_owner_id := '11111111-1111-1111-1111-111111111111',
  p_product := 'personal_loan',
  p_opened_date := '2026-01-01',
  p_late_fee_policy := 'disabled',
  p_platform_fee_cents := 0,
  p_fee_payer := 'lender',
  p_payment_acceptance_policy := 'partial_allowed',
  p_components := '[
    {"componentKey":"primary","label":"Primary","originalPrincipalCents":100000,"rateBps":0,"dayCountConvention":"actual_365","scheduledComponentAmountCents":5000,"allocationPriority":1},
    {"componentKey":"secondary","label":"Secondary","originalPrincipalCents":20000,"rateBps":0,"dayCountConvention":"actual_365","scheduledComponentAmountCents":1000,"allocationPriority":2}
  ]'::jsonb,
  p_payment_frequency := 'monthly',
  p_first_payment_due_date := '2026-02-01',
  p_regular_scheduled_payment_amount_cents := 6000,
  p_allocation_policy := 'scheduled_component_order',
  p_extra_payment_allocation_policy := 'highest_rate_first_extra',
  p_prepayment_policy := 'allowed_without_penalty_does_not_advance_due_date',
  p_day_count_convention := 'actual_365'
)).id as account_id
\gset

\echo Created disposable account :account_id

create temporary table external_payload(payload jsonb) on commit preserve rows;
insert into external_payload values ('{
  "p_event_type":"payment_posted","p_event_origin":"manual_external",
  "p_effective_date":"2026-02-01","p_source_reference":"VENMO-VALIDATION-1",
  "p_amount_cents":6000,"p_interest_paid_by_component_cents":{},
  "p_principal_paid_by_component_cents":{"primary":5000,"secondary":1000},
  "p_unallocated_cents":0,
  "p_principal_remaining_by_component_cents":{"primary":95000,"secondary":19000},
  "p_selected_extra_component_id":null,"p_payment_method":"venmo",
  "p_external_evidence_reference":"private://receipt-1",
  "p_reason":"Seller confirmed receipt","p_internal_note":"Private note",
  "p_borrower_visible_explanation":"Payment received."
}'::jsonb);

select (confirm_private_financing_external_payment(
  '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'), 1,
  (select payload from external_payload)
)).ledger_sequence as posted_sequence;

reset role;
do $validation$
declare v private_financing_events%rowtype; n bigint;
begin
  select * into v from private_financing_events
   where account_id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111') and idempotency_key = 'manual_external:venmo:VENMO-VALIDATION-1';
  select next_ledger_sequence into n from private_financing_accounts where id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111');
  if v.ledger_sequence <> 2 or n <> 3
     or v.created_by <> '11111111-1111-1111-1111-111111111111'
     or v.principal_paid_by_component_cents <> '{"primary":5000,"secondary":1000}'::jsonb then
    raise exception 'Initial payment assertion failed.';
  end if;
  raise notice 'PASS: seller payment posted with actor, provenance, allocation, and sequence';
end;
$validation$;

set role authenticated;
select (confirm_private_financing_external_payment(
  '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'), 1,
  (select payload from external_payload)
)).ledger_sequence as retry_sequence;
reset role;

do $validation$
declare c integer; n bigint;
begin
  select count(*) into c from private_financing_events
   where account_id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111') and idempotency_key = 'manual_external:venmo:VENMO-VALIDATION-1';
  select next_ledger_sequence into n from private_financing_accounts where id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111');
  if c <> 1 or n <> 3 then raise exception 'Retry assertion failed.'; end if;
  raise notice 'PASS: exact retry returned existing event without duplication';
end;
$validation$;

set role authenticated;
do $validation$
begin
  begin
    perform confirm_private_financing_external_payment(
      '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'), 2,
      jsonb_set((select payload from external_payload), '{p_amount_cents}', '7000'::jsonb)
    );
    raise exception 'Expected reference conflict';
  exception when unique_violation then
    raise notice 'PASS: changed facts cannot reuse a source reference';
  end;
end;
$validation$;

do $validation$
begin
  begin
    perform confirm_private_financing_external_payment(
      '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'), 1,
      jsonb_set((select payload from external_payload), '{p_source_reference}', '"STALE-2"'::jsonb)
    );
    raise exception 'Expected stale rejection';
  exception when serialization_failure then
    raise notice 'PASS: stale preview rejected';
  end;
end;
$validation$;

select (append_private_financing_servicing_policy_version(
  '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'),
  'full_amount_or_more', now() + interval '1 second',
  'Validate full-payment rule'
)).version as policy_version;
reset role;

create temporary table partial_payload(payload jsonb) on commit preserve rows;
insert into partial_payload values ('{
  "p_event_type":"payment_posted","p_event_origin":"manual_external",
  "p_effective_date":"2026-03-01","p_source_reference":"CASHAPP-PARTIAL-1",
  "p_amount_cents":1000,"p_interest_paid_by_component_cents":{},
  "p_principal_paid_by_component_cents":{"primary":1000},"p_unallocated_cents":0,
  "p_principal_remaining_by_component_cents":{"primary":94000,"secondary":19000},
  "p_selected_extra_component_id":null,"p_payment_method":"cash_app",
  "p_external_evidence_reference":null,"p_reason":"Partial payment already received",
  "p_internal_note":null,"p_borrower_visible_explanation":"Partial payment received."
}'::jsonb);
grant select on partial_payload to authenticated;

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);
select (confirm_private_financing_external_payment(
  '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'), 2,
  (select payload from partial_payload)
)).ledger_sequence as partial_sequence;
reset role;

do $validation$
declare p text; c integer; n bigint;
begin
  select payment_acceptance_policy into p from private_financing_servicing_policy_versions
   where account_id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111') order by version desc limit 1;
  select count(*) into c from private_financing_events
   where account_id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111') and source_reference = 'CASHAPP-PARTIAL-1';
  select next_ledger_sequence into n from private_financing_accounts where id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111');
  if p <> 'full_amount_or_more' or c <> 1 or n <> 4 then
    raise exception 'Policy/external-payment separation failed.';
  end if;
  raise notice 'PASS: full-payment online rule does not hide a smaller external receipt';
end;
$validation$;

set role authenticated;
select set_config('request.jwt.claim.sub', '22222222-2222-2222-2222-222222222222', false);
do $validation$
begin
  begin
    perform confirm_private_financing_external_payment(
      '11111111-1111-1111-1111-111111111111', (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111'), 3,
      jsonb_set((select payload from partial_payload), '{p_source_reference}', '"FORGED-1"'::jsonb)
    );
    raise exception 'Expected borrower denial';
  exception when insufficient_privilege then
    raise notice 'PASS: borrower/unrelated identity cannot record a payment';
  end;
end;
$validation$;
reset role;

do $validation$
declare c integer; n bigint;
begin
  select count(*) into c from private_financing_events
   where account_id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111') and source_reference = 'FORGED-1';
  select next_ledger_sequence into n from private_financing_accounts where id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111');
  if c <> 0 or n <> 4 then raise exception 'Denied attempt changed ledger.'; end if;
  raise notice 'PASS: denied attempt left ledger and sequence unchanged';
end;
$validation$;

select ledger_sequence, event_origin, amount_cents, payment_method, source_reference,
       principal_paid_by_component_cents, principal_remaining_by_component_cents
  from private_financing_events where account_id = (select id from private_financing_accounts where owner_id = '11111111-1111-1111-1111-111111111111') order by ledger_sequence;
