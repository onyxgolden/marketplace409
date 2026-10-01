-- Online rental application + public listings (Rentec parity R21, free layer).
-- AUTHORED, NOT APPLIED. Jason applies migrations.
--
-- Free layer (this migration):
--   * rental_listing_forms: owner-built application forms — which sections are
--     on, the application fee (record-only, no collection), the screening
--     consent text, and custom questions (standalone JSON; unifies with the
--     R15 custom-fields system if/when that ships).
--   * rental_listings: one public listing per vacant unit (draft/published/
--     unpublished), with a random public_slug for the SEO-friendly URL.
--   * rental_applications: applications submitted through the public form —
--     pending until the owner approves/denies from the review queue.
--   * rental_application_decisions: append-only audit of every approve/deny.
--   * rental_application_rate_limits: DB-backed per-IP/per-listing submission
--     log so the public form's spam guard survives serverless restarts.
--
-- Explicitly OUT of this slice: live application-fee collection (record-only),
-- tenant screening checks (R22), and auto-posting to syndication sites
-- (HARD GATE — the stub in src/domains/rental-listings/syndication.js always
-- reports "not connected"; posting APIs need Jason's word per the
-- build-spend doctrine).
--
-- Security model: RLS forced; all policies gated on
-- has_workspace_access(owner_id) (the workspace pattern). Public (no-login)
-- reads go through the service-role client in the API route layer, scoped to
-- a published listing's public_slug — RLS still denies anon/authenticated.
-- The read-only-member restriction (owner/co-owner write, read-only 403) is
-- enforced in the API route layer via getActiveWorkspaceRole, matching the
-- R6 message-templates route — RLS cannot see that role distinction.
--
-- Additive only: no existing table is changed.

create table if not exists rental_listing_forms (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  name text not null check (btrim(name) <> ''),
  is_default boolean not null default false,
  -- Section toggles: personal_info, residence_history, employment,
  -- references. custom_questions is the standalone question set:
  -- [{ key, label, type('text'|'textarea'|'select'|'checkbox'), required, options[] }]
  sections jsonb not null default '{"personal_info": true, "residence_history": true, "employment": true, "references": true}'::jsonb,
  custom_questions jsonb not null default '[]'::jsonb,
  -- Application fee is RECORD-ONLY in R21: recorded on the application for
  -- the owner to collect offline. No live payment collection.
  fee_amount_cents bigint not null default 0 check (fee_amount_cents >= 0),
  consent_text text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create table if not exists rental_listings (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  unit_id text not null,
  property_id text not null,
  -- Random 12-char slug: the public URL (/rentals/<slug>). Never the unit id.
  public_slug text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'unpublished')),
  title text not null check (btrim(title) <> ''),
  description text,
  rent_cents bigint check (rent_cents is null or rent_cents > 0),
  beds_display text,
  baths_display text,
  square_feet numeric check (square_feet is null or square_feet >= 0),
  pet_policy text,
  available_at timestamptz,
  -- Photo snapshot: [{ bucket, path }] copied from the unit at publish time
  -- so the public page never depends on the unit row's current photo.
  photos jsonb not null default '[]'::jsonb,
  contact_email text,
  contact_phone text,
  listing_form_id text,
  view_count integer not null default 0 check (view_count >= 0),
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, public_slug),
  foreign key (owner_id, unit_id) references rental_units(owner_id, id) on delete restrict,
  foreign key (owner_id, listing_form_id) references rental_listing_forms(owner_id, id) on delete set null
);

create table if not exists rental_applications (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  listing_id text not null,
  form_id text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied', 'withdrawn')),
  -- Applicant answers keyed by form field: { personal: {...}, residence: [...],
  -- employment: {...}, references: [...], custom: { key: value }, consent: true }
  answers jsonb not null default '{}'::jsonb,
  -- Recorded (not collected) fee from the form at submit time.
  fee_amount_cents bigint not null default 0 check (fee_amount_cents >= 0),
  fee_recorded boolean not null default false,
  denial_reason text,
  tenant_id text,
  lease_id text,
  decided_by text,
  decided_at timestamptz,
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, listing_id) references rental_listings(owner_id, id) on delete restrict,
  foreign key (owner_id, form_id) references rental_listing_forms(owner_id, id) on delete set null,
  foreign key (owner_id, tenant_id) references rental_tenants(owner_id, id) on delete set null,
  foreign key (owner_id, lease_id) references rental_leases(owner_id, id) on delete set null,
  check (status <> 'denied' or denial_reason is not null)
);

create table if not exists rental_application_decisions (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  application_id text not null,
  action text not null check (action in ('approved', 'denied', 'withdrawn')),
  reason text,
  actor_user_id text not null,
  tenant_id text,
  lease_id text,
  created_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, application_id) references rental_applications(owner_id, id) on delete cascade
);

create table if not exists rental_application_rate_limits (
  owner_id text not null,
  id text not null default gen_random_uuid()::text,
  listing_id text not null,
  ip_hash text not null,
  submitted_at timestamptz not null default now(),
  primary key (owner_id, id)
);

create index if not exists idx_rental_listings_owner_status on rental_listings(owner_id, status);
create index if not exists idx_rental_listings_owner_unit on rental_listings(owner_id, unit_id);
create index if not exists idx_rental_listing_forms_owner_default on rental_listing_forms(owner_id, is_default);
create index if not exists idx_rental_applications_owner_status on rental_applications(owner_id, status);
create index if not exists idx_rental_applications_owner_listing on rental_applications(owner_id, listing_id);
create index if not exists idx_rental_application_rate_limits_guard
  on rental_application_rate_limits(owner_id, listing_id, ip_hash, submitted_at desc);

-- RLS: forced on, workspace-access policies, explicit grants (R6 pattern).

alter table rental_listing_forms enable row level security;
alter table rental_listing_forms force row level security;
alter table rental_listings enable row level security;
alter table rental_listings force row level security;
alter table rental_applications enable row level security;
alter table rental_applications force row level security;
alter table rental_application_decisions enable row level security;
alter table rental_application_decisions force row level security;
alter table rental_application_rate_limits enable row level security;
alter table rental_application_rate_limits force row level security;

drop policy if exists "rental_listing_forms_owner_select" on rental_listing_forms;
create policy "rental_listing_forms_owner_select" on rental_listing_forms for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_listing_forms_owner_insert" on rental_listing_forms;
create policy "rental_listing_forms_owner_insert" on rental_listing_forms for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_listing_forms_owner_update" on rental_listing_forms;
create policy "rental_listing_forms_owner_update" on rental_listing_forms for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_listing_forms_owner_delete" on rental_listing_forms;
create policy "rental_listing_forms_owner_delete" on rental_listing_forms for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_listings_owner_select" on rental_listings;
create policy "rental_listings_owner_select" on rental_listings for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_listings_owner_insert" on rental_listings;
create policy "rental_listings_owner_insert" on rental_listings for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_listings_owner_update" on rental_listings;
create policy "rental_listings_owner_update" on rental_listings for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_listings_owner_delete" on rental_listings;
create policy "rental_listings_owner_delete" on rental_listings for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_applications_owner_select" on rental_applications;
create policy "rental_applications_owner_select" on rental_applications for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_applications_owner_insert" on rental_applications;
create policy "rental_applications_owner_insert" on rental_applications for insert to authenticated
  with check (has_workspace_access(owner_id));
drop policy if exists "rental_applications_owner_update" on rental_applications;
create policy "rental_applications_owner_update" on rental_applications for update to authenticated
  using (has_workspace_access(owner_id)) with check (has_workspace_access(owner_id));
drop policy if exists "rental_applications_owner_delete" on rental_applications;
create policy "rental_applications_owner_delete" on rental_applications for delete to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists "rental_application_decisions_owner_select" on rental_application_decisions;
create policy "rental_application_decisions_owner_select" on rental_application_decisions for select to authenticated
  using (has_workspace_access(owner_id));
drop policy if exists "rental_application_decisions_owner_insert" on rental_application_decisions;
create policy "rental_application_decisions_owner_insert" on rental_application_decisions for insert to authenticated
  with check (has_workspace_access(owner_id));

-- Rate-limit rows are written by the service-role public route, never by
-- workspace members: no member policies at all.
revoke all on rental_listing_forms from anon, authenticated;
grant select, insert, update, delete on rental_listing_forms to authenticated;
revoke all on rental_listings from anon, authenticated;
grant select, insert, update, delete on rental_listings to authenticated;
revoke all on rental_applications from anon, authenticated;
grant select, insert, update, delete on rental_applications to authenticated;
revoke all on rental_application_decisions from anon, authenticated;
grant select, insert on rental_application_decisions to authenticated;
revoke all on rental_application_rate_limits from anon, authenticated;
