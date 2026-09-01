-- Shared FORGE workspace membership -- Checkpoint 5 (audit attribution). Fixes 3 RPCs converted
-- in checkpoints 3-4 that wrote an audit-attribution column (created_by/updated_by/approved_by)
-- using p_owner_id instead of the actual acting user. Before workspace membership existed this was
-- harmless (p_owner_id was always required to equal auth.uid() by the old guard), but now that
-- has_workspace_access(p_owner_id) allows an active co-owner to call these RPCs with p_owner_id set
-- to the primary owner's id, leaving the audit column as p_owner_id would silently attribute every
-- co-owner action to the primary owner -- exactly the ambiguity requirement 6 ("record the actual
-- acting auth user separately from the canonical owner wherever an audit record is written") rules
-- out. Fix: every occurrence of p_owner_id used as an audit-column *value* (not as the owner_id
-- being scoped/written) becomes auth.uid()::text, the real caller, unaffected by workspace
-- membership. Every other line is byte-for-byte identical to each function's current definition
-- (as of checkpoints 3/4 in this branch) -- generated via verified single/double-occurrence
-- substitutions, not hand-transcribed.
--
-- The other audit-column write sites inspected during this checkpoint (activate_forge_billing_collection,
-- approve_rentec_payment_import, approve_rentec_financial_history_import, assess_rental_late_fee,
-- create_rental_maintenance_work_order, record_offline_rental_payment,
-- record_rental_security_deposit_transaction, save_rental_lease_preparation_version,
-- set_rental_billing_enabled, update_rental_maintenance_work_order, update_rental_support_case)
-- already source their audit columns from auth.uid() (directly, or via an authenticated_owner_id
-- local variable declared as auth.uid()::text) and need no change. The 3 trigger functions that
-- write financial_events.created_by/updated_by or rental_support_cases.created_by from new.owner_id
-- (open_rental_payment_support_case, post_succeeded_rental_payment_to_financial_event,
-- reconcile_rental_payment_reversal) are system-driven by payment-status changes, not a live
-- authenticated actor, so owner_id is the only meaningful attribution available and is left as-is.

create or replace function public.review_rental_animal(p_owner_id text, p_animal_id text, p_decision text, p_classification text, p_approval_evidence_id text, p_monthly_fee_cents bigint DEFAULT NULL::bigint, p_effective_start_date date DEFAULT NULL::date)
 returns jsonb
 language plpgsql
 set search_path to 'public'
as $function$declare a rental_animals;fee monthly_pet_fees;begin if not has_workspace_access(p_owner_id) or p_decision not in('approved','denied')then raise exception 'Owner animal review is invalid.';end if;select * into a from rental_animals where owner_id=p_owner_id and id=p_animal_id for update;if a.id is null then raise exception 'Animal request was not found.';end if;
if a.classification='assistance_review_requested' then if p_classification not in('assistance_animal_approved','assistance_request_denied')then raise exception 'Assistance request requires a human classification decision.';end if;if p_monthly_fee_cents is not null then raise exception 'Pet fees cannot be assigned through an assistance-animal review.';end if;update rental_animals set classification=p_classification,approval_status=p_decision,approved_at=case when p_decision='approved'then now()else null end,approved_by=case when p_decision='approved'then auth.uid()::text else null end,approval_evidence_id=case when p_decision='approved'then p_approval_evidence_id else null end,human_review_required=false,updated_at=now()where owner_id=p_owner_id and id=a.id;
else if p_classification<>'pet'then raise exception 'Pet review cannot change to an assistance classification.';end if;update rental_animals set approval_status=p_decision,approved_at=case when p_decision='approved'then now()else null end,approved_by=case when p_decision='approved'then auth.uid()::text else null end,approval_evidence_id=case when p_decision='approved'then p_approval_evidence_id else null end,updated_at=now()where owner_id=p_owner_id and id=a.id;if p_decision='approved'and p_monthly_fee_cents is not null then if p_monthly_fee_cents<=0 or p_effective_start_date is null then raise exception 'A positive pet fee and start date are required.';end if;insert into monthly_pet_fees(owner_id,id,animal_id,lease_id,amount_cents,status,effective_start_date,approval_evidence_id,approved_at)values(p_owner_id,'monthly_pet_fee_'||gen_random_uuid()::text,a.id,a.lease_id,p_monthly_fee_cents,'active',p_effective_start_date,p_approval_evidence_id,now())on conflict(owner_id,animal_id)do update set amount_cents=excluded.amount_cents,status='active',effective_start_date=excluded.effective_start_date,approval_evidence_id=excluded.approval_evidence_id,approved_at=excluded.approved_at,updated_at=now()returning * into fee;end if;end if;return jsonb_build_object('animal_id',a.id,'decision',p_decision,'classification',p_classification,'pet_fee_id',fee.id);end$function$;


create or replace function public.approve_simplifi_csv_import(p_owner_id text, p_file_hash text, p_safe_file_label text, p_preview_hash text, p_rows jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare
  v_batch_id text;
  v_stored_preview_hash text;
  v_row jsonb;
  v_event_id text;
  v_inserted boolean;
  v_applied integer := 0;
  v_already_applied integer := 0;
  v_business_scope text;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not has_workspace_access(p_owner_id) then raise exception 'Import owner does not match authenticated owner.'; end if;
  if p_file_hash !~ '^[0-9a-f]{64}$' or p_preview_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Valid file and preview hashes are required.';
  end if;
  if nullif(trim(p_safe_file_label), '') is null then raise exception 'A safe file label is required.'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 500 then
    raise exception 'Approve between 1 and 500 Simplifi rows per batch.';
  end if;

  insert into simplifi_import_batches (
    owner_id, file_hash, safe_file_label, parser_version, row_count,
    preview_hash, status, created_by, approved_at
  ) values (
    p_owner_id, p_file_hash, left(p_safe_file_label, 200), 'v1', jsonb_array_length(p_rows),
    p_preview_hash, 'approved', auth.uid()::text, now()
  )
  on conflict (owner_id, file_hash, preview_hash) do nothing
  returning id, preview_hash into v_batch_id, v_stored_preview_hash;

  if v_batch_id is null then
    select id, preview_hash into v_batch_id, v_stored_preview_hash
    from simplifi_import_batches where owner_id = p_owner_id and file_hash = p_file_hash
      and preview_hash = p_preview_hash
    for update;
  end if;

  for v_row in select value from jsonb_array_elements(p_rows)
  loop
    if coalesce(v_row->>'classification', '') not in ('safe_missing', 'personal') then
      raise exception 'Only freshly recomputed safe_missing or personal rows may be approved.';
    end if;
    if not exists (
      select 1 from financial_accounts a
      where a.owner_id = p_owner_id and a.id = v_row->>'financial_account_id' and a.active
    ) then raise exception 'A selected financial account is invalid.'; end if;
    if coalesce(v_row->>'fingerprint', '') !~ '^v[12]:[0-9a-f]{64}$'
      or coalesce(v_row->>'fingerprint_version', '') !~ '^v[12]$'
      or coalesce(v_row->>'evidence_hash', '') !~ '^[0-9a-f]{64}$'
      or coalesce(v_row->>'normalized_category', '') !~ '^[a-z0-9][a-z0-9_]{0,99}$'
      or coalesce(v_row->>'signed_amount_cents', '') !~ '^-?[0-9]+$'
      or coalesce(v_row->>'transaction_kind', '') not in ('income', 'expense', 'transfer', 'asset_purchase')
      or coalesce(v_row->>'affects_noi', '') not in ('true', 'false')
      or coalesce(v_row->>'capitalized', '') not in ('true', 'false')
    then raise exception 'Approved Simplifi row evidence is invalid.'; end if;

    v_business_scope := case when v_row->>'classification' = 'personal' then 'personal' else 'business' end;

    if exists (
      select 1
      from simplifi_import_rows existing
      where existing.owner_id = p_owner_id
        and existing.row_fingerprint = v_row->>'fingerprint'
        and (
          existing.evidence_hash is distinct from v_row->>'evidence_hash'
          or existing.financial_account_id is distinct from v_row->>'financial_account_id'
          or existing.event_date is distinct from (v_row->>'event_date')::date
          or existing.signed_amount_cents is distinct from (v_row->>'signed_amount_cents')::bigint
          or existing.normalized_category is distinct from v_row->>'normalized_category'
        )
    ) then
      raise exception 'Simplifi transaction was previously approved under different mapping or evidence.';
    end if;

    insert into financial_events (
      owner_id, financial_account_id, event_date, description, amount,
      transaction_kind, normalized_category, tax_deductible, affects_noi, capitalized,
      business_scope, source_system, source_record_id, metadata, created_by, updated_by
    ) values (
      p_owner_id,
      v_row->>'financial_account_id',
      (v_row->>'event_date')::date,
      left(coalesce(nullif(v_row->>'description', ''), 'Simplifi transaction'), 500),
      abs((v_row->>'signed_amount_cents')::bigint) / 100.0,
      v_row->>'transaction_kind',
      v_row->>'normalized_category',
      false,
      (v_business_scope = 'business') and (v_row->>'affects_noi')::boolean,
      (v_business_scope = 'business') and (v_row->>'capitalized')::boolean,
      v_business_scope,
      'quicken_simplifi_csv',
      v_row->>'fingerprint',
      jsonb_build_object(
        'batch_id', v_batch_id, 'evidence_hash', v_row->>'evidence_hash',
        'account_scope', v_row->>'account_scope', 'simplifi_category', v_row->>'simplifi_category'
      ),
      auth.uid()::text,
      auth.uid()::text
    )
    on conflict (owner_id, source_system, source_record_id) do nothing
    returning id into v_event_id;

    v_inserted := v_event_id is not null;
    if not v_inserted then
      v_already_applied := v_already_applied + 1;
      select id into v_event_id from financial_events
      where owner_id = p_owner_id and source_system = 'quicken_simplifi_csv'
        and source_record_id = v_row->>'fingerprint';
    else
      v_applied := v_applied + 1;
    end if;

    insert into simplifi_import_rows (
      owner_id, batch_id, row_fingerprint, fingerprint_version, evidence_hash,
      financial_account_id, event_date, signed_amount_cents, normalized_category,
      classification, approval_status, linked_financial_event_id
    ) values (
      p_owner_id, v_batch_id, v_row->>'fingerprint', v_row->>'fingerprint_version', v_row->>'evidence_hash',
      v_row->>'financial_account_id', (v_row->>'event_date')::date,
      (v_row->>'signed_amount_cents')::bigint, v_row->>'normalized_category',
      v_row->>'classification', case when v_inserted then 'applied' else 'already_applied' end, v_event_id
    )
    on conflict (owner_id, batch_id, row_fingerprint) do update set
      approval_status = excluded.approval_status,
      linked_financial_event_id = excluded.linked_financial_event_id;
    v_event_id := null;
  end loop;

  return jsonb_build_object('batch_id', v_batch_id, 'applied', v_applied, 'already_applied', v_already_applied);
end;
$function$;


create or replace function public.save_property_financial_setup(p_owner_id text, p_property_id text, p_financial_account_id text, p_purchase_date date, p_purchase_price_cents bigint, p_down_payment_cents bigint, p_closing_costs_cents bigint, p_initial_valuation_cents bigint, p_initial_valuation_date date, p_lender_name text, p_loan_original_principal_cents bigint, p_loan_origination_date date, p_loan_current_balance_cents bigint, p_loan_current_balance_as_of date, p_loan_interest_rate_bps integer, p_transactions jsonb)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
 set row_security to 'off'
as $function$
declare
  v_setup_id text;
  v_transaction jsonb;
  v_index integer;
  v_written integer := 0;
  v_amount_cents bigint;
  v_capitalized boolean;
begin
  if auth.uid() is null then raise exception 'Authentication is required.'; end if;
  if not has_workspace_access(p_owner_id) then raise exception 'Setup owner does not match authenticated owner.'; end if;
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
    p_loan_current_balance_as_of, p_loan_interest_rate_bps, auth.uid()::text, auth.uid()::text
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
    updated_by = auth.uid()::text,
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
    auth.uid()::text, auth.uid()::text
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
      auth.uid()::text, auth.uid()::text
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
      auth.uid()::text, auth.uid()::text
    );
    v_written := v_written + 1;
  end loop;

  return jsonb_build_object('setup_id', v_setup_id, 'financial_events_written', v_written);
end;
$function$;
