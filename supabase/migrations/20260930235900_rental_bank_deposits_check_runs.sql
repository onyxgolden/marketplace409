-- Rentec parity R7: banking remainder — print checks + bank deposit slips.
--
-- Two features, one slice:
--
-- 1. CHECK PRINTING. R4 records vendor payments with payment_method='check'
--    and a check number. R7 adds check runs: a batch of recorded check
--    payments printed together (multi-select into one run). Printing never
--    moves money — the payment already posted its ledger events in R4 — so
--    the run is header + snapshot items only. Snapshots freeze the check
--    face (payee, amount, check number, date, memo) at print time; a live
--    status re-check refuses voided payments at print time ("Voided payments
--    must never print" is enforced in the RPC at run creation AND re-checked
--    by the print route before rendering).
--    PREREQUISITE: rental_vendor_payments / rental_vendors are built by the
--    R3/R4 slices, and create_check_print_run() contains static SQL against
--    those tables. PostgreSQL resolves the relations when the function is
--    CREATED, so this migration CANNOT land on a base without R4 applied —
--    it would fail at CREATE FUNCTION. The prerequisite guard below fails
--    loudly (RAISE EXCEPTION) when the R4 tables are absent, instead of
--    failing mid-migration.
--
-- 2. BANK DEPOSITS. A deposit batches received tenant payments / misc income
--    receipts (financial_events income rows) against one bank account and
--    prints a deposit slip (date, account, itemized cash/check lines, total).
--    Ledger design (the "undeposited funds" pattern):
--      - Each deposited item references its income event; the RPC stamps
--        metadata.deposit_id on the event so it can never be deposited twice.
--      - Items must be UNBANKED (bank_account_id IS NULL) — an event already
--        recorded against a bank account is rejected fail-closed, so the
--        deposit can never double-count money in the bank register.
--      - The deposit itself posts exactly ONE financial_events row (income,
--        normalized_category='bank_deposit', affects_noi=false) for the lump
--        total with the deposit's bank_account_id. The bank ledger and the
--        reconciliation see one lump line — the shape a bank statement shows
--        — while the item events keep their P&L-side income untouched.
--        No duplicate income: the item events never gain a bank_account_id.
--    - Void = reversal: the deposit event is soft-deleted (is_deleted /
--      status='deleted', mirroring the transactions DELETE route), the items'
--      deposit_id stamps are released, and the deposit row is marked voided
--      with a reason. Fail-closed when the deposit event sits on an ACTIVE
--      bank reconciliation (the statement period is closed).
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

-- ---------------------------------------------------------------------------
-- PREREQUISITE GUARD — R7 requires R4 applied first (fail loud, never degrade)
-- ---------------------------------------------------------------------------
-- create_check_print_run() contains static SQL against rental_vendor_payments
-- and rental_vendors. PostgreSQL resolves those relations when the function
-- is CREATED, so this migration cannot land on a base without R4 — it would
-- fail at CREATE FUNCTION. Check up front and fail with a plain-English
-- message instead.
DO $$
BEGIN
  IF to_regclass('public.rental_vendor_payments') IS NULL THEN
    RAISE EXCEPTION 'R7 check-printing migration requires R4 to be applied first: table public.rental_vendor_payments is missing.';
  END IF;
  IF to_regclass('public.rental_vendors') IS NULL THEN
    RAISE EXCEPTION 'R7 check-printing migration requires R3/R4 to be applied first: table public.rental_vendors is missing.';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 0. updated_at trigger (self-contained: sibling slices are separate PRs)
-- ---------------------------------------------------------------------------
create or replace function public.touch_rental_banking_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 1. rental_bank_deposits — one row per bank deposit slip
-- ---------------------------------------------------------------------------
create table if not exists rental_bank_deposits (
  owner_id text not null,
  id text not null,
  deposit_date date not null,
  bank_account_id text not null,
  memo text,
  total_amount_cents bigint not null check (total_amount_cents > 0),
  item_count integer not null check (item_count > 0),
  deposit_event_id text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_bank_deposits_void_has_reason
    check (status <> 'voided' or (void_reason is not null and btrim(void_reason) <> ''))
);

create index if not exists idx_rental_bank_deposits_owner_account
  on rental_bank_deposits(owner_id, bank_account_id, deposit_date desc);
create index if not exists idx_rental_bank_deposits_owner_status
  on rental_bank_deposits(owner_id, status, deposit_date desc);

-- ---------------------------------------------------------------------------
-- 2. rental_bank_deposit_items — the batched receipts on a deposit
-- ---------------------------------------------------------------------------
create table if not exists rental_bank_deposit_items (
  owner_id text not null,
  deposit_id text not null,
  financial_event_id text not null,
  seq integer not null check (seq >= 0),
  tender text not null check (tender in ('cash', 'check', 'money_order', 'other')),
  check_number text,
  received_from text,
  amount_cents bigint not null check (amount_cents > 0),
  primary key (owner_id, deposit_id, financial_event_id),
  constraint rental_bank_deposit_items_deposit_fk
    foreign key (owner_id, deposit_id) references rental_bank_deposits(owner_id, id),
  constraint rental_bank_deposit_items_check_needs_number
    check (tender <> 'check' or (check_number is not null and btrim(check_number) <> ''))
);

create index if not exists idx_rental_bank_deposit_items_owner_deposit
  on rental_bank_deposit_items(owner_id, deposit_id, seq);

-- ---------------------------------------------------------------------------
-- 3. rental_check_print_runs — one row per printed check batch
-- ---------------------------------------------------------------------------
create table if not exists rental_check_print_runs (
  owner_id text not null,
  id text not null,
  run_date date not null,
  bank_account_id text not null,
  check_count integer not null check (check_count > 0),
  total_amount_cents bigint not null check (total_amount_cents > 0),
  created_by text,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists idx_rental_check_print_runs_owner_account
  on rental_check_print_runs(owner_id, bank_account_id, run_date desc);

-- ---------------------------------------------------------------------------
-- 4. rental_check_print_items — snapshot of each printed check's face
-- ---------------------------------------------------------------------------
-- vendor_payment_id has NO foreign key by design: check-run items are
-- immutable snapshots of the check face at print time, so they must not
-- hard-link to the live payment row. (R4 is a hard prerequisite of this
-- migration — see the guard above — so the table is guaranteed present;
-- the RPC still validates each payment's method, live status, and bank
-- account inside its transaction.)
create table if not exists rental_check_print_items (
  owner_id text not null,
  run_id text not null,
  seq integer not null check (seq >= 0),
  vendor_payment_id text not null,
  payee_name text not null,
  amount_cents bigint not null check (amount_cents > 0),
  check_number text not null,
  payment_date date not null,
  memo text,
  bank_account_id text not null,
  primary key (owner_id, run_id, seq),
  constraint rental_check_print_items_run_fk
    foreign key (owner_id, run_id) references rental_check_print_runs(owner_id, id)
);

create index if not exists idx_rental_check_print_items_owner_run
  on rental_check_print_items(owner_id, run_id, seq);

-- ---------------------------------------------------------------------------
-- 5. Row-level security — same owner-scoped contract as the sibling slices
-- ---------------------------------------------------------------------------
alter table rental_bank_deposits enable row level security;
alter table rental_bank_deposits force row level security;

drop policy if exists "rental_bank_deposits_owner_select" on rental_bank_deposits;
create policy "rental_bank_deposits_owner_select" on rental_bank_deposits for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_bank_deposits_owner_insert" on rental_bank_deposits;
create policy "rental_bank_deposits_owner_insert" on rental_bank_deposits for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_bank_deposits_owner_update" on rental_bank_deposits;
create policy "rental_bank_deposits_owner_update" on rental_bank_deposits for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_bank_deposits_owner_delete" on rental_bank_deposits;
create policy "rental_bank_deposits_owner_delete" on rental_bank_deposits for delete to authenticated
  using (has_workspace_access(owner_id));

alter table rental_bank_deposit_items enable row level security;
alter table rental_bank_deposit_items force row level security;

drop policy if exists "rental_bank_deposit_items_owner_select" on rental_bank_deposit_items;
create policy "rental_bank_deposit_items_owner_select" on rental_bank_deposit_items for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_bank_deposit_items_owner_insert" on rental_bank_deposit_items;
create policy "rental_bank_deposit_items_owner_insert" on rental_bank_deposit_items for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_bank_deposit_items_owner_update" on rental_bank_deposit_items;
create policy "rental_bank_deposit_items_owner_update" on rental_bank_deposit_items for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_bank_deposit_items_owner_delete" on rental_bank_deposit_items;
create policy "rental_bank_deposit_items_owner_delete" on rental_bank_deposit_items for delete to authenticated
  using (has_workspace_access(owner_id));

alter table rental_check_print_runs enable row level security;
alter table rental_check_print_runs force row level security;

drop policy if exists "rental_check_print_runs_owner_select" on rental_check_print_runs;
create policy "rental_check_print_runs_owner_select" on rental_check_print_runs for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_check_print_runs_owner_insert" on rental_check_print_runs;
create policy "rental_check_print_runs_owner_insert" on rental_check_print_runs for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_check_print_runs_owner_update" on rental_check_print_runs;
create policy "rental_check_print_runs_owner_update" on rental_check_print_runs for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_check_print_runs_owner_delete" on rental_check_print_runs;
create policy "rental_check_print_runs_owner_delete" on rental_check_print_runs for delete to authenticated
  using (has_workspace_access(owner_id));

alter table rental_check_print_items enable row level security;
alter table rental_check_print_items force row level security;

drop policy if exists "rental_check_print_items_owner_select" on rental_check_print_items;
create policy "rental_check_print_items_owner_select" on rental_check_print_items for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_check_print_items_owner_insert" on rental_check_print_items;
create policy "rental_check_print_items_owner_insert" on rental_check_print_items for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_check_print_items_owner_update" on rental_check_print_items;
create policy "rental_check_print_items_owner_update" on rental_check_print_items for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_check_print_items_owner_delete" on rental_check_print_items;
create policy "rental_check_print_items_owner_delete" on rental_check_print_items for delete to authenticated
  using (has_workspace_access(owner_id));

-- updated_at maintenance (deposits are editable only via void; runs are immutable)
drop trigger if exists trg_rental_bank_deposits_updated_at on rental_bank_deposits;
create trigger trg_rental_bank_deposits_updated_at
  before update on rental_bank_deposits
  for each row execute function public.touch_rental_banking_updated_at();

-- ---------------------------------------------------------------------------
-- 6. record_bank_deposit — atomic deposit posting
-- ---------------------------------------------------------------------------
-- One RPC, one database transaction: the deposit header, its items, the
-- deposit_id stamp on every item event, and the SINGLE financial_events
-- income row for the lump total all land together or not at all.
--
-- p_deposit: { id, depositDate, bankAccountId, memo,
--   items: [{ eventId, tender ('cash'|'check'|'money_order'|'other'),
--             checkNumber, receivedFrom, amountCents }] }
create or replace function record_bank_deposit(p_owner_id text, p_deposit jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_actor_id text := auth.uid()::text;
  v_deposit_id text := nullif(btrim(p_deposit ->> 'id'), '');
  v_deposit_date date := nullif(btrim(p_deposit ->> 'depositDate'), '')::date;
  v_bank_account_id text := nullif(btrim(p_deposit ->> 'bankAccountId'), '');
  v_memo text := nullif(btrim(p_deposit ->> 'memo'), '');
  v_items jsonb := coalesce(p_deposit -> 'items', '[]'::jsonb);
  v_item jsonb;
  v_event_id text;
  v_tender text;
  v_check_number text;
  v_received_from text;
  v_item_cents bigint;
  v_event financial_events%rowtype;
  v_event_cents bigint;
  v_total_cents bigint := 0;
  v_count integer := 0;
  v_seen text[] := '{}';
  v_ledger_event_id text;
  v_item_event_ids text[] := '{}';
  v_seq integer := 0;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  if v_deposit_id is null then
    raise exception 'A deposit id is required.' using errcode = '22023';
  end if;
  if v_deposit_date is null then
    raise exception 'A deposit date is required.' using errcode = '22023';
  end if;
  if v_bank_account_id is null then
    raise exception 'A bank account is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_items) <> 'array' or jsonb_array_length(v_items) = 0 then
    raise exception 'A deposit needs at least one receipt.' using errcode = '22023';
  end if;

  -- The bank account must belong to this owner.
  perform 1 from financial_accounts
   where owner_id = effective_owner_id and id = v_bank_account_id;
  if not found then
    raise exception 'The selected bank account was not found.' using errcode = 'P0002';
  end if;

  -- 1. The deposit header. The PK is the idempotency key: a retried submit
  -- with the same id hits the constraint and the route returns the deposit
  -- instead of double-posting.
  insert into rental_bank_deposits (
    owner_id, id, deposit_date, bank_account_id, memo,
    total_amount_cents, item_count, created_by
  ) values (
    effective_owner_id, v_deposit_id, v_deposit_date, v_bank_account_id, v_memo,
    0, 0, v_actor_id
  );

  -- Validate every item against its locked event, in event-id order so
  -- concurrent deposits serialize instead of double-depositing.
  select jsonb_agg(i order by (i ->> 'eventId'))
    into v_items
    from jsonb_array_elements(v_items) as i;

  for v_item in select * from jsonb_array_elements(v_items) loop
    v_event_id := nullif(btrim(v_item ->> 'eventId'), '');
    v_tender := nullif(btrim(v_item ->> 'tender'), '');
    v_check_number := nullif(btrim(v_item ->> 'checkNumber'), '');
    v_received_from := nullif(btrim(v_item ->> 'receivedFrom'), '');
    v_item_cents := (v_item ->> 'amountCents')::bigint;
    if v_event_id is null then
      raise exception 'Every deposit line needs a receipt.' using errcode = '22023';
    end if;
    if v_event_id = any(v_seen) then
      raise exception 'The same receipt appears twice on this deposit.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_event_id;
    if v_tender is null or v_tender not in ('cash', 'check', 'money_order', 'other') then
      raise exception 'Every deposit line needs a tender type (cash, check, money order, or other).' using errcode = '22023';
    end if;
    if v_tender = 'check' and v_check_number is null then
      raise exception 'Check lines need a check number.' using errcode = '22023';
    end if;
    if v_item_cents is null or v_item_cents <= 0 then
      raise exception 'Every deposit line needs a positive amount.' using errcode = '22023';
    end if;

    select * into v_event from financial_events
     where owner_id = effective_owner_id and id = v_event_id
     for update;
    if not found then
      raise exception 'A receipt on this deposit was not found.' using errcode = 'P0002';
    end if;
    if v_event.transaction_kind <> 'income' then
      raise exception 'Only received payments can be deposited.' using errcode = '22023';
    end if;
    if v_event.is_deleted or v_event.status <> 'active' then
      raise exception 'Only active receipts can be deposited.' using errcode = '22023';
    end if;
    if v_event.bank_account_id is not null then
      raise exception 'A receipt already recorded against a bank account cannot be deposited again.' using errcode = '22023';
    end if;
    if v_event.metadata ->> 'deposit_id' is not null then
      raise exception 'A receipt on this deposit is already on another deposit.' using errcode = '22023';
    end if;
    v_event_cents := round(v_event.amount * 100)::bigint;
    if v_event_cents <> v_item_cents then
      raise exception 'A deposit line does not match its receipt amount.' using errcode = '22023';
    end if;

    -- 2. The item row + the deposit stamp on the event.
    insert into rental_bank_deposit_items (
      owner_id, deposit_id, financial_event_id, seq, tender,
      check_number, received_from, amount_cents
    ) values (
      effective_owner_id, v_deposit_id, v_event_id, v_seq, v_tender,
      v_check_number, v_received_from, v_item_cents
    );
    v_seq := v_seq + 1;

    update financial_events
       set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('deposit_id', v_deposit_id),
           updated_by = v_actor_id
     where id = v_event.id;

    v_total_cents := v_total_cents + v_item_cents;
    v_count := v_count + 1;
    v_item_event_ids := v_item_event_ids || v_event_id;
  end loop;

  -- 3. The SINGLE bank-ledger transfer: one income row for the lump total.
  -- affects_noi=false and normalized_category='bank_deposit' keep it out of
  -- P&L/NOI rollups — the income was already counted when each receipt
  -- posted. This row is the bank-side record the statement reconciles to.
  insert into financial_events (
    owner_id, property_id, event_date, description, amount, transaction_kind,
    normalized_category, payee, check_number, bank_account_id, cleared, cleared_at,
    tax_deductible, affects_noi, capitalized, source_system, metadata,
    status, is_deleted, created_by, updated_by
  ) values (
    effective_owner_id,
    null,
    v_deposit_date,
    'Bank deposit — ' || v_count || ' receipt' || case when v_count = 1 then '' else 's' end,
    (v_total_cents / 100.0),
    'income',
    'bank_deposit',
    null, null,
    v_bank_account_id,
    false, null,
    false, false, false, 'manual',
    jsonb_strip_nulls(jsonb_build_object(
      'deposit_id', v_deposit_id,
      'item_event_ids', to_jsonb(v_item_event_ids),
      'memo', v_memo
    )),
    'active', false, v_actor_id, v_actor_id
  ) returning id into v_ledger_event_id;

  update rental_bank_deposits
     set total_amount_cents = v_total_cents,
         item_count = v_count,
         deposit_event_id = v_ledger_event_id
   where owner_id = effective_owner_id and id = v_deposit_id;

  return jsonb_build_object(
    'depositId', v_deposit_id,
    'eventId', v_ledger_event_id,
    'totalAmountCents', v_total_cents,
    'itemCount', v_count
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- 7. void_bank_deposit — atomic deposit reversal
-- ---------------------------------------------------------------------------
-- Reversal, never delete: the deposit event is soft-deleted, the items'
-- deposit_id stamps are released (only where they still point at this
-- deposit), and the deposit row is marked voided with a reason. Fail-closed
-- when the deposit event sits on an ACTIVE bank reconciliation.
create or replace function void_bank_deposit(p_owner_id text, p_deposit_id text, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_actor_id text := auth.uid()::text;
  v_deposit_id text := nullif(btrim(p_deposit_id), '');
  v_reason text := nullif(btrim(p_reason), '');
  v_deposit rental_bank_deposits%rowtype;
  v_item rental_bank_deposit_items%rowtype;
  v_reconciled_count integer;
  v_released integer := 0;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;
  if v_deposit_id is null then
    raise exception 'A deposit id is required.' using errcode = '22023';
  end if;
  if v_reason is null then
    raise exception 'A reason is required to void a deposit.' using errcode = '22023';
  end if;

  select * into v_deposit from rental_bank_deposits
   where owner_id = effective_owner_id and id = v_deposit_id
   for update;
  if not found then
    raise exception 'The deposit was not found.' using errcode = 'P0002';
  end if;
  if v_deposit.status <> 'active' then
    raise exception 'Only active deposits can be voided.' using errcode = '22023';
  end if;

  -- Reconciliation guard: a deposit already cleared on an active statement
  -- locks the whole deposit. The route surfaces this as a 409.
  if v_deposit.deposit_event_id is not null then
    select count(*) into v_reconciled_count from bank_reconciliations
     where owner_id = effective_owner_id
       and status = 'active'
       and cleared_event_ids ? v_deposit.deposit_event_id;
    if v_reconciled_count > 0 then
      raise exception 'This deposit is already reconciled and cannot be voided.' using errcode = 'P0001';
    end if;

    update financial_events
       set is_deleted = true, deleted_at = now(), status = 'deleted', updated_by = v_actor_id
     where owner_id = effective_owner_id
       and id = v_deposit.deposit_event_id
       and is_deleted = false;
  end if;

  -- Release each item's deposit stamp (only where it still points here).
  for v_item in select * from rental_bank_deposit_items
                where owner_id = effective_owner_id and deposit_id = v_deposit.id
                order by seq
  loop
    update financial_events
       set metadata = metadata - 'deposit_id', updated_by = v_actor_id
     where owner_id = effective_owner_id
       and id = v_item.financial_event_id
       and metadata ->> 'deposit_id' = v_deposit.id;
    if found then
      v_released := v_released + 1;
    end if;
  end loop;

  update rental_bank_deposits
     set status = 'voided', void_reason = v_reason, voided_at = now()
   where owner_id = effective_owner_id and id = v_deposit.id;

  return jsonb_build_object('depositId', v_deposit.id, 'releasedItems', v_released);
end;
$$;

-- ---------------------------------------------------------------------------
-- 8. create_check_print_run — atomic check-run creation
-- ---------------------------------------------------------------------------
-- Printing never moves money (R4's payment already posted), so the run is
-- header + snapshot items. The RPC re-validates every payment INSIDE the
-- transaction: method must be 'check', status must be 'active' — a voided
-- payment raises, so voided payments can never print — and every check must
-- be drawn on the run's bank account.
--
-- p_run: { id, runDate, bankAccountId, paymentIds: [text] }
create or replace function create_check_print_run(p_owner_id text, p_run jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  effective_owner_id text := public.resolve_effective_owner_id();
  v_actor_id text := auth.uid()::text;
  v_run_id text := nullif(btrim(p_run ->> 'id'), '');
  v_run_date date := nullif(btrim(p_run ->> 'runDate'), '')::date;
  v_bank_account_id text := nullif(btrim(p_run ->> 'bankAccountId'), '');
  v_payment_ids jsonb := coalesce(p_run -> 'paymentIds', '[]'::jsonb);
  v_payment_id text;
  -- Scalar fields for the payment/vendor lookups (rather than %rowtype):
  -- plain column selects keep the snapshot mapping explicit. R4 is a hard
  -- prerequisite of this migration (guard at the top), so both tables exist
  -- when this function is created.
  v_pay_method text;
  v_pay_status text;
  v_pay_amount_cents bigint;
  v_pay_bank_account_id text;
  v_pay_check_number text;
  v_pay_payment_date date;
  v_pay_memo text;
  v_pay_vendor_id text;
  v_vendor_name text;
  v_total_cents bigint := 0;
  v_count integer := 0;
  v_seen text[] := '{}';
  v_seq integer := 0;
begin
  if effective_owner_id is null then
    raise exception 'Not authenticated.' using errcode = '28000';
  end if;
  if p_owner_id is null or btrim(p_owner_id) = '' or p_owner_id <> effective_owner_id then
    raise exception 'Owner does not match authenticated owner.' using errcode = '42501';
  end if;

  if v_run_id is null then
    raise exception 'A check run id is required.' using errcode = '22023';
  end if;
  if v_run_date is null then
    raise exception 'A run date is required.' using errcode = '22023';
  end if;
  if v_bank_account_id is null then
    raise exception 'A bank account is required.' using errcode = '22023';
  end if;
  if jsonb_typeof(v_payment_ids) <> 'array' or jsonb_array_length(v_payment_ids) = 0 then
    raise exception 'A check run needs at least one check.' using errcode = '22023';
  end if;

  -- The bank account must belong to this owner.
  perform 1 from financial_accounts
   where owner_id = effective_owner_id and id = v_bank_account_id;
  if not found then
    raise exception 'The selected bank account was not found.' using errcode = 'P0002';
  end if;

  -- 1. The run header. The PK is the idempotency key.
  insert into rental_check_print_runs (
    owner_id, id, run_date, bank_account_id, check_count, total_amount_cents, created_by
  ) values (
    effective_owner_id, v_run_id, v_run_date, v_bank_account_id, 0, 0, v_actor_id
  );

  -- Validate every payment against its locked row, in payment-id order.
  select jsonb_agg(x order by x)
    into v_payment_ids
    from jsonb_array_elements_text(v_payment_ids) as x;

  for v_payment_id in select * from jsonb_array_elements_text(v_payment_ids) loop
    v_payment_id := nullif(btrim(v_payment_id), '');
    if v_payment_id is null then
      raise exception 'Every check needs a payment.' using errcode = '22023';
    end if;
    if v_payment_id = any(v_seen) then
      raise exception 'The same check appears twice on this run.' using errcode = '22023';
    end if;
    v_seen := v_seen || v_payment_id;

    select payment_method, status, amount_cents, bank_account_id,
           check_number, payment_date, memo, vendor_id
      into v_pay_method, v_pay_status, v_pay_amount_cents, v_pay_bank_account_id,
           v_pay_check_number, v_pay_payment_date, v_pay_memo, v_pay_vendor_id
      from rental_vendor_payments
     where owner_id = effective_owner_id and id = v_payment_id
     for update;
    if not found then
      raise exception 'A check payment on this run was not found.' using errcode = 'P0002';
    end if;
    if v_pay_method <> 'check' then
      raise exception 'Only check payments can be printed.' using errcode = '22023';
    end if;
    if v_pay_status <> 'active' then
      raise exception 'Voided payments cannot be printed.' using errcode = '22023';
    end if;
    if v_pay_bank_account_id <> v_bank_account_id then
      raise exception 'All checks in a run must be drawn on the same bank account.' using errcode = '22023';
    end if;

    select name into v_vendor_name from rental_vendors
     where owner_id = effective_owner_id and id = v_pay_vendor_id;
    if not found then
      raise exception 'The vendor for a check payment was not found.' using errcode = 'P0002';
    end if;

    insert into rental_check_print_items (
      owner_id, run_id, seq, vendor_payment_id, payee_name, amount_cents,
      check_number, payment_date, memo, bank_account_id
    ) values (
      effective_owner_id, v_run_id, v_seq, v_payment_id, v_vendor_name,
      v_pay_amount_cents, v_pay_check_number, v_pay_payment_date,
      v_pay_memo, v_pay_bank_account_id
    );
    v_seq := v_seq + 1;
    v_total_cents := v_total_cents + v_pay_amount_cents;
    v_count := v_count + 1;
  end loop;

  update rental_check_print_runs
     set check_count = v_count, total_amount_cents = v_total_cents
   where owner_id = effective_owner_id and id = v_run_id;

  return jsonb_build_object(
    'runId', v_run_id,
    'checkCount', v_count,
    'totalAmountCents', v_total_cents
  );
end;
$$;

revoke all on function record_bank_deposit(text, jsonb) from public, anon;
grant execute on function record_bank_deposit(text, jsonb) to authenticated;

revoke all on function void_bank_deposit(text, text, text) from public, anon;
grant execute on function void_bank_deposit(text, text, text) to authenticated;

revoke all on function create_check_print_run(text, jsonb) from public, anon;
grant execute on function create_check_print_run(text, jsonb) to authenticated;
