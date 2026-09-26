-- Rental ledger foundation: transaction register fields, split lines, attachments.
-- Slices 2-4 of the rental accounting build (Rentec-style register) sit on these.
--
-- 1. financial_events gains the register columns Rentec's bank ledger shows:
--    payee, check_number, bank_account_id (FK to financial_accounts), cleared/cleared_at.
-- 2. financial_event_splits: a transaction's category split lines (one parent event,
--    many category lines; amounts must be positive).
-- 3. financial_event_attachments: receipt/statement files attached to a transaction,
--    stored in the new private `rental-ledger-attachments` bucket.
-- 4. RLS mirrors financial_events' workspace pattern: has_workspace_access(owner_id).
-- 5. Storage bucket follows the rental-documents pattern (owner folder, private).

-- ---------------------------------------------------------------------------
-- 1. New columns on financial_events
-- ---------------------------------------------------------------------------
alter table financial_events
  add column if not exists payee text,
  add column if not exists check_number text,
  add column if not exists bank_account_id text,
  add column if not exists cleared boolean not null default false,
  add column if not exists cleared_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'financial_events_bank_account_id_fkey'
  ) then
    alter table financial_events
      add constraint financial_events_bank_account_id_fkey
      foreign key (bank_account_id) references financial_accounts(id) on delete set null;
  end if;
end $$;

create index if not exists idx_financial_events_bank_account
  on financial_events(bank_account_id, event_date)
  where bank_account_id is not null;

-- ---------------------------------------------------------------------------
-- 2. financial_event_splits
-- ---------------------------------------------------------------------------
create table if not exists financial_event_splits (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  parent_event_id text not null references financial_events(id) on delete cascade,
  normalized_category text not null check (normalized_category in (
    'rental_income', 'cam_income', 'advertising', 'auto', 'cleaning', 'commissions',
    'insurance', 'legal_and_professional_fees', 'management_fees', 'mortgage_interest',
    'other_interest', 'property_repairs', 'supplies', 'property_tax', 'utilities', 'other'
  )),
  amount numeric not null check (amount > 0),
  memo text,
  created_at timestamptz not null default now()
);

create index if not exists idx_financial_event_splits_parent
  on financial_event_splits(parent_event_id);

alter table financial_event_splits enable row level security;
alter table financial_event_splits force row level security;

drop policy if exists "financial_event_splits_owner_select" on financial_event_splits;
create policy "financial_event_splits_owner_select" on financial_event_splits for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "financial_event_splits_owner_insert" on financial_event_splits;
create policy "financial_event_splits_owner_insert" on financial_event_splits for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "financial_event_splits_owner_update" on financial_event_splits;
create policy "financial_event_splits_owner_update" on financial_event_splits for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "financial_event_splits_owner_delete" on financial_event_splits;
create policy "financial_event_splits_owner_delete" on financial_event_splits for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 3. financial_event_attachments
-- ---------------------------------------------------------------------------
create table if not exists financial_event_attachments (
  id text primary key default gen_random_uuid()::text,
  owner_id text not null,
  event_id text not null references financial_events(id) on delete cascade,
  bucket text not null,
  object_path text not null,
  filename text not null,
  mime_type text,
  size_bytes bigint,
  created_at timestamptz not null default now(),
  unique (bucket, object_path),
  check (split_part(object_path, '/', 1) = owner_id)
);

create index if not exists idx_financial_event_attachments_event
  on financial_event_attachments(event_id);

alter table financial_event_attachments enable row level security;
alter table financial_event_attachments force row level security;

drop policy if exists "financial_event_attachments_owner_select" on financial_event_attachments;
create policy "financial_event_attachments_owner_select" on financial_event_attachments for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "financial_event_attachments_owner_insert" on financial_event_attachments;
create policy "financial_event_attachments_owner_insert" on financial_event_attachments for insert to authenticated
  with check (has_workspace_access(owner_id));

drop policy if exists "financial_event_attachments_owner_update" on financial_event_attachments;
create policy "financial_event_attachments_owner_update" on financial_event_attachments for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

drop policy if exists "financial_event_attachments_owner_delete" on financial_event_attachments;
create policy "financial_event_attachments_owner_delete" on financial_event_attachments for delete to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- 4. Private storage bucket for ledger attachments
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rental-ledger-attachments', 'rental-ledger-attachments', false, 10485760,
  array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "rental_ledger_attachment_objects_owner_select" on storage.objects;
create policy "rental_ledger_attachment_objects_owner_select" on storage.objects for select to authenticated
  using (bucket_id = 'rental-ledger-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "rental_ledger_attachment_objects_owner_insert" on storage.objects;
create policy "rental_ledger_attachment_objects_owner_insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'rental-ledger-attachments' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "rental_ledger_attachment_objects_owner_delete" on storage.objects;
create policy "rental_ledger_attachment_objects_owner_delete" on storage.objects for delete to authenticated
  using (bucket_id = 'rental-ledger-attachments' and (storage.foldername(name))[1] = auth.uid()::text);
