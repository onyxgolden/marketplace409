-- Custom fields + custom forms / notice builder (Rentec parity R15) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- Rentec lets the owner define their own input fields that auto-populate
-- forms, and build custom forms (e.g. notices) in settings. Four tables:
--
-- rental_custom_fields
--   Field definitions. entity: 'tenant' | 'lease' | 'property' | 'unit'.
--   field_type: 'text' | 'number' | 'date' | 'yes_no' | 'picklist'.
--   picklist_options: jsonb array of strings (validated by the API when the
--     type is picklist; NULL for the other types).
--   field_key: stable slug derived from the name at creation, used for the
--     {{custom.<field_key>}} placeholders in custom forms. Unique per
--     (owner_id, entity, name) so two fields on the same record type can
--     never share a name.
--
-- rental_custom_field_values
--   Per-record values. record_id is the tenant/lease/property/unit id.
--   value_text stores the type-cleaned string (numbers as-is, dates
--   YYYY-MM-DD, yes/no as 'yes'/'no'); the app layer interprets the type.
--   One row per (field, record); deletes cascade when the definition goes.
--
-- rental_custom_forms
--   Custom form / notice templates with {{dotted.path}} placeholders. The
--   placeholder engine is renderNoticeTemplate() in
--   src/domains/rental-forms/formPlaceholders.js. kind: 'notice' | 'form'.
--   is_system/system_key mirrors R6 (rental_message_templates): the system
--   notice library (pay-or-quit, late notice, lease violation, move-out
--   reminder, rent increase, notice to enter) is NOT seeded here — the list
--   API idempotently upserts it from
--   src/domains/rental-forms/noticeLibrary.js on (owner_id, system_key).
--
-- rental_notice_log
--   Snapshots of rendered notices generated for a tenant. The rendered_body
--   is the full rendered text at generation time, so later template edits
--   can never rewrite history.
--
-- Security model (same as R6): RLS forced; select/insert/update/delete
-- policies gated on has_workspace_access(owner_id); the read-only-member
-- restriction (owner/co-owner write, read-only 403) is enforced in the API
-- route layer via getActiveWorkspaceRole, which RLS cannot see.
--
-- Additive only: no existing table is changed.

create table if not exists rental_custom_fields (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  entity text not null check (entity in ('tenant', 'lease', 'property', 'unit')),
  name text not null check (btrim(name) <> ''),
  field_key text not null check (btrim(field_key) <> ''),
  field_type text not null check (field_type in ('text', 'number', 'date', 'yes_no', 'picklist')),
  is_required boolean not null default false,
  picklist_options jsonb,
  sort_order integer not null default 0,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, entity, name),
  unique (owner_id, entity, field_key)
);

create index if not exists idx_rental_custom_fields_owner_entity
  on rental_custom_fields(owner_id, entity);

create table if not exists rental_custom_field_values (
  owner_id text not null,
  field_id text not null,
  record_id text not null,
  value_text text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, field_id, record_id),
  foreign key (owner_id, field_id) references rental_custom_fields(owner_id, id) on delete cascade
);

create index if not exists idx_rental_custom_field_values_owner_field
  on rental_custom_field_values(owner_id, field_id);

create table if not exists rental_custom_forms (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  system_key text,
  is_system boolean not null default false,
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('notice', 'form')),
  body text not null check (btrim(body) <> ''),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, system_key),
  check (is_system = false or system_key is not null)
);

create index if not exists idx_rental_custom_forms_owner_kind
  on rental_custom_forms(owner_id, kind);

create table if not exists rental_notice_log (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  tenant_id text not null,
  lease_id text,
  form_id text,
  form_name text not null check (btrim(form_name) <> ''),
  rendered_body text not null,
  created_by text,
  created_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists idx_rental_notice_log_owner_tenant
  on rental_notice_log(owner_id, tenant_id, created_at desc);

alter table rental_custom_fields enable row level security;
alter table rental_custom_fields force row level security;
alter table rental_custom_field_values enable row level security;
alter table rental_custom_field_values force row level security;
alter table rental_custom_forms enable row level security;
alter table rental_custom_forms force row level security;
alter table rental_notice_log enable row level security;
alter table rental_notice_log force row level security;

drop policy if exists "rental_custom_fields_owner_select" on rental_custom_fields;
create policy "rental_custom_fields_owner_select" on rental_custom_fields for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_custom_fields_owner_insert" on rental_custom_fields;
create policy "rental_custom_fields_owner_insert" on rental_custom_fields for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_custom_fields_owner_update" on rental_custom_fields;
create policy "rental_custom_fields_owner_update" on rental_custom_fields for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_custom_fields_owner_delete" on rental_custom_fields;
create policy "rental_custom_fields_owner_delete" on rental_custom_fields for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_custom_field_values_owner_select" on rental_custom_field_values;
create policy "rental_custom_field_values_owner_select" on rental_custom_field_values for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_custom_field_values_owner_insert" on rental_custom_field_values;
create policy "rental_custom_field_values_owner_insert" on rental_custom_field_values for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_custom_field_values_owner_update" on rental_custom_field_values;
create policy "rental_custom_field_values_owner_update" on rental_custom_field_values for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_custom_field_values_owner_delete" on rental_custom_field_values;
create policy "rental_custom_field_values_owner_delete" on rental_custom_field_values for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_custom_forms_owner_select" on rental_custom_forms;
create policy "rental_custom_forms_owner_select" on rental_custom_forms for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_custom_forms_owner_insert" on rental_custom_forms;
create policy "rental_custom_forms_owner_insert" on rental_custom_forms for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_custom_forms_owner_update" on rental_custom_forms;
create policy "rental_custom_forms_owner_update" on rental_custom_forms for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_custom_forms_owner_delete" on rental_custom_forms;
create policy "rental_custom_forms_owner_delete" on rental_custom_forms for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_notice_log_owner_select" on rental_notice_log;
create policy "rental_notice_log_owner_select" on rental_notice_log for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_notice_log_owner_insert" on rental_notice_log;
create policy "rental_notice_log_owner_insert" on rental_notice_log for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_notice_log_owner_update" on rental_notice_log;
create policy "rental_notice_log_owner_update" on rental_notice_log for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_notice_log_owner_delete" on rental_notice_log;
create policy "rental_notice_log_owner_delete" on rental_notice_log for delete to authenticated
  using (has_workspace_access(owner_id));

revoke all on rental_custom_fields from anon, authenticated;
grant select, insert, update, delete on rental_custom_fields to authenticated;
revoke all on rental_custom_field_values from anon, authenticated;
grant select, insert, update, delete on rental_custom_field_values to authenticated;
revoke all on rental_custom_forms from anon, authenticated;
grant select, insert, update, delete on rental_custom_forms to authenticated;
revoke all on rental_notice_log from anon, authenticated;
grant select, insert, update, delete on rental_notice_log to authenticated;
