-- Rentec parity R23: 1099 tax-year prep — data prep built, e-filing partner HARD-GATED.
--
-- Brandy's annual 1099 flow (Rentec parity item 21): aggregate reportable payments
-- per recipient for the tax year, collect recipient name/address/TIN, flag the
-- $600 IRS threshold, categorize 1099-NEC (vendors — nonemployee compensation)
-- vs 1099-MISC (owners — rents, Box 1), preview per recipient, generate an
-- IRS-modeled export file, and track filing status per recipient.
--
-- SPEND DECISION (Jason's build-spend motto, hard boundary): e-filing partners
-- charge per-filing fees. Nothing in this migration, the domain layer, or the UI
-- signs up for, calls, or pays any e-filing partner. The partner integration is
-- a design-only stub (src/application/rental/efilePartner1099.js) that always
-- reports "not connected" and refuses submission. Jason must approve the partner
-- choice and per-filing cost before e-filing can go live.
--
-- COMPLIANCE: 1099 deadlines and rules change — the UI and export carry a
-- "confirm with your CPA; this is not tax advice" banner. The export file is
-- modeled on IRS Publication 1220 (FIRE system) record layout and is NOT
-- IRS-certified. Do not present it as such.
--
-- TIN HANDLING DECISION (documented): full TINs are stored ONLY as AES-256-GCM
-- ciphertext (column tin_ciphertext) encrypted by the API route with the server
-- env key FORGE_1099_TIN_KEY. Database list queries can never return a plaintext
-- TIN; the API layer decrypts only inside the export endpoint (writer role only),
-- and every other surface receives tin_masked ("XXX-XX-1234") + tin_last4.
-- Encryption/decryption is fail-closed: with no key configured, TIN writes and
-- exports refuse with a clear error instead of silently degrading.
--
-- PAYMENT SOURCES (read-only aggregates — R23 creates no new payment systems):
-- - Vendor payments: read from the merged R3/R4 tables (rental_vendor_bills,
--   rental_vendor_payments). Cash basis: an ACTIVE payment counts in the tax
--   year of its payment_date. Voided payments never count.
-- - Owner distributions: the R9 owner-statement/disbursement system is NOT on
--   origin/main yet, so there is no R9 table to read. R23 therefore keeps a
--   lightweight manual/adjustment table (rental_1099_payment_entries) as the
--   today path for owner distributions; when R9 merges, its disbursement rows
--   land here with source='r9_owner_distribution' via a loader adapter — no
--   schema change needed, no second payment system.
--
-- Filing status machine (per recipient + tax year):
--   not_started -> ready -> exported -> filed_manually
--   ready can go back to not_started (reset) and exported back to ready
--   (re-export). filed_manually is terminal. Enforced in the domain
--   (canTransitionFilingStatus) AND again in the API route.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

-- ---------------------------------------------------------------------------
-- 1. rental_1099_recipients — who gets a 1099 this year
-- ---------------------------------------------------------------------------
create table if not exists rental_1099_recipients (
  owner_id text not null,
  id text not null,
  kind text not null check (kind in ('vendor', 'owner')),
  linked_vendor_id text,
  display_name text not null,
  entity_type text not null default 'individual' check (entity_type in (
    'individual', 'sole_proprietorship', 'partnership', 'llc',
    'c_corporation', 's_corporation', 'trust_estate', 'tax_exempt', 'other'
  )),
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  country text not null default 'US',
  tin_ciphertext text,
  tin_last4 text check (tin_last4 is null or tin_last4 ~ '^\d{4}$'),
  tin_type text not null default 'unknown' check (tin_type in ('ssn', 'ein', 'itin', 'unknown')),
  is_active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_1099_recipients_name_required check (btrim(display_name) <> '')
);

create index if not exists idx_rental_1099_recipients_owner_kind
  on rental_1099_recipients(owner_id, kind, is_active);

create index if not exists idx_rental_1099_recipients_owner_vendor
  on rental_1099_recipients(owner_id, linked_vendor_id)
  where linked_vendor_id is not null;

alter table rental_1099_recipients enable row level security;
alter table rental_1099_recipients force row level security;

drop policy if exists "rental_1099_recipients_owner_select" on rental_1099_recipients;
create policy "rental_1099_recipients_owner_select" on rental_1099_recipients for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_1099_recipients_owner_insert" on rental_1099_recipients;
create policy "rental_1099_recipients_owner_insert" on rental_1099_recipients for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_recipients_owner_update" on rental_1099_recipients;
create policy "rental_1099_recipients_owner_update" on rental_1099_recipients for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_recipients_owner_delete" on rental_1099_recipients;
create policy "rental_1099_recipients_owner_delete" on rental_1099_recipients for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 2. rental_1099_payment_entries — manual/adjustment reportable entries
--    (owner distributions today; R9 disbursements land here later)
-- ---------------------------------------------------------------------------
create table if not exists rental_1099_payment_entries (
  owner_id text not null,
  id text not null,
  recipient_id text not null,
  tax_year integer not null check (tax_year between 2000 and 2100),
  payment_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  source text not null default 'manual' check (source in ('manual', 'r9_owner_distribution', 'adjustment')),
  source_ref text,
  memo text,
  status text not null default 'active' check (status in ('active', 'voided')),
  void_reason text,
  voided_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_1099_payment_entries_recipient_fk
    foreign key (owner_id, recipient_id) references rental_1099_recipients(owner_id, id),
  constraint rental_1099_payment_entries_void_has_reason
    check (status <> 'voided' or (void_reason is not null and btrim(void_reason) <> ''))
);

create index if not exists idx_rental_1099_payment_entries_owner_recipient_year
  on rental_1099_payment_entries(owner_id, recipient_id, tax_year, status);

alter table rental_1099_payment_entries enable row level security;
alter table rental_1099_payment_entries force row level security;

drop policy if exists "rental_1099_payment_entries_owner_select" on rental_1099_payment_entries;
create policy "rental_1099_payment_entries_owner_select" on rental_1099_payment_entries for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_1099_payment_entries_owner_insert" on rental_1099_payment_entries;
create policy "rental_1099_payment_entries_owner_insert" on rental_1099_payment_entries for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_payment_entries_owner_update" on rental_1099_payment_entries;
create policy "rental_1099_payment_entries_owner_update" on rental_1099_payment_entries for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_payment_entries_owner_delete" on rental_1099_payment_entries;
create policy "rental_1099_payment_entries_owner_delete" on rental_1099_payment_entries for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 3. rental_1099_filing_states — per-recipient, per-year filing progress
-- ---------------------------------------------------------------------------
create table if not exists rental_1099_filing_states (
  owner_id text not null,
  recipient_id text not null,
  tax_year integer not null check (tax_year between 2000 and 2100),
  status text not null default 'not_started' check (status in (
    'not_started', 'ready', 'exported', 'filed_manually'
  )),
  form_type text not null default '1099-NEC' check (form_type in ('1099-NEC', '1099-MISC')),
  note text,
  decided_at timestamptz,
  exported_at timestamptz,
  filed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, recipient_id, tax_year),
  constraint rental_1099_filing_states_recipient_fk
    foreign key (owner_id, recipient_id) references rental_1099_recipients(owner_id, id)
);

create index if not exists idx_rental_1099_filing_states_owner_year
  on rental_1099_filing_states(owner_id, tax_year, status);

alter table rental_1099_filing_states enable row level security;
alter table rental_1099_filing_states force row level security;

drop policy if exists "rental_1099_filing_states_owner_select" on rental_1099_filing_states;
create policy "rental_1099_filing_states_owner_select" on rental_1099_filing_states for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_1099_filing_states_owner_insert" on rental_1099_filing_states;
create policy "rental_1099_filing_states_owner_insert" on rental_1099_filing_states for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_filing_states_owner_update" on rental_1099_filing_states;
create policy "rental_1099_filing_states_owner_update" on rental_1099_filing_states for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_filing_states_owner_delete" on rental_1099_filing_states;
create policy "rental_1099_filing_states_owner_delete" on rental_1099_filing_states for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 4. rental_1099_payer_profiles — the filer's business identity per tax year
--    (name/address/TIN as it appears on the 1099s; TIN encrypted like recipients')
-- ---------------------------------------------------------------------------
create table if not exists rental_1099_payer_profiles (
  owner_id text not null,
  id text not null,
  tax_year integer not null check (tax_year between 2000 and 2100),
  business_name text not null,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  zip text,
  tin_ciphertext text,
  tin_last4 text check (tin_last4 is null or tin_last4 ~ '^\d{4}$'),
  tin_type text not null default 'ein' check (tin_type in ('ssn', 'ein', 'unknown')),
  contact_name text,
  contact_phone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_1099_payer_profiles_year_unique unique (owner_id, tax_year),
  constraint rental_1099_payer_profiles_name_required check (btrim(business_name) <> '')
);

alter table rental_1099_payer_profiles enable row level security;
alter table rental_1099_payer_profiles force row level security;

drop policy if exists "rental_1099_payer_profiles_owner_select" on rental_1099_payer_profiles;
create policy "rental_1099_payer_profiles_owner_select" on rental_1099_payer_profiles for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_1099_payer_profiles_owner_insert" on rental_1099_payer_profiles;
create policy "rental_1099_payer_profiles_owner_insert" on rental_1099_payer_profiles for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_payer_profiles_owner_update" on rental_1099_payer_profiles;
create policy "rental_1099_payer_profiles_owner_update" on rental_1099_payer_profiles for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_payer_profiles_owner_delete" on rental_1099_payer_profiles;
create policy "rental_1099_payer_profiles_owner_delete" on rental_1099_payer_profiles for delete to authenticated
  using (has_workspace_access(owner_id));

-- updated_at maintenance, reusing R3's trigger function
drop trigger if exists trg_rental_1099_recipients_updated_at on rental_1099_recipients;
create trigger trg_rental_1099_recipients_updated_at
  before update on rental_1099_recipients
  for each row execute function public.touch_rental_vendor_updated_at();

drop trigger if exists trg_rental_1099_payment_entries_updated_at on rental_1099_payment_entries;
create trigger trg_rental_1099_payment_entries_updated_at
  before update on rental_1099_payment_entries
  for each row execute function public.touch_rental_vendor_updated_at();

drop trigger if exists trg_rental_1099_filing_states_updated_at on rental_1099_filing_states;
create trigger trg_rental_1099_filing_states_updated_at
  before update on rental_1099_filing_states
  for each row execute function public.touch_rental_vendor_updated_at();

drop trigger if exists trg_rental_1099_payer_profiles_updated_at on rental_1099_payer_profiles;
create trigger trg_rental_1099_payer_profiles_updated_at
  before update on rental_1099_payer_profiles
  for each row execute function public.touch_rental_vendor_updated_at();
