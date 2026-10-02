-- Mailing Manager (Rentec parity R20) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- Certified-letter mailings: templates are rows in rental_message_templates
-- with kind = 'mailing' (the R6 schema reserved that kind for this slice; the
-- system catalog seeds live in
-- src/domains/rental-messaging/messageTemplates.js). This migration adds the
-- two tables that track the actual letters:
--
--   * rental_mail_batches: one bulk send (e.g. "October late notices").
--   * rental_mail_letters: one rendered letter per tenant. The rendered body
--     is SNAPSHOT on the row at compose time, so the compliance paper trail
--     survives later template edits. Status moves queued → mailed →
--     delivered; the allowed transitions are enforced in the API route (the
--     domain guard lives in src/domains/rental-mailing/mailingLetters.js).
--   * tracking_number is manual entry: the owner mails at the post office
--     and types in the USPS tracking number — no paid mail API is called.
--   * document_id links the file-library copy (rental_documents, category
--     'notice') uploaded at batch creation.
--   * provider_send_id stays NULL until Jason approves a paid mail provider;
--     the send path is hard-gated (see src/domains/rental-mailing/mailProvider.js).
--
-- Security model: RLS forced; select/insert/update/delete policies gated on
-- has_workspace_access(owner_id) (the workspace pattern, see
-- 20260926200000_create_bank_reconciliations.sql). The read-only-member
-- restriction (owner/co-owner write, read-only 403) is enforced in the API
-- route layer via getActiveWorkspaceRole — RLS cannot see that role
-- distinction. Explicit grants follow the R6 template-table pattern.
--
-- Additive only: no existing table is changed. The unique partial index
-- (batch, tenant) prevents queueing the same tenant twice in one batch.

create table if not exists rental_mail_batches (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  name text not null check (btrim(name) <> ''),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists rental_mail_letters (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  batch_id text,
  template_id text,
  tenant_id text not null,
  lease_id text,
  tenant_name text not null check (btrim(tenant_name) <> ''),
  recipient_address text not null check (btrim(recipient_address) <> ''),
  return_address text,
  subject text,
  body text not null check (btrim(body) <> ''),
  letter_date date not null default current_date,
  status text not null default 'queued' check (status in ('queued', 'mailed', 'delivered')),
  tracking_number text,
  mailed_at timestamptz,
  delivered_at timestamptz,
  document_id text,
  provider_send_id text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, batch_id) references rental_mail_batches (owner_id, id) on delete set null,
  foreign key (owner_id, lease_id) references rental_leases (owner_id, id) on delete set null
);

create unique index if not exists uq_rental_mail_letters_batch_tenant
  on rental_mail_letters (owner_id, batch_id, tenant_id)
  where batch_id is not null;

create index if not exists idx_rental_mail_letters_owner_status
  on rental_mail_letters (owner_id, status, created_at desc);

alter table rental_mail_batches enable row level security;
alter table rental_mail_batches force row level security;
alter table rental_mail_letters enable row level security;
alter table rental_mail_letters force row level security;

drop policy if exists "rental_mail_batches_owner_select" on rental_mail_batches;
create policy "rental_mail_batches_owner_select" on rental_mail_batches for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_mail_batches_owner_insert" on rental_mail_batches;
create policy "rental_mail_batches_owner_insert" on rental_mail_batches for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_mail_batches_owner_update" on rental_mail_batches;
create policy "rental_mail_batches_owner_update" on rental_mail_batches for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_mail_batches_owner_delete" on rental_mail_batches;
create policy "rental_mail_batches_owner_delete" on rental_mail_batches for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_mail_letters_owner_select" on rental_mail_letters;
create policy "rental_mail_letters_owner_select" on rental_mail_letters for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_mail_letters_owner_insert" on rental_mail_letters;
create policy "rental_mail_letters_owner_insert" on rental_mail_letters for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_mail_letters_owner_update" on rental_mail_letters;
create policy "rental_mail_letters_owner_update" on rental_mail_letters for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_mail_letters_owner_delete" on rental_mail_letters;
create policy "rental_mail_letters_owner_delete" on rental_mail_letters for delete to authenticated
  using (has_workspace_access(owner_id));

revoke all on rental_mail_batches from anon, authenticated;
grant select, insert, update, delete on rental_mail_batches to authenticated;
revoke all on rental_mail_letters from anon, authenticated;
grant select, insert, update, delete on rental_mail_letters to authenticated;
