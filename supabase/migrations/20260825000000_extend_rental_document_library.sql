-- Extends rental_documents (the table already backing Property actions -> File library, and the
-- table rental_lease_changes.document_evidence_id, rental_maintenance_work_orders.
-- invoice_document_id/completion_document_id, and rental_inspection_items.evidence_document_id
-- already FK into) with property-level documents, full-text search, version history, expiration
-- tracking, and an audit trail -- rather than creating a second document system. Until now every
-- rental_documents row required a lease_id, so a property with no lease yet (e.g. one still
-- "preparing", like 930 Highland Drive) had nowhere to store a survey, deed, or title policy.

alter table rental_documents alter column lease_id drop not null;
alter table rental_documents add column if not exists property_id text;
alter table rental_documents add column if not exists description text;
alter table rental_documents add column if not exists document_date date;
alter table rental_documents add column if not exists expires_at date;
-- Populated by native PDF text extraction (unpdf) first, falling back to Google Cloud Vision OCR
-- for scans/images, mirroring the existing property_evidence/HVAC-invoice extraction pipeline
-- (src/application/property-hvac/extractHVACInvoiceText.js) rather than a new one.
alter table rental_documents add column if not exists extracted_text text;
alter table rental_documents add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(extracted_text, '')), 'C')
  ) stored;
-- Version history: version_of_document_id always points at the ROOT row of a document family
-- (never chained hop-by-hop), so every version of the same logical document can be found in one
-- query (id = root or version_of_document_id = root). Preserving original files unchanged means a
-- new version is always a NEW row with its own object_path -- the old row, and its underlying
-- storage object, are never modified or removed.
alter table rental_documents add column if not exists version_of_document_id text;
alter table rental_documents add column if not exists version_number integer not null default 1;
alter table rental_documents add column if not exists is_current_version boolean not null default true;
alter table rental_documents add column if not exists created_by text;
alter table rental_documents add column if not exists updated_by text;
-- Soft delete only: preserving original files unchanged extends to never hard-deleting metadata or
-- the storage object either. A "deleted" document is hidden from normal views but remains
-- recoverable and auditable.
alter table rental_documents add column if not exists deleted_at timestamptz;

alter table rental_documents drop constraint if exists rental_documents_category_check;
alter table rental_documents add constraint rental_documents_category_check check(category in (
  'lease', 'addendum', 'notice', 'inspection', 'receipt', 'other',
  'survey_plat', 'deed', 'title_policy', 'insurance_policy', 'tax_document', 'appraisal', 'permit', 'warranty', 'hoa_document'
));

alter table rental_documents drop constraint if exists rental_documents_scope_check;
alter table rental_documents add constraint rental_documents_scope_check
  check(lease_id is not null or property_id is not null);

-- Property-level documents (survey, deed, title policy, ...) have no lease and therefore no
-- associated tenant -- they can never be published to the tenant portal.
alter table rental_documents drop constraint if exists rental_documents_tenant_visibility_check;
alter table rental_documents add constraint rental_documents_tenant_visibility_check
  check(tenant_visible = false or lease_id is not null);

alter table rental_documents drop constraint if exists rental_documents_version_of_fkey;
alter table rental_documents add constraint rental_documents_version_of_fkey
  foreign key (owner_id, version_of_document_id) references rental_documents(owner_id, id) on delete restrict;

create index if not exists idx_rental_documents_search on rental_documents using gin(search_vector);
create index if not exists idx_rental_documents_owner_property
  on rental_documents(owner_id, property_id, created_at desc) where property_id is not null;
create index if not exists idx_rental_documents_owner_expires
  on rental_documents(owner_id, expires_at) where expires_at is not null and deleted_at is null;
create index if not exists idx_rental_documents_version_family
  on rental_documents(owner_id, version_of_document_id);

-- Append-only audit trail: every upload, new version, edit, soft-delete, category change, and
-- signed-URL (download/preview) issuance is recorded. No update/delete grant -- once written, an
-- audit row is never revised.
create table if not exists rental_document_audit_log (
  id text primary key default ('rental_document_audit_' || gen_random_uuid()::text),
  owner_id text not null,
  document_id text not null,
  action text not null check(action in ('uploaded', 'versioned', 'edited', 'deleted', 'downloaded', 'category_changed')),
  actor_id text not null,
  actor_role text not null check(actor_role in ('owner', 'tenant')),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (owner_id, document_id) references rental_documents(owner_id, id) on delete cascade
);
create index if not exists idx_rental_document_audit_log_owner_document
  on rental_document_audit_log(owner_id, document_id, created_at desc);

alter table rental_document_audit_log enable row level security;
alter table rental_document_audit_log force row level security;
create policy "rental_document_audit_log_owner_select" on rental_document_audit_log for select to authenticated
  using(owner_id = auth.uid()::text);
create policy "rental_document_audit_log_owner_insert" on rental_document_audit_log for insert to authenticated
  with check(owner_id = auth.uid()::text);

grant select, insert on rental_document_audit_log to authenticated;
