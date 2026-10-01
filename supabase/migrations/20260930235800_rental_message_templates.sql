-- Message templates library (Rentec parity R6) — AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- One library for email, text, and mailing templates (Settings → Program →
-- Message templates in Rentec's IA; FORGE mounts it in the Communications
-- panel). Columns:
--   * kind: 'email' | 'text' | 'mailing'. The R6 UI builds email + text;
--     'mailing' rows are allowed by the schema for the R20 Mailing Manager
--     slice, which reuses this table.
--   * audience: 'tenant' | 'owner' — separate versions of each template, as
--     in Rentec.
--   * is_system / system_key: system defaults are NOT seeded here (a
--     migration cannot know future workspaces). The list API idempotently
--     upserts the catalog from src/domains/rental-messaging/messageTemplates.js
--     on (owner_id, system_key) the first time each workspace reads the
--     library, so every workspace always sees the full system set and a
--     re-applied migration never duplicates them.
--   * Custom templates have system_key NULL (Postgres treats NULLs as
--     distinct, so the unique constraint never blocks two custom rows).
--   * Body uses {{field}} placeholders; the single server-side renderer is
--     renderMessageTemplate() in the same domain module.
--
-- Security model: RLS forced; select/insert/update/delete policies gated on
-- has_workspace_access(owner_id) (the workspace pattern, see
-- 20260926200000_create_bank_reconciliations.sql). The read-only-member
-- restriction (owner/co-owner write, read-only 403) is enforced in the API
-- route layer via getActiveWorkspaceRole, matching the R5 work-order
-- messaging route — RLS cannot see that role distinction.
--
-- Additive only: no existing table is changed.

create table if not exists rental_message_templates (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  system_key text,
  is_system boolean not null default false,
  name text not null check (btrim(name) <> ''),
  kind text not null check (kind in ('email', 'text', 'mailing')),
  audience text not null check (audience in ('tenant', 'owner')),
  subject text,
  body text not null check (btrim(body) <> ''),
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, system_key),
  check (is_system = false or system_key is not null),
  check (kind <> 'email' or btrim(coalesce(subject, '')) <> '')
);

create index if not exists idx_rental_message_templates_owner_kind_audience
  on rental_message_templates(owner_id, kind, audience);

alter table rental_message_templates enable row level security;
alter table rental_message_templates force row level security;

drop policy if exists "rental_message_templates_owner_select" on rental_message_templates;
create policy "rental_message_templates_owner_select" on rental_message_templates for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_message_templates_owner_insert" on rental_message_templates;
create policy "rental_message_templates_owner_insert" on rental_message_templates for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_message_templates_owner_update" on rental_message_templates;
create policy "rental_message_templates_owner_update" on rental_message_templates for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_message_templates_owner_delete" on rental_message_templates;
create policy "rental_message_templates_owner_delete" on rental_message_templates for delete to authenticated
  using (has_workspace_access(owner_id));

revoke all on rental_message_templates from anon, authenticated;
grant select, insert, update, delete on rental_message_templates to authenticated;
