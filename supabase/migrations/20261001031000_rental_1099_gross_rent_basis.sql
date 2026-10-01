-- ============================================================================
-- Rentec parity R23: 1099 gross-rent aggregation basis (PR #528 CHANGES fix).
--
-- Problem (ChatGPT 2026-10-01): 1099-MISC Box 1 (rents) was computed from net
-- owner disbursements (the manual rental_1099_payment_entries rows), not from
-- gross rent receipts. Box 1 must report GROSS RENTS paid to the recipient —
-- the total rent collected attributable to their properties — before expenses,
-- fees, or disbursements are subtracted. Using net disbursements understates
-- Box 1 and misreports to the IRS.
--
-- Fix: gross rent is derived read-only from the ledger (financial_events):
--   transaction_kind = 'income'
--   AND normalized_category = 'rental_income'
--   AND property_id in the recipient's linked properties
--   AND event_date within the tax year
--   AND status = 'active' AND is_deleted = false
--
-- Exclusions (never count toward Box 1):
--   - non-rent income (fees, deposits, other income categories)
--   - voided/deleted events
--   - events outside the tax year
--   - events on properties not linked to the recipient
--   - owner disbursements / contributions (equity movements, not rent)
--
-- Attribution: rental_1099_recipient_properties links each owner recipient to
-- the properties whose gross rent counts toward their 1099-MISC. Brandy links
-- properties on the Tax / 1099 surface; the aggregation reads the links.
--
-- Manual payment entries (source 'manual' / 'r9_owner_distribution') remain
-- for vendor 1099-NEC totals and for owner ADJUSTMENTS (source 'adjustment'
-- only) — they no longer drive the owner Box 1 total.
--
-- NOT APPLIED — authored for the owner's explicit approval before touching production.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. rental_1099_recipient_properties — which properties' gross rent counts
--    toward each owner recipient's 1099-MISC Box 1.
-- ---------------------------------------------------------------------------
create table if not exists rental_1099_recipient_properties (
  owner_id text not null,
  recipient_id text not null,
  property_id text not null,
  created_at timestamptz not null default now(),
  primary key (owner_id, recipient_id, property_id),
  foreign key (owner_id, recipient_id)
    references rental_1099_recipients(owner_id, id)
    on delete cascade
);

create index if not exists idx_rental_1099_recipient_properties_recipient
  on rental_1099_recipient_properties(owner_id, recipient_id);

alter table rental_1099_recipient_properties enable row level security;
alter table rental_1099_recipient_properties force row level security;

drop policy if exists "rental_1099_recipient_properties_owner_select"
  on rental_1099_recipient_properties;
create policy "rental_1099_recipient_properties_owner_select"
  on rental_1099_recipient_properties for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_1099_recipient_properties_owner_insert"
  on rental_1099_recipient_properties;
create policy "rental_1099_recipient_properties_owner_insert"
  on rental_1099_recipient_properties for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_recipient_properties_owner_update"
  on rental_1099_recipient_properties;
create policy "rental_1099_recipient_properties_owner_update"
  on rental_1099_recipient_properties for update to authenticated
  using (has_workspace_access(owner_id))
  with check (has_workspace_access(owner_id));

drop policy if exists "rental_1099_recipient_properties_owner_delete"
  on rental_1099_recipient_properties;
create policy "rental_1099_recipient_properties_owner_delete"
  on rental_1099_recipient_properties for delete to authenticated
  using (has_workspace_access(owner_id));
