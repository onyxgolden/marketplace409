-- Rentec parity R3: vendor records + vendor bills (accounts-payable subledger).
--
-- Brandy's demand (b): "ALL the vendor options." Today the repo has only a
-- contractor directory (maintenance-scoped) and free-text payee labels. This
-- adds real vendor master records and vendor bills.
--
-- Ledger design (mirrors tenant charges / rent_charges):
-- - rental_vendor_bills is the AP subledger, the way rent_charges is the AR
--   subledger. Recording a bill does NOT create a financial_events row —
--   FORGE's reporting is cash-basis, so the expense event posts when the bill
--   is PAID (slice R4), exactly like a tenant charge posts income when paid.
-- - Reversal = void (status → 'voided' with a reason), never delete. Paid
--   bills are locked; R4 owns the paid/partial transitions.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

-- ---------------------------------------------------------------------------
-- 1. rental_vendors — vendor master records, scoped to the owner's workspace
-- ---------------------------------------------------------------------------
create table if not exists rental_vendors (
  owner_id text not null,
  id text not null,
  name text not null,
  contact_name text,
  email text,
  phone text,
  address text,
  trade text,
  tax_classification text,
  tax_id_last4 text check (tax_id_last4 is null or tax_id_last4 ~ '^\d{4}$'),
  notes text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_vendors_name_required check (btrim(name) <> '')
);

create index if not exists idx_rental_vendors_owner_name
  on rental_vendors(owner_id, name);
create index if not exists idx_rental_vendors_owner_active
  on rental_vendors(owner_id, is_active);

alter table rental_vendors enable row level security;
alter table rental_vendors force row level security;

drop policy if exists "rental_vendors_owner_select" on rental_vendors;
create policy "rental_vendors_owner_select" on rental_vendors for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_vendors_owner_insert" on rental_vendors;
create policy "rental_vendors_owner_insert" on rental_vendors for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendors_owner_update" on rental_vendors;
create policy "rental_vendors_owner_update" on rental_vendors for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendors_owner_delete" on rental_vendors;
create policy "rental_vendors_owner_delete" on rental_vendors for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 2. rental_vendor_bills — the AP subledger
-- ---------------------------------------------------------------------------
create table if not exists rental_vendor_bills (
  owner_id text not null,
  id text not null,
  vendor_id text not null,
  property_id text,
  bill_date date not null,
  due_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  paid_amount_cents bigint not null default 0 check (paid_amount_cents >= 0),
  expense_account_code text not null,
  memo text,
  attachment_reference text,
  status text not null default 'open'
    check (status in ('open', 'partial', 'paid', 'voided')),
  source_key text not null,
  void_reason text,
  voided_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_vendor_bills_source_key_unique unique (owner_id, source_key),
  constraint rental_vendor_bills_vendor_fk
    foreign key (owner_id, vendor_id) references rental_vendors(owner_id, id),
  constraint rental_vendor_bills_paid_lte_amount
    check (paid_amount_cents <= amount_cents),
  constraint rental_vendor_bills_void_has_reason
    check (status <> 'voided' or (void_reason is not null and btrim(void_reason) <> ''))
);

create index if not exists idx_rental_vendor_bills_owner_vendor
  on rental_vendor_bills(owner_id, vendor_id, bill_date desc);
create index if not exists idx_rental_vendor_bills_owner_status
  on rental_vendor_bills(owner_id, status, due_date);
create index if not exists idx_rental_vendor_bills_owner_property
  on rental_vendor_bills(owner_id, property_id, bill_date desc);

alter table rental_vendor_bills enable row level security;
alter table rental_vendor_bills force row level security;

drop policy if exists "rental_vendor_bills_owner_select" on rental_vendor_bills;
create policy "rental_vendor_bills_owner_select" on rental_vendor_bills for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_bills_owner_insert" on rental_vendor_bills;
create policy "rental_vendor_bills_owner_insert" on rental_vendor_bills for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_bills_owner_update" on rental_vendor_bills;
create policy "rental_vendor_bills_owner_update" on rental_vendor_bills for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_vendor_bills_owner_delete" on rental_vendor_bills;
create policy "rental_vendor_bills_owner_delete" on rental_vendor_bills for delete to authenticated
  using (has_workspace_access(owner_id));

-- updated_at maintenance, mirroring the repo's trigger convention
create or replace function public.touch_rental_vendor_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_rental_vendors_updated_at on rental_vendors;
create trigger trg_rental_vendors_updated_at
  before update on rental_vendors
  for each row execute function public.touch_rental_vendor_updated_at();

drop trigger if exists trg_rental_vendor_bills_updated_at on rental_vendor_bills;
create trigger trg_rental_vendor_bills_updated_at
  before update on rental_vendor_bills
  for each row execute function public.touch_rental_vendor_updated_at();
