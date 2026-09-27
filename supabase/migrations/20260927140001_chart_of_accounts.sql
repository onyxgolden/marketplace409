-- Chart of accounts: the category source of truth for ledger transactions.
--
-- Categories used to live only as a hardcoded list in application code
-- (MANUAL_FINANCIAL_EVENT_CATEGORIES). This table makes them manageable:
-- owners can add custom accounts, rename labels, and deactivate unused ones.
-- financial_events.normalized_category keeps storing the account `code`, so
-- existing rows need no data migration -- the seed below inserts the same
-- 16 codes every existing transaction already uses.
--
-- NOT APPLIED -- authored for the owner's explicit approval before touching production.

create table if not exists chart_of_accounts (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  code text not null,
  label text not null,
  account_type text not null check (account_type in ('income', 'expense')),
  is_active boolean not null default true,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint chart_of_accounts_code_format check (code ~ '^[a-z0-9_]+$'),
  constraint chart_of_accounts_owner_code_unique unique (owner_id, code)
);

create index if not exists idx_chart_of_accounts_owner
  on chart_of_accounts(owner_id, account_type, label);

alter table chart_of_accounts enable row level security;
alter table chart_of_accounts force row level security;

drop policy if exists "chart_of_accounts_owner_select" on chart_of_accounts;
create policy "chart_of_accounts_owner_select" on chart_of_accounts for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "chart_of_accounts_owner_insert" on chart_of_accounts;
create policy "chart_of_accounts_owner_insert" on chart_of_accounts for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "chart_of_accounts_owner_update" on chart_of_accounts;
create policy "chart_of_accounts_owner_update" on chart_of_accounts for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "chart_of_accounts_owner_delete" on chart_of_accounts;
create policy "chart_of_accounts_owner_delete" on chart_of_accounts for delete to authenticated
  using (has_workspace_access(owner_id));

-- Seed the 16 long-standing default accounts for every owner that already
-- has ledger activity. Codes match the values already stored in
-- financial_events.normalized_category, so nothing is orphaned.
insert into chart_of_accounts (owner_id, code, label, account_type, is_system)
select distinct fe.owner_id, defaults.code, defaults.label, defaults.account_type, true
from financial_events as fe
cross join (values
  ('rental_income', 'Rental income', 'income'),
  ('cam_income', 'CAM income', 'income'),
  ('advertising', 'Advertising', 'expense'),
  ('auto', 'Auto and travel', 'expense'),
  ('cleaning', 'Cleaning and maintenance', 'expense'),
  ('commissions', 'Commissions', 'expense'),
  ('insurance', 'Insurance', 'expense'),
  ('legal_and_professional_fees', 'Legal and professional fees', 'expense'),
  ('management_fees', 'Management fees', 'expense'),
  ('mortgage_interest', 'Mortgage interest', 'expense'),
  ('other_interest', 'Other interest', 'expense'),
  ('property_repairs', 'Repairs', 'expense'),
  ('supplies', 'Supplies', 'expense'),
  ('property_tax', 'Taxes', 'expense'),
  ('utilities', 'Utilities', 'expense'),
  ('other', 'Other', 'expense')
) as defaults(code, label, account_type)
on conflict (owner_id, code) do nothing;

-- Owners with no ledger activity yet get their defaults lazily: the
-- chart-of-accounts API inserts any missing default codes on first read.
