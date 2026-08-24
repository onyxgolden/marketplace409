-- Creating a property in Rental Manager (rental_units) never creates anything in Financial FORGE --
-- financial_events only gets rows from explicit writes (Rentec import, rent-payment triggers,
-- manual entries, Simplifi import), none of which fire from mere property creation. This adds a
-- one-time "financial setup" workflow for a property that already exists in Rental Manager: it
-- records acquisition-level facts (purchase, loan, valuation) and writes the corresponding
-- financial_events rows against the SAME property_id -- never a new property record. property_id
-- is deliberately not a foreign key to rental_units: rental_units has no unique constraint on
-- property_id alone (a property can have multiple units), so the RPC validates existence directly.
create table if not exists property_financial_setups (
  id text primary key default ('property_financial_setup_' || gen_random_uuid()::text),
  owner_id text not null,
  property_id text not null,
  financial_account_id text not null references financial_accounts(id) on delete restrict,
  purchase_date date not null,
  purchase_price_cents bigint not null check (purchase_price_cents > 0),
  down_payment_cents bigint not null check (down_payment_cents >= 0 and down_payment_cents <= purchase_price_cents),
  closing_costs_cents bigint not null default 0 check (closing_costs_cents >= 0),
  initial_valuation_cents bigint check (initial_valuation_cents is null or initial_valuation_cents > 0),
  initial_valuation_date date,
  lender_name text,
  loan_original_principal_cents bigint check (loan_original_principal_cents is null or loan_original_principal_cents >= 0),
  loan_origination_date date,
  loan_current_balance_cents bigint check (loan_current_balance_cents is null or loan_current_balance_cents >= 0),
  loan_current_balance_as_of date,
  loan_interest_rate_bps integer check (loan_interest_rate_bps is null or loan_interest_rate_bps between 0 and 10000),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, property_id)
);

create index if not exists idx_property_financial_setups_owner_property
  on property_financial_setups(owner_id, property_id);

alter table property_financial_setups enable row level security;
alter table property_financial_setups force row level security;

create policy property_financial_setups_owner_select on property_financial_setups for select to authenticated
  using (owner_id = auth.uid()::text);

grant select on property_financial_setups to authenticated;

-- Owner-authenticated, idempotent (safe to resubmit -- updates the same setup row and replaces the
-- same set of derived financial_events rows rather than accumulating duplicates on every edit).
-- SECURITY DEFINER because it writes financial_events rows outside the owner-writable 'manual'
-- source_system lane established by 20260824010000_harden_financial_events_trusted_source_provenance.sql.
create or replace function save_property_financial_setup(
  p_owner_id text,
  p_property_id text,
  p_financial_account_id text,
  p_purchase_date date,
  p_purchase_price_cents bigint,
  p_down_payment_cents bigint,
  p_closing_costs_cents bigint,
  p_initial_valuation_cents bigint,
  p_initial_valuation_date date,
  p_lender_name text,
  p_loan_original_principal_cents bigint,
  p_loan_origination_date date,
  p_loan_current_balance_cents bigint,
  p_loan_current_balance_as_of date,
  p_loan_interest_rate_bps integer,
  p_transactions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
set row_security = off
as $$
declare
  v_setup_id text;
  v_transaction jsonb;
  v_index integer;
  v_written integer := 0;
  v_amount_cents bigint;
  v_capitalized boolean;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if p_owner_id is distinct from auth.uid()::text then raise exception 'Setup owner does not match authenticated owner.'; end if;
  if nullif(trim(p_property_id), '') is null then raise exception 'A property is required.'; end if;
  if not exists (select 1 from rental_units where owner_id = p_owner_id and property_id = p_property_id) then
    raise exception 'This property does not exist in Rental Manager for this owner.';
  end if;
  if not exists (select 1 from financial_accounts where id = p_financial_account_id and owner_id = p_owner_id and active) then
    raise exception 'The selected financial account is invalid.';
  end if;
  if p_purchase_price_cents is null or p_purchase_price_cents <= 0 then raise exception 'A positive purchase price is required.'; end if;
  if p_down_payment_cents is null or p_down_payment_cents < 0 or p_down_payment_cents > p_purchase_price_cents then
    raise exception 'Down payment must be between 0 and the purchase price.';
  end if;
  if jsonb_typeof(coalesce(p_transactions, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_transactions, '[]'::jsonb)) > 200 then
    raise exception 'Provide at most 200 acquisition/renovation transactions.';
  end if;

  insert into property_financial_setups (
    owner_id, property_id, financial_account_id, purchase_date, purchase_price_cents,
    down_payment_cents, closing_costs_cents, initial_valuation_cents, initial_valuation_date,
    lender_name, loan_original_principal_cents, loan_origination_date, loan_current_balance_cents,
    loan_current_balance_as_of, loan_interest_rate_bps, created_by, updated_by
  ) values (
    p_owner_id, p_property_id, p_financial_account_id, p_purchase_date, p_purchase_price_cents,
    p_down_payment_cents, coalesce(p_closing_costs_cents, 0), p_initial_valuation_cents, p_initial_valuation_date,
    nullif(trim(p_lender_name), ''), p_loan_original_principal_cents, p_loan_origination_date, p_loan_current_balance_cents,
    p_loan_current_balance_as_of, p_loan_interest_rate_bps, p_owner_id, p_owner_id
  )
  on conflict (owner_id, property_id) do update set
    financial_account_id = excluded.financial_account_id,
    purchase_date = excluded.purchase_date,
    purchase_price_cents = excluded.purchase_price_cents,
    down_payment_cents = excluded.down_payment_cents,
    closing_costs_cents = excluded.closing_costs_cents,
    initial_valuation_cents = excluded.initial_valuation_cents,
    initial_valuation_date = excluded.initial_valuation_date,
    lender_name = excluded.lender_name,
    loan_original_principal_cents = excluded.loan_original_principal_cents,
    loan_origination_date = excluded.loan_origination_date,
    loan_current_balance_cents = excluded.loan_current_balance_cents,
    loan_current_balance_as_of = excluded.loan_current_balance_as_of,
    loan_interest_rate_bps = excluded.loan_interest_rate_bps,
    updated_by = p_owner_id,
    updated_at = now()
  returning id into v_setup_id;

  -- Replace, not accumulate: this is the only writer of source_system='property_financial_setup'
  -- rows for this owner+property, so clearing and re-inserting on every save is safe and avoids
  -- orphaned stale lines when a renovation entry is removed on a later edit.
  delete from financial_events
  where owner_id = p_owner_id and source_system = 'property_financial_setup' and property_id = p_property_id;

  insert into financial_events (
    owner_id, property_id, financial_account_id, event_date, description, amount,
    transaction_kind, normalized_category, tax_deductible, affects_noi, capitalized,
    source_system, source_record_id, metadata, created_by, updated_by
  ) values (
    p_owner_id, p_property_id, p_financial_account_id, p_purchase_date,
    'Property purchase', p_purchase_price_cents / 100.0,
    'asset_purchase', 'real_estate_purchase', false, false, true,
    'property_financial_setup', 'property_setup:' || p_property_id || ':purchase',
    jsonb_build_object('setup_id', v_setup_id, 'down_payment_cents', p_down_payment_cents),
    p_owner_id, p_owner_id
  );
  v_written := v_written + 1;

  if coalesce(p_closing_costs_cents, 0) > 0 then
    insert into financial_events (
      owner_id, property_id, financial_account_id, event_date, description, amount,
      transaction_kind, normalized_category, tax_deductible, affects_noi, capitalized,
      source_system, source_record_id, metadata, created_by, updated_by
    ) values (
      p_owner_id, p_property_id, p_financial_account_id, p_purchase_date,
      'Closing costs', p_closing_costs_cents / 100.0,
      'asset_purchase', 'closing_costs', false, false, true,
      'property_financial_setup', 'property_setup:' || p_property_id || ':closing_costs',
      jsonb_build_object('setup_id', v_setup_id),
      p_owner_id, p_owner_id
    );
    v_written := v_written + 1;
  end if;

  -- source_record_id uses this transaction's own position in p_transactions (via ordinality), not
  -- the running v_written counter -- otherwise a line's identity would shift whenever
  -- closing_costs_cents toggles between zero and nonzero across edits, turning an update into a
  -- spurious duplicate insert for every line after it.
  for v_transaction, v_index in
    select value, ordinality - 1 from jsonb_array_elements(coalesce(p_transactions, '[]'::jsonb)) with ordinality
  loop
    if coalesce(v_transaction->>'event_date', '') !~ '^\d{4}-\d{2}-\d{2}$'
      or coalesce(v_transaction->>'description', '') = ''
      or coalesce(v_transaction->>'amount_cents', '') !~ '^[0-9]+$'
      or coalesce(v_transaction->>'capitalized', '') not in ('true', 'false')
    then raise exception 'Every acquisition/renovation transaction requires a date, description, positive amount, and capital/operating classification.'; end if;

    v_amount_cents := (v_transaction->>'amount_cents')::bigint;
    if v_amount_cents <= 0 then raise exception 'Every transaction amount must be positive.'; end if;
    v_capitalized := (v_transaction->>'capitalized')::boolean;

    insert into financial_events (
      owner_id, property_id, financial_account_id, event_date, description, amount,
      transaction_kind, normalized_category, tax_deductible, affects_noi, capitalized,
      source_system, source_record_id, metadata, created_by, updated_by
    ) values (
      p_owner_id, p_property_id, p_financial_account_id, (v_transaction->>'event_date')::date,
      left(v_transaction->>'description', 500), v_amount_cents / 100.0,
      case when v_capitalized then 'asset_purchase' else 'expense' end,
      case when v_capitalized then 'capital_improvement' else 'repairs_maintenance' end,
      not v_capitalized, not v_capitalized, v_capitalized,
      'property_financial_setup', 'property_setup:' || p_property_id || ':line:' || v_index,
      jsonb_build_object('setup_id', v_setup_id),
      p_owner_id, p_owner_id
    );
    v_written := v_written + 1;
  end loop;

  return jsonb_build_object('setup_id', v_setup_id, 'financial_events_written', v_written);
end;
$$;

revoke all on function save_property_financial_setup(text,text,text,date,bigint,bigint,bigint,bigint,date,text,bigint,date,bigint,date,integer,jsonb) from public;
grant execute on function save_property_financial_setup(text,text,text,date,bigint,bigint,bigint,bigint,date,text,bigint,date,bigint,date,integer,jsonb) to authenticated;
