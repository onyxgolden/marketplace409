\set ON_ERROR_STOP on

set role authenticated;
select set_config('request.jwt.claim.sub', '11111111-1111-1111-1111-111111111111', false);

select (
  open_private_financing_account(
    p_owner_id := '11111111-1111-1111-1111-111111111111',
    p_product := 'personal_loan',
    p_opened_date := '2026-01-01',
    p_late_fee_policy := 'disabled',
    p_platform_fee_cents := 0,
    p_fee_payer := 'lender',
    p_payment_acceptance_policy := 'partial_allowed',
    p_components := '[
      {"componentKey":"primary","label":"Primary note","originalPrincipalCents":100000,"rateBps":500,"dayCountConvention":"actual_365","scheduledComponentAmountCents":5000,"allocationPriority":1},
      {"componentKey":"secondary","label":"Secondary note","originalPrincipalCents":20000,"rateBps":0,"dayCountConvention":"actual_365","scheduledComponentAmountCents":1000,"allocationPriority":2}
    ]'::jsonb,
    p_payment_frequency := 'monthly',
    p_first_payment_due_date := '2026-02-01',
    p_regular_scheduled_payment_amount_cents := 6000,
    p_allocation_policy := 'scheduled_component_order',
    p_extra_payment_allocation_policy := 'highest_rate_first_extra',
    p_prepayment_policy := 'allowed_without_penalty_does_not_advance_due_date',
    p_day_count_convention := 'actual_365'
  )
).id as account_id
\gset

\echo Created disposable account :account_id

create temporary table validation_payload(payload jsonb) on commit preserve rows;
insert into validation_payload(payload) values ('[
  {
    "p_event_type":"principal_correction",
    "p_effective_date":"2026-02-01",
    "p_component_id":"primary",
    "p_correction_basis":"discretionary_concession",
    "p_delta_cents":-5000,
    "p_corrected_component_principal_remaining_cents_after":95000,
    "p_reason":"Bring account current",
    "p_borrower_visible_explanation":"A one-time credit was applied."
  },
  {
    "p_event_type":"principal_correction",
    "p_effective_date":"2026-02-01",
    "p_component_id":"secondary",
    "p_correction_basis":"discretionary_concession",
    "p_delta_cents":-1000,
    "p_corrected_component_principal_remaining_cents_after":19000,
    "p_reason":"Bring account current",
    "p_borrower_visible_explanation":"A one-time credit was applied."
  }
]'::jsonb);

select (
  confirm_private_financing_adjustment(
    '11111111-1111-1111-1111-111111111111',
    :'account_id',
    1,
    'generic-bring-current-1',
    (select payload from validation_payload)
  )
).ledger_sequence as final_sequence;

do $$
declare
  v_account_id text;
  v_count integer;
  v_sum bigint;
  v_next bigint;
begin
  select id, next_ledger_sequence into v_account_id, v_next
    from private_financing_accounts
   where owner_id = '11111111-1111-1111-1111-111111111111';

  select count(*), sum(-delta_cents) into v_count, v_sum
    from private_financing_events
   where account_id = v_account_id
     and idempotency_key like 'generic-bring-current-1:%';

  if v_count <> 2 or v_sum <> 6000 or v_next <> 4 then
    raise exception 'Atomic credit assertion failed: count %, sum %, next %', v_count, v_sum, v_next;
  end if;
  raise notice 'PASS: exact 6000-cent credit posted as two consecutive events';
end;
$$;

select (
  confirm_private_financing_adjustment(
    '11111111-1111-1111-1111-111111111111',
    :'account_id',
    1,
    'generic-bring-current-1',
    (select payload from validation_payload)
  )
).ledger_sequence as retry_sequence;

do $$
declare
  v_account_id text;
  v_count integer;
begin
  select id into v_account_id from private_financing_accounts
   where owner_id = '11111111-1111-1111-1111-111111111111';
  select count(*) into v_count from private_financing_events
   where account_id = v_account_id and idempotency_key like 'generic-bring-current-1:%';
  if v_count <> 2 then
    raise exception 'Idempotent retry created duplicates: count %', v_count;
  end if;
  raise notice 'PASS: identical retry returned existing event without duplication';
end;
$$;

do $$
declare
  v_account_id text;
begin
  select id into v_account_id from private_financing_accounts
   where owner_id = '11111111-1111-1111-1111-111111111111';
  begin
    perform confirm_private_financing_adjustment(
      '11111111-1111-1111-1111-111111111111',
      v_account_id,
      1,
      'stale-confirmation',
      '{"p_event_type":"principal_correction","p_effective_date":"2026-02-01","p_component_id":"primary","p_correction_basis":"contractual_administrative","p_delta_cents":-100,"p_corrected_component_principal_remaining_cents_after":94900,"p_reason":"Must be rejected as stale"}'::jsonb
    );
    raise exception 'Expected stale confirmation rejection';
  exception
    when serialization_failure then
      raise notice 'PASS: stale confirmation rejected';
  end;
end;
$$;

do $$
declare
  v_account_id text;
  v_bad_count integer;
  v_next bigint;
begin
  select id into v_account_id from private_financing_accounts
   where owner_id = '11111111-1111-1111-1111-111111111111';
  begin
    perform confirm_private_financing_adjustment(
      '11111111-1111-1111-1111-111111111111',
      v_account_id,
      3,
      'rollback-batch',
      '[
        {"p_event_type":"principal_correction","p_effective_date":"2026-02-02","p_component_id":"primary","p_correction_basis":"contractual_administrative","p_delta_cents":-100,"p_corrected_component_principal_remaining_cents_after":94900,"p_reason":"First event must roll back"},
        {"p_event_type":"principal_correction","p_effective_date":"2026-02-02","p_component_id":"not-a-real-component","p_correction_basis":"contractual_administrative","p_delta_cents":-100,"p_corrected_component_principal_remaining_cents_after":0,"p_reason":"Invalid second event"}
      ]'::jsonb
    );
    raise exception 'Expected invalid-component rejection';
  exception
    when invalid_parameter_value then
      raise notice 'PASS: invalid batch rejected';
  end;

  select count(*) into v_bad_count from private_financing_events
   where account_id = v_account_id and idempotency_key like 'rollback-batch:%';
  select next_ledger_sequence into v_next from private_financing_accounts where id = v_account_id;

  if v_bad_count <> 0 or v_next <> 4 then
    raise exception 'Rollback assertion failed: bad rows %, next %', v_bad_count, v_next;
  end if;
  raise notice 'PASS: entire invalid batch rolled back without burning a sequence';
end;
$$;

select ledger_sequence, component_id, delta_cents,
       corrected_component_principal_remaining_cents_after, idempotency_key
  from private_financing_events
 where account_id = :'account_id'
 order by ledger_sequence;
