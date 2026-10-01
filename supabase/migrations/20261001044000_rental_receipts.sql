-- Rentec parity R26: receipt/invoice scanner — free layer (leapfrog, not copy).
--
-- Rentec only teased an AI receipt scanner (in-development 2025). FORGE ships
-- first with the free, deterministic layer and a HARD-GATED AI extraction
-- stub: per-image/per-token model calls cost money, and under the build-spend
-- doctrine no paid AI API is wired. See docs/rentec-parity/AI_SCAN_GATE.md.
--
-- Design:
-- - rental_receipts is the intake record: an uploaded receipt/invoice image
--   or PDF (stored in the existing rental-documents file library, category
--   "receipt", linked here via document_id), manually entered vendor / date /
--   amount / line items / tax. A receipt whose vendor is unknown carries
--   vendor_name_hint ("unknown vendor") and the UI offers create-vendor via
--   the R3 vendors route.
-- - Matching is DETERMINISTIC (see src/application/rental/receiptMatching.js):
--   vendor-name similarity + amount equality + date proximity, computed on
--   demand in the /matches route — no match rows are stored, nothing is a
--   black box.
-- - "Apply to bill" records a real R4 vendor payment through the existing
--   record_vendor_payment RPC (cash-basis expense posts when PAID, mirroring
--   the R3/R4 ledger design), then marks the receipt 'applied' with the bill
--   and payment ids. Reversal = void the R4 payment, never delete.
-- - Reconciliation assist (see receiptReconciliation.js) matches receipts and
--   unpaid bills to bank-side financial_events (amount + date window) and
--   surfaces what is unmatched on BOTH sides.
-- - Extraction stub: extraction_status defaults to 'not_connected'; only the
--   stub implementation exists. Wiring a real model requires Jason's explicit
--   word (documented in AI_SCAN_GATE.md).
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.

-- ---------------------------------------------------------------------------
-- rental_receipts — the receipt/invoice intake record
-- ---------------------------------------------------------------------------
create table if not exists rental_receipts (
  owner_id text not null,
  id text not null,
  vendor_id text,
  vendor_name_hint text,
  property_id text,
  receipt_date date not null,
  amount_cents bigint not null check (amount_cents > 0),
  tax_cents bigint not null default 0 check (tax_cents >= 0),
  -- [{ description, quantity, amountCents }]
  line_items jsonb not null default '[]'::jsonb
    check (jsonb_typeof(line_items) = 'array'),
  -- Link into the existing rental-documents file library (category "receipt").
  document_id text,
  notes text,
  status text not null default 'inbox'
    check (status in ('inbox', 'applied', 'voided')),
  applied_bill_id text,
  applied_payment_id text,
  -- AI extraction is HARD-GATED: the only implementation is the
  -- "not connected" stub. See docs/rentec-parity/AI_SCAN_GATE.md.
  extraction_status text not null default 'not_connected'
    check (extraction_status in ('not_connected', 'pending', 'complete', 'failed')),
  extracted_data jsonb not null default '{}'::jsonb
    check (jsonb_typeof(extracted_data) = 'object'),
  void_reason text,
  voided_at timestamptz,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint rental_receipts_vendor_fk
    foreign key (owner_id, vendor_id) references rental_vendors(owner_id, id),
  constraint rental_receipts_vendor_or_hint
    check (vendor_id is not null or (vendor_name_hint is not null and btrim(vendor_name_hint) <> '')),
  constraint rental_receipts_tax_lte_amount
    check (tax_cents <= amount_cents),
  constraint rental_receipts_applied_has_bill
    check (status <> 'applied' or (applied_bill_id is not null and btrim(applied_bill_id) <> '')),
  constraint rental_receipts_void_has_reason
    check (status <> 'voided' or (void_reason is not null and btrim(void_reason) <> ''))
);

create index if not exists idx_rental_receipts_owner_status
  on rental_receipts(owner_id, status, receipt_date desc);
create index if not exists idx_rental_receipts_owner_vendor
  on rental_receipts(owner_id, vendor_id, receipt_date desc);
create index if not exists idx_rental_receipts_owner_property
  on rental_receipts(owner_id, property_id, receipt_date desc);
create index if not exists idx_rental_receipts_applied_bill
  on rental_receipts(owner_id, applied_bill_id);

alter table rental_receipts enable row level security;
alter table rental_receipts force row level security;

drop policy if exists "rental_receipts_owner_select" on rental_receipts;
create policy "rental_receipts_owner_select" on rental_receipts for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_receipts_owner_insert" on rental_receipts;
create policy "rental_receipts_owner_insert" on rental_receipts for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_receipts_owner_update" on rental_receipts;
create policy "rental_receipts_owner_update" on rental_receipts for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "rental_receipts_owner_delete" on rental_receipts;
create policy "rental_receipts_owner_delete" on rental_receipts for delete to authenticated
  using (has_workspace_access(owner_id));

-- Grants follow the explicit-grant contract (mirrors bank_reconciliations):
-- revoke the defaults, then grant exactly select/insert/update to authenticated.
revoke all on rental_receipts from anon, authenticated;
grant select, insert, update on rental_receipts to authenticated;

-- updated_at maintenance, reusing R3's trigger function
drop trigger if exists trg_rental_receipts_updated_at on rental_receipts;
create trigger trg_rental_receipts_updated_at
  before update on rental_receipts
  for each row execute function public.touch_rental_vendor_updated_at();
