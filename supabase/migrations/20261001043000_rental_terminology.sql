-- Terminology customization (Rentec parity R25) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- One row per workspace on rental_terminology_settings: the owner-editable
-- term map that renames the five core rental concepts workspace-wide
-- (tenant, property, lease, owner, vendor — singular + plural each).
-- Absent row = defaults ("tenant"/"tenants" etc.); resolution is
-- fail-open to the defaults (see src/domains/rental-terminology/rentalTerminology.js),
-- so a workspace that never visits the Terminology page renders exactly as today.
--
-- Security model: RLS forced; select/insert/update gated on
-- has_workspace_access(owner_id) (the workspace pattern). The read-only-member
-- restriction (owner/co-owner write, read-only 403) is enforced in the API
-- route layer via getActiveWorkspaceRole, matching the R6 message-templates
-- route — RLS cannot see that role distinction.
--
-- Additive only: no existing table is changed.

create table if not exists rental_terminology_settings (
  owner_id text not null primary key,
  terms jsonb not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(terms) = 'object')
);

alter table rental_terminology_settings enable row level security;
alter table rental_terminology_settings force row level security;

drop policy if exists "rental_terminology_settings_owner_select" on rental_terminology_settings;
create policy "rental_terminology_settings_owner_select" on rental_terminology_settings for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_terminology_settings_owner_insert" on rental_terminology_settings;
create policy "rental_terminology_settings_owner_insert" on rental_terminology_settings for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_terminology_settings_owner_update" on rental_terminology_settings;
create policy "rental_terminology_settings_owner_update" on rental_terminology_settings for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));

revoke all on rental_terminology_settings from anon, authenticated;
grant select, insert, update on rental_terminology_settings to authenticated;
