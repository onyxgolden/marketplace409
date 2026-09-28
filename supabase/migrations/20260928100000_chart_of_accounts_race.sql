-- 20260928100000_chart_of_accounts_race.sql
--
-- Closes the two PR #420 retrospective findings at the database boundary:
--
--   1. Deactivation/posting race. Posting validated the account as active in
--      the route, then inserted later; deactivation counted usage in the
--      route, then updated later. A posting could validate, race with
--      deactivation, and insert after the account became inactive (or slip
--      between the usage check and the deactivation write).
--
--      Fix: the chart row itself is now the serialization point.
--      * Posting RPCs (create_ledger_transaction, create_ledger_transactions,
--        create_expense_with_tenant_charge) lock the account row FOR SHARE
--        and re-check is_active while holding it.
--      * update_transaction_with_history does the same when an edit moves a
--        transaction to a DIFFERENT category (edits that keep the category
--        are unaffected, so memo/check-number/date edits on transactions
--        whose account was later deactivated keep working).
--      * deactivate_chart_account locks the account row FOR UPDATE, counts
--        usage while holding it, then writes.
--      FOR SHARE conflicts with the deactivation's exclusive row lock, so
--      the two orders are both safe: deactivation-first makes the posting
--      see is_active = false and reject itself; posting-first makes the
--        deactivation wait, then see the new posting in its usage count and
--      block itself. Concurrent postings to the same account do NOT block
--      each other (SHARE locks coexist).
--
--   2. GET ?transactionsFor= is a JS-only change (is_deleted filter) -- no
--      migration piece.
--
-- This migration does NOT touch the already-applied chart-of-accounts
-- migration (20260927140001). Legacy workspaces whose chart table does not
-- exist yet keep working: the posting checks are skipped when
-- to_regclass('public.chart_of_accounts') is null, exactly like the routes'
-- built-in fallback.
--
-- No EXCEPTION blocks anywhere: none of the writes may be wrapped in a
-- subtransaction, so a later failure always rolls back everything above it.

-- ---------------------------------------------------------------------------
-- 1. create_ledger_transaction: single-transaction posting with the
--    active-category check under the chart row lock.
-- ---------------------------------------------------------------------------
-- The transactions POST route calls this once. The route keeps its full
-- validateTransaction pass as the early UX rejection; this RPC is the
-- enforcement boundary. The inserted row mirrors application/rental/
-- transactionRow.js (toRow) so the single and batch paths write identical
-- rows.
create function create_ledger_transaction(p_owner_id text, p_event jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_actor_id text := auth.uid()::text;
  v_category text := nullif(btrim(p_event ->> 'normalizedCategory'), '');
  v_kind text := p_event ->> 'transactionKind';
  v_amount numeric := nullif(btrim(p_event ->> 'amount'), '')::numeric;
  v_event_date date := nullif(btrim(p_event ->> 'eventDate'), '')::date;
  v_description text := nullif(btrim(p_event ->> 'description'), '');
  v_bank_account_id text := nullif(btrim(p_event ->> 'bankAccountId'), '');
  v_cleared boolean := coalesce((p_event ->> 'cleared')::boolean, false);
  v_cat_active boolean;
  v_row financial_events%rowtype;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Server-side floor validation. The route performs the full validation;
  -- this keeps direct RPC callers honest without duplicating the whole
  -- validator.
  if v_event_date is null then
    raise exception 'The transaction date is required.' using errcode = '22000';
  end if;
  if v_description is null then
    raise exception 'A description is required.' using errcode = '22000';
  end if;
  if v_amount is null or v_amount <= 0 then
    raise exception 'The amount must be greater than zero.' using errcode = '22000';
  end if;
  if v_kind is null or v_kind not in ('income', 'expense') then
    raise exception 'Transaction kind must be income or expense.' using errcode = '22000';
  end if;
  if v_category is null then
    raise exception 'A category is required.' using errcode = '22000';
  end if;

  -- Coordinate with concurrent deactivation: lock the account row in SHARE
  -- mode and re-check is_active while holding it (see the header comment).
  if to_regclass('public.chart_of_accounts') is not null then
    select is_active into v_cat_active
      from chart_of_accounts
     where owner_id = effective_owner_id
       and code = v_category
       for share;
    if not found then
      raise exception 'Unknown account code.' using errcode = '22000';
    end if;
    if not v_cat_active then
      raise exception 'This account has been deactivated. Choose an active account.' using errcode = '22000';
    end if;
  end if;

  -- The bank account must belong to this owner.
  if v_bank_account_id is not null then
    perform 1 from financial_accounts
     where owner_id = effective_owner_id and id = v_bank_account_id;
    if not found then
      raise exception 'The selected bank account was not found.' using errcode = 'P0002';
    end if;
  end if;

  insert into financial_events (
    owner_id, property_id, event_date, description, amount, transaction_kind,
    normalized_category, payee, check_number, bank_account_id, cleared, cleared_at,
    display_as, ref_number, payee_mailing_address, assigned_to,
    is_recurring, recurrence_rule, depreciate,
    tax_deductible, affects_noi, capitalized, source_system, metadata,
    status, is_deleted, created_by, updated_by
  ) values (
    effective_owner_id,
    nullif(btrim(p_event ->> 'propertyId'), ''),
    v_event_date,
    v_description,
    v_amount,
    v_kind,
    v_category,
    nullif(btrim(p_event ->> 'payee'), ''),
    nullif(btrim(p_event ->> 'checkNumber'), ''),
    v_bank_account_id,
    v_cleared,
    case when v_cleared then now() else null end,
    nullif(btrim(p_event ->> 'displayAs'), ''),
    nullif(btrim(p_event ->> 'refNumber'), ''),
    nullif(btrim(p_event ->> 'payeeMailingAddress'), ''),
    nullif(btrim(p_event ->> 'assignedTo'), ''),
    coalesce((p_event ->> 'isRecurring')::boolean, false),
    case when coalesce((p_event ->> 'isRecurring')::boolean, false)
         then nullif(btrim(p_event ->> 'recurrenceRule'), '')
         else null end,
    coalesce((p_event ->> 'depreciate')::boolean, false),
    v_kind = 'expense', true, false, 'manual',
    jsonb_strip_nulls(jsonb_build_object(
      'memo', nullif(btrim(p_event ->> 'memo'), ''),
      'tenant_id', nullif(btrim(p_event ->> 'tenantId'), ''),
      'payment_method', nullif(btrim(p_event ->> 'paymentMethod'), '')
    )),
    'active', false, v_actor_id, v_actor_id
  )
  returning * into v_row;

  -- The same 12 columns the transactions POST route used to select.
  return jsonb_build_object(
    'id', v_row.id,
    'event_date', v_row.event_date,
    'description', v_row.description,
    'amount', v_row.amount,
    'transaction_kind', v_row.transaction_kind,
    'normalized_category', v_row.normalized_category,
    'payee', v_row.payee,
    'check_number', v_row.check_number,
    'bank_account_id', v_row.bank_account_id,
    'cleared', v_row.cleared,
    'cleared_at', v_row.cleared_at,
    'property_id', v_row.property_id
  );
end;
$$;

revoke all on function create_ledger_transaction(text, jsonb) from public;
grant execute on function create_ledger_transaction(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. create_ledger_transactions: batch posting (all-or-nothing) with the
--    active-category check under the chart row locks.
-- ---------------------------------------------------------------------------
-- The transactions/batch POST route calls this once with the validated rows.
-- Every distinct category is locked FOR SHARE and checked while held; then
-- all rows insert in this function's single implicit transaction, so a
-- failure anywhere rolls back the whole batch -- same as the old multi-row
-- insert.
create function create_ledger_transactions(p_owner_id text, p_events jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_actor_id text := auth.uid()::text;
  v_events jsonb := coalesce(p_events, '[]'::jsonb);
  v_count integer := jsonb_array_length(coalesce(p_events, '[]'::jsonb));
  v_categories text[];
  v_cat text;
  v_cat_active boolean;
  v_e jsonb;
  v_amount numeric;
  v_event_date date;
  v_description text;
  v_kind text;
  v_category text;
  v_bank_account_id text;
  v_cleared boolean;
  v_ids text[] := '{}';
  v_id text;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_count = 0 then
    raise exception 'At least one expense row is required.' using errcode = '22000';
  end if;
  if v_count > 50 then
    raise exception 'Batch entry is limited to 50 rows at a time.' using errcode = '22000';
  end if;

  -- Lock every distinct category in SHARE mode and re-check is_active while
  -- holding the locks (see the header comment). Sorted so concurrent batches
  -- always acquire the chart locks in the same order -- two batches can
  -- never deadlock against each other here.
  select coalesce(array_agg(distinct s.code), '{}')
    into v_categories
    from (
      select nullif(btrim(e ->> 'normalizedCategory'), '') as code
        from jsonb_array_elements(v_events) as e
    ) s
   where s.code is not null;
  if to_regclass('public.chart_of_accounts') is not null then
    for v_cat in select u.code from unnest(v_categories) as u(code) order by u.code loop
      select is_active into v_cat_active
        from chart_of_accounts
       where owner_id = effective_owner_id
         and code = v_cat
         for share;
      if not found then
        raise exception 'Unknown account code: %.', v_cat using errcode = '22000';
      end if;
      if not v_cat_active then
        raise exception 'This account has been deactivated: %. Choose an active account.', v_cat using errcode = '22000';
      end if;
    end loop;
  end if;

  for v_e in select * from jsonb_array_elements(v_events) loop
    v_amount := nullif(btrim(v_e ->> 'amount'), '')::numeric;
    v_event_date := nullif(btrim(v_e ->> 'eventDate'), '')::date;
    v_description := nullif(btrim(v_e ->> 'description'), '');
    v_kind := v_e ->> 'transactionKind';
    v_category := nullif(btrim(v_e ->> 'normalizedCategory'), '');
    v_bank_account_id := nullif(btrim(v_e ->> 'bankAccountId'), '');
    v_cleared := coalesce((v_e ->> 'cleared')::boolean, false);
    if v_event_date is null then
      raise exception 'The transaction date is required.' using errcode = '22000';
    end if;
    if v_description is null then
      raise exception 'A description is required.' using errcode = '22000';
    end if;
    if v_amount is null or v_amount <= 0 then
      raise exception 'The amount must be greater than zero.' using errcode = '22000';
    end if;
    if v_kind is null or v_kind not in ('income', 'expense') then
      raise exception 'Transaction kind must be income or expense.' using errcode = '22000';
    end if;
    if v_category is null then
      raise exception 'A category is required.' using errcode = '22000';
    end if;
    if v_bank_account_id is not null then
      perform 1 from financial_accounts
       where owner_id = effective_owner_id and id = v_bank_account_id;
      if not found then
        raise exception 'The selected bank account was not found.' using errcode = 'P0002';
      end if;
    end if;

    insert into financial_events (
      owner_id, property_id, event_date, description, amount, transaction_kind,
      normalized_category, payee, check_number, bank_account_id, cleared, cleared_at,
      display_as, ref_number, payee_mailing_address, assigned_to,
      is_recurring, recurrence_rule, depreciate,
      tax_deductible, affects_noi, capitalized, source_system, metadata,
      status, is_deleted, created_by, updated_by
    ) values (
      effective_owner_id,
      nullif(btrim(v_e ->> 'propertyId'), ''),
      v_event_date,
      v_description,
      v_amount,
      v_kind,
      v_category,
      nullif(btrim(v_e ->> 'payee'), ''),
      nullif(btrim(v_e ->> 'checkNumber'), ''),
      v_bank_account_id,
      v_cleared,
      case when v_cleared then now() else null end,
      nullif(btrim(v_e ->> 'displayAs'), ''),
      nullif(btrim(v_e ->> 'refNumber'), ''),
      nullif(btrim(v_e ->> 'payeeMailingAddress'), ''),
      nullif(btrim(v_e ->> 'assignedTo'), ''),
      coalesce((v_e ->> 'isRecurring')::boolean, false),
      case when coalesce((v_e ->> 'isRecurring')::boolean, false)
           then nullif(btrim(v_e ->> 'recurrenceRule'), '')
           else null end,
      coalesce((v_e ->> 'depreciate')::boolean, false),
      v_kind = 'expense', true, false, 'manual',
      jsonb_strip_nulls(jsonb_build_object(
        'memo', nullif(btrim(v_e ->> 'memo'), ''),
        'tenant_id', nullif(btrim(v_e ->> 'tenantId'), ''),
        'payment_method', nullif(btrim(v_e ->> 'paymentMethod'), '')
      )),
      'active', false, v_actor_id, v_actor_id
    )
    returning id into v_id;
    v_ids := v_ids || v_id;
  end loop;

  return jsonb_build_object('created', v_count, 'ids', to_jsonb(v_ids));
end;
$$;

revoke all on function create_ledger_transactions(text, jsonb) from public;
grant execute on function create_ledger_transactions(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. create_expense_with_tenant_charge: add the active-category check under
--    the chart row lock. Body is otherwise identical to 20260927120000.
-- ---------------------------------------------------------------------------
create or replace function create_expense_with_tenant_charge(
  p_owner_id text,
  p_event jsonb,
  p_charge jsonb
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  authenticated_owner_id text := auth.uid()::text;
  required_owner text := nullif(btrim(p_owner_id), '');
  v_event_id text;
  v_charge_id text;
  v_lease_id text := nullif(btrim(p_charge ->> 'leaseId'), '');
  v_charge_type text := nullif(btrim(p_charge ->> 'chargeType'), '');
  v_amount_cents bigint := nullif(btrim(p_charge ->> 'amountCents'), '')::bigint;
  v_due_date date := (nullif(btrim(p_charge ->> 'dueDate'), ''))::date;
  v_charge_date date := (nullif(btrim(p_charge ->> 'chargeDate'), ''))::date;
  v_description text := nullif(btrim(p_charge ->> 'description'), '');
  v_tenant_id text := nullif(btrim(p_event ->> 'tenantId'), '');
  v_event_amount numeric := nullif(btrim(p_event ->> 'amount'), '')::numeric;
  v_bank_account_id text := nullif(btrim(p_event ->> 'bankAccountId'), '');
  v_category text := nullif(btrim(p_event ->> 'normalizedCategory'), '');
  v_cat_active boolean;
  v_currency text;
  v_period text;
  v_memo text := nullif(btrim(p_event ->> 'memo'), '');
  v_payment_method text := nullif(btrim(p_event ->> 'paymentMethod'), '');
  v_recurrence_rule text := nullif(btrim(p_event ->> 'recurrenceRule'), '');
begin
  if authenticated_owner_id is null then
    raise exception 'Authenticated owner id is required.' using errcode = '42501';
  end if;
  if required_owner is null or required_owner <> authenticated_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  -- Charge validation: ad-hoc tenant charges only (rent billing never flows here).
  if v_charge_type is null or v_charge_type not in ('damage', 'fee', 'utility', 'other') then
    raise exception 'Tenant charge type must be damage, fee, utility, or other.' using errcode = '22023';
  end if;
  if v_lease_id is null then
    raise exception 'Tenant charge requires a lease.' using errcode = '22023';
  end if;
  select currency_code into v_currency from rental_leases
   where owner_id = required_owner and id = v_lease_id;
  if not found then
    raise exception 'Lease was not found.' using errcode = 'P0002';
  end if;
  if v_amount_cents is null or v_amount_cents <= 0 then
    raise exception 'Tenant charge amount must be a positive number of cents.' using errcode = '22023';
  end if;
  if v_due_date is null then
    raise exception 'Tenant charge requires a due date.' using errcode = '22023';
  end if;
  if v_charge_date is null then
    raise exception 'Tenant charge requires a charge date.' using errcode = '22023';
  end if;
  if v_description is null then
    raise exception 'Tenant charge requires a description.' using errcode = '22023';
  end if;
  v_period := to_char(v_charge_date, 'YYYY-MM');

  -- Event validation: charge-tenant only ever attaches to an expense.
  if (p_event ->> 'transactionKind') <> 'expense' then
    raise exception 'Charge-tenant requires an expense event.' using errcode = '22023';
  end if;
  if v_event_amount is null or v_event_amount <= 0 then
    raise exception 'Expense amount must be positive.' using errcode = '22023';
  end if;
  if nullif(btrim(p_event ->> 'description'), '') is null then
    raise exception 'Expense description is required.' using errcode = '22023';
  end if;
  if (p_event ->> 'eventDate') is null or btrim(p_event ->> 'eventDate') = '' then
    raise exception 'Expense date is required.' using errcode = '22023';
  end if;
  if v_recurrence_rule is not null and v_recurrence_rule not in ('weekly', 'biweekly', 'monthly', 'quarterly', 'yearly') then
    raise exception 'Recurrence rule must be weekly, biweekly, monthly, quarterly, or yearly.' using errcode = '22023';
  end if;
  -- The bank account must belong to this owner — a foreign id fails honestly
  -- instead of writing a dangling reference.
  if v_bank_account_id is not null then
    perform 1 from financial_accounts where owner_id = required_owner and id = v_bank_account_id;
    if not found then
      raise exception 'The selected bank account was not found.' using errcode = 'P0002';
    end if;
  end if;

  -- Coordinate with concurrent deactivation: lock the account row in SHARE
  -- mode and re-check is_active while holding it (see the header comment).
  -- Legacy workspaces (chart table absent) skip the check, exactly like the
  -- route's built-in fallback.
  if to_regclass('public.chart_of_accounts') is not null and v_category is not null then
    select is_active into v_cat_active
      from chart_of_accounts
     where owner_id = required_owner
       and code = v_category
       for share;
    if not found then
      raise exception 'Unknown account code.' using errcode = '22000';
    end if;
    if not v_cat_active then
      raise exception 'This account has been deactivated. Choose an active account.' using errcode = '22000';
    end if;
  end if;

  -- 1. The owner's expense (as today: manual source, active, not deleted).
  insert into financial_events (
    owner_id, property_id, event_date, description, amount, transaction_kind,
    normalized_category, payee, check_number, bank_account_id, cleared, cleared_at,
    display_as, ref_number, payee_mailing_address, assigned_to,
    is_recurring, recurrence_rule, depreciate,
    tax_deductible, affects_noi, capitalized, source_system, metadata,
    status, is_deleted, created_by, updated_by
  ) values (
    required_owner,
    nullif(btrim(p_event ->> 'propertyId'), ''),
    (p_event ->> 'eventDate')::date,
    btrim(p_event ->> 'description'),
    v_event_amount,
    'expense',
    nullif(btrim(p_event ->> 'normalizedCategory'), ''),
    nullif(btrim(p_event ->> 'payee'), ''),
    nullif(btrim(p_event ->> 'checkNumber'), ''),
    v_bank_account_id,
    coalesce((p_event ->> 'cleared')::boolean, false),
    case when coalesce((p_event ->> 'cleared')::boolean, false) then now() else null end,
    nullif(btrim(p_event ->> 'displayAs'), ''),
    nullif(btrim(p_event ->> 'refNumber'), ''),
    nullif(btrim(p_event ->> 'payeeMailingAddress'), ''),
    nullif(btrim(p_event ->> 'assignedTo'), ''),
    coalesce((p_event ->> 'isRecurring')::boolean, false),
    case when coalesce((p_event ->> 'isRecurring')::boolean, false) then v_recurrence_rule else null end,
    coalesce((p_event ->> 'depreciate')::boolean, false),
    true, true, false, 'manual',
    jsonb_strip_nulls(jsonb_build_object(
      'tenant_id', v_tenant_id,
      'charged_to_tenant', true,
      'memo', v_memo,
      'payment_method', v_payment_method
    )),
    'active', false, authenticated_owner_id, authenticated_owner_id
  )
  returning id into v_event_id;

  -- 2. The tenant's charge: schedule-less, due, uniquely keyed to the event.
  v_charge_id := 'rent_charge_tenant_' || replace(gen_random_uuid()::text, '-', '');
  insert into rent_charges (
    owner_id, id, lease_id, schedule_id, period, due_date, amount_cents,
    paid_amount_cents, currency_code, status, source_key, notes
  ) values (
    required_owner, v_charge_id, v_lease_id, null, v_period, v_due_date, v_amount_cents,
    0, v_currency, 'due', 'tenantcharge:' || v_event_id, v_description
  );

  -- 3. Two-way link: the event records its charge.
  update financial_events
     set metadata = metadata || jsonb_build_object('tenant_charge_id', v_charge_id),
         updated_at = now()
   where owner_id = required_owner and id = v_event_id;

  return jsonb_build_object('eventId', v_event_id, 'chargeId', v_charge_id);
end;
$$;

revoke all on function create_expense_with_tenant_charge(text, jsonb, jsonb) from public;
grant execute on function create_expense_with_tenant_charge(text, jsonb, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. update_transaction_with_history: lock the row first, then re-check the
--    account's active state when an edit MOVES the transaction to a
--    different category. Body is otherwise identical to 20260927120000.
-- ---------------------------------------------------------------------------
-- Transfer legs are exempt from the chart lookup: their category 'transfer'
-- is not a chart code (it is enforced pair-wide by
-- update_transfer_leg_with_history), and a re-categorization of a transfer
-- leg never touches chart semantics.
create or replace function update_transaction_with_history(
  p_owner_id text,
  p_event_id text,
  p_event jsonb,
  p_changes jsonb,
  p_edited_by text,
  p_cleared_at text
)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_event_id text := nullif(btrim(p_event_id), '');
  v_actor_id text := auth.uid()::text;
  v_row financial_events%rowtype;
  v_bank_account_id text := nullif(btrim(p_event ->> 'bankAccountId'), '');
  v_existing_group text;
  v_existing_category text;
  v_new_category text := nullif(btrim(p_event ->> 'normalizedCategory'), '');
  v_cat_active boolean;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_event_id is null then
    raise exception 'Event id is required.' using errcode = '22023';
  end if;
  if coalesce(p_changes, '{}'::jsonb) = '{}'::jsonb and p_event is null then
    raise exception 'Nothing to update.' using errcode = '22023';
  end if;

  -- Lock the row first: the category check below must see a stable row, and
  -- the UPDATE's own row lock arrives too late for the exemption decision.
  select transfer_group_id, normalized_category
    into v_existing_group, v_existing_category
    from financial_events
   where owner_id = required_owner
     and id = v_event_id
     and source_system = 'manual'
     and is_deleted = false
     for update;
  if not found then
    raise exception 'Transaction was not found.' using errcode = 'P0002';
  end if;

  -- Coordinate re-categorization with concurrent deactivation: when the edit
  -- moves the transaction to a different category, lock that account row in
  -- SHARE mode and re-check is_active while holding it (see the header
  -- comment). Edits that keep the category skip the check, so ordinary memo
  -- or date edits on transactions whose account was later deactivated keep
  -- working. Legacy workspaces (chart table absent) skip the check too.
  if v_existing_group is null
     and v_new_category is not null
     and v_new_category is distinct from v_existing_category
     and to_regclass('public.chart_of_accounts') is not null then
    select is_active into v_cat_active
      from chart_of_accounts
     where owner_id = required_owner
       and code = v_new_category
       for share;
    if not found then
      raise exception 'Unknown account code.' using errcode = '22000';
    end if;
    if not v_cat_active then
      raise exception 'This account has been deactivated. Choose an active account.' using errcode = '22000';
    end if;
  end if;

  -- The bank account must belong to this owner — a foreign id fails honestly
  -- instead of writing a dangling reference.
  if v_bank_account_id is not null then
    perform 1 from financial_accounts
     where owner_id = required_owner and id = v_bank_account_id;
    if not found then
      raise exception 'The selected bank account was not found.' using errcode = 'P0002';
    end if;
  end if;

  -- The edit and its audit record share this function's single implicit
  -- transaction: a failed history insert rolls back the event edit with it.
  -- NOTE: row locking for idempotency is intentionally absent. A retried edit
  -- with the same payload is a legitimate second edit (the UI's edit form is
  -- not a one-shot action), and any retry lands its own audit row -- the
  -- history table is the record of every accepted edit, not a dedup log.
  update financial_events
     set property_id = nullif(btrim(p_event ->> 'propertyId'), ''),
         event_date = (p_event ->> 'eventDate')::date,
         description = btrim(p_event ->> 'description'),
         amount = nullif(btrim(p_event ->> 'amount'), '')::numeric,
         transaction_kind = p_event ->> 'transactionKind',
         normalized_category = nullif(btrim(p_event ->> 'normalizedCategory'), ''),
         payee = nullif(btrim(p_event ->> 'payee'), ''),
         check_number = nullif(btrim(p_event ->> 'checkNumber'), ''),
         bank_account_id = v_bank_account_id,
         cleared = coalesce((p_event ->> 'cleared')::boolean, false),
         cleared_at = case
           when p_cleared_at is null or btrim(p_cleared_at) = '' then null
           else btrim(p_cleared_at)::timestamptz
         end,
         display_as = nullif(btrim(p_event ->> 'displayAs'), ''),
         ref_number = nullif(btrim(p_event ->> 'refNumber'), ''),
         payee_mailing_address = nullif(btrim(p_event ->> 'payeeMailingAddress'), ''),
         assigned_to = nullif(btrim(p_event ->> 'assignedTo'), ''),
         is_recurring = coalesce((p_event ->> 'isRecurring')::boolean, false),
         recurrence_rule = nullif(btrim(p_event ->> 'recurrenceRule'), ''),
         depreciate = coalesce((p_event ->> 'depreciate')::boolean, false),
         metadata = metadata || jsonb_strip_nulls(jsonb_build_object(
           'memo', nullif(btrim(p_event ->> 'memo'), ''),
           'tenant_id', nullif(btrim(p_event ->> 'tenantId'), ''),
           'payment_method', nullif(btrim(p_event ->> 'paymentMethod'), '')
         )),
         updated_by = v_actor_id,
         updated_at = now()
   where owner_id = required_owner
     and id = v_event_id
     and source_system = 'manual'
     and is_deleted = false
  returning * into v_row;
  if not found then
    raise exception 'Transaction was not found.' using errcode = 'P0002';
  end if;

  insert into financial_event_history (
    owner_id, financial_event_id, edited_by, edited_at, changes
  ) values (
    required_owner, v_event_id, v_actor_id, now(), coalesce(p_changes, '{}'::jsonb)
  );

  return to_jsonb(v_row) - 'owner_id' - 'created_by' - 'updated_by';
end;
$$;

revoke all on function update_transaction_with_history(text, text, jsonb, jsonb, text, text) from public;
grant execute on function update_transaction_with_history(text, text, jsonb, jsonb, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. deactivate_chart_account: the atomic deactivation half of the race.
-- ---------------------------------------------------------------------------
-- The chart-of-accounts PATCH route calls this when is_active is set false.
-- The row lock, the usage check, and the write happen in this function's
-- single implicit transaction, coordinated with concurrent postings via the
-- chart row lock (see the header comment): a posting that locked the row
-- first forces this deactivation to wait, after which the usage count sees
-- the new posting and blocks the deactivation.
--
-- The usage guard mirrors application/rental/chartOfAccounts.js
-- (getAccountUsageCount): ledger events plus split lines for the code.
create function deactivate_chart_account(p_owner_id text, p_account_id text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  required_owner text := nullif(btrim(p_owner_id), '');
  v_account_id text := nullif(btrim(p_account_id), '');
  v_code text;
  v_is_active boolean;
  v_event_count bigint;
  v_split_count bigint;
  v_usage bigint;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if required_owner is null or required_owner <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_account_id is null then
    raise exception 'Account id is required.' using errcode = '22023';
  end if;

  -- Lock the account row BEFORE counting usage. A concurrent posting holds a
  -- SHARE lock on this row while inserting; this FOR UPDATE waits for it,
  -- then the count below sees the new posting and blocks the deactivation.
  select code, is_active
    into v_code, v_is_active
    from chart_of_accounts
   where owner_id = effective_owner_id
     and id = v_account_id
     for update;
  if not found then
    raise exception 'Account not found.' using errcode = 'P0002';
  end if;
  if not v_is_active then
    -- Idempotent: deactivating an already-inactive account succeeds.
    return jsonb_build_object('id', v_account_id, 'code', v_code, 'is_active', false);
  end if;

  select count(*) into v_event_count
    from financial_events
   where owner_id = effective_owner_id
     and normalized_category = v_code;
  select count(*) into v_split_count
    from financial_event_splits
   where owner_id = effective_owner_id
     and normalized_category = v_code;
  v_usage := coalesce(v_event_count, 0) + coalesce(v_split_count, 0);
  if v_usage > 0 then
    raise exception 'This account has % transaction% posted to it. Reassign % to another account before deactivating.',
      v_usage,
      case when v_usage = 1 then '' else 's' end,
      case when v_usage = 1 then 'it' else 'them' end
      using errcode = 'P0002';
  end if;

  update chart_of_accounts
     set is_active = false,
         updated_at = now()
   where owner_id = effective_owner_id
     and id = v_account_id;

  return jsonb_build_object('id', v_account_id, 'code', v_code, 'is_active', false);
end;
$$;

revoke all on function deactivate_chart_account(text, text) from public;
grant execute on function deactivate_chart_account(text, text) to authenticated;
