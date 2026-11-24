-- =============================================================================
-- Work Package Planner — Field Verification slice
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more. Jason approved this build as scoped 2026-11-16
-- (results/chatgpt/work-package-planner-field-verification-scope-
-- 2026-11-16.md) and gave the build word 2026-11-20 ("Build field
-- verification first", before templates).
--
-- Scope (brief §§1-4): field verification is a dated, evidence-backed
-- human attestation that a portion of planned work was physically
-- checked against a named plan and recorded actuals. Primary attach
-- target: one work step in one work package. Secondary: one takeoff
-- line. One record per observation in forge_work_field_verifications
-- + immutable forge_work_field_verification_revisions audit stream +
-- optional validated links in forge_work_field_verification_links.
-- State machine DRAFT -> SUBMITTED -> ACCEPTED / RETURNED / REJECTED,
-- RETURNED -> SUBMITTED; two-person integrity (verifier must differ
-- from submitter); versioned edits/soft retirement with reasons.
-- READ AND ANNOTATE ONLY — never locks, recalculates, corrects, voids,
-- creates or changes slice-2 progress; never creates/closes/dispositions
-- busts; never approves change orders or re-baselines; nothing is gated
-- by this slice. No milestone assumptions; no bridge-migration
-- dependency (works with no plan-baseline row); no auto-verification;
-- no background jobs/alerts/notifications.
--
-- What this slice adds:
--   * forge_work_field_verifications — one row per independently
--     reviewed observation, with the source snapshot taken server-side
--     at create time (step version + planned hours, or line planned
--     quantity/unit + installed-as-of total + contributing progress
--     entry ids + digest) and a source fingerprint the submit/accept
--     RPCs recompute live and refuse when stale (SOURCE_CHANGED).
--     Variances are derived from stored snapshots, never
--     client-submitted authoritative math.
--   * forge_work_field_verification_revisions — append-only, immutable
--     (trigger + no write grants): one row per version of every
--     mutation, atomic with the mutation itself. request_id carries
--     the caller's idempotency key; new_values.requestDigest binds
--     the replay check. Every mutation — create, update, decision,
--     retire, link, unlink — bumps the verification version by one
--     and writes exactly one revision at the new version, so the
--     (owner_id, verification_id, version) unique key is never
--     violated by a second action at the same version.
--   * forge_work_field_verification_links — validated links to busts,
--     change orders, progress entries, or drawings. One typed FK
--     column per kind (exactly one set, enforced by CHECK); the RPC
--     proves the exact owner/package parent chain and target
--     existence. A link never closes a bust, never approves a change
--     order, never mutates the linked record.
--   * forge_work_field_verification_sources — SECURITY INVOKER, STABLE
--     read RPC. ONE statement returns the target, its planned figures,
--     the installed-as-of total with contributing entry ids and the
--     source fingerprint, the drawing + latest revision, and the
--     package status — so a new observation can never be recorded
--     against a mixed-revision source.
--   * forge_work_field_verification_source_statuses — SECURITY
--     INVOKER, STABLE read RPC. One call maps every verification in
--     a package to CURRENT / CHANGED_SINCE_REVIEW / TARGET_RETIRED
--     by comparing the stored fingerprint to the live recomputation.
--   * Write RPCs (SECURITY DEFINER, actor from auth.uid(), never a
--     caller-supplied value): verification_create/update/decision/
--     retire, verification_link/unlink. Every write refuses terminal
--     packages (cancelled, verified_closed) for create/update/
--     decision — a closed package is read-only for this slice, except
--     retire, which the owner may still use to retire open drafts/
--     submissions for audit (brief §4).
--
-- Design decisions (recorded, not silently made):
--   * Role model (brief §5 vs the proven effective model): the brief
--     proposes "verification-write" and "verification-decide"
--     permissions, but no such capability keys exist in the repo —
--     has_forge_hierarchy_permission knows exactly
--     'forge.hierarchy.read' / 'forge.hierarchy.manage' and fails
--     unknown keys closed, and every planner slice (2, 5, 8, 9)
--     gates its write RPCs on has_workspace_access (owner or active
--     co-owner). Inventing new capability keys would be inventing
--     authority constructs outside this slice's scope. This slice
--     follows the proven model: all write RPCs gate on
--     has_workspace_access; the two-person rule (reviewer must differ
--     from the submitter) is enforced inside the decision RPC; the
--     package designated_verifier confers no additional authority
--     beyond workspace access (it is not silently broadened). A
--     finer-grained planner/field-lead vs verifier role split is a
--     separate, separately scoped change if Jason ever wants it.
--   * Drawing revision identity IS proven: forge_wp_drawing_revisions
--     (slice 7) carries (owner_id, package_id, drawing_id, id) with
--     revision_code/document_ref/content_sha256/issued_as, so the
--     verification's source_drawing_revision_id is a real composite
--     FK, not a forged string. A retired revision cannot be the
--     source of a NEW observation; an accepted record keeps its
--     reference after retirement and shows "Drawing revision no
--     longer current".
--   * scope_baseline_id/version are an OPAQUE provenance pointer
--     only (brief §3): stored, length-checked, never validated
--     against forge_work_package_baselines and never confused with
--     baseline_kind. The slice works with no plan-baseline row.
--   * The source fingerprint is server-computed only (md5 of a
--     canonical text, a core PostgreSQL function — no extension
--     dependency, so the PGlite battery needs no pgcrypto). The
--     client passes the reviewed fingerprint back opaquely; it never
--     computes one, so there is no JS/SQL fingerprint-parity surface
--     to drift. It is a freshness guard, not a security hash. The
--     two SECURITY INVOKER read RPCs (sources, source_statuses)
--     compute it INLINE, byte-identical to the helper — an invoker
--     context cannot call the revoked helper (the execute check runs
--     as the caller), the same rule the busts slice follows. The
--     SECURITY DEFINER write RPCs call the helper; the migration
--     battery cross-checks the inline copies against the helper on
--     every create (stored fingerprint must equal the sources
--     fingerprint) and on every status check.
--   * Step-to-progress attribution is NOT implemented (brief §1,
--     slice 5's own deferral): a step verification stores no progress
--     entry ids, no installed total, no progress digest. Never infer
--     a line from the step title or craft.
--   * Deletion eligibility: verifications are registered in
--     forge_work_package_deletion_blocker_counts (this file CREATE OR
--     REPLACEs the function with the 20261113030000 body verbatim
--     plus the three new branches — the earlier 20261110070000 body
--     is superseded; copying from it would have dropped the
--     gate/permit/craft-rate branches and silently unblocked
--     deletions). Carry-forward (2026-11-24): the PR #784 fix
--     round's budget_allocations and bust_change_order_links arms
--     are carried forward here too, so this file applying after
--     #784 does not clobber them; the fix round's
--     field_verification_change_order_links arm is already covered
--     by this file's own all-links arm below. Unlike steps, retired
--     a verification is immutable audit history with no hard-delete
--     path, so purging it on package delete would erase attestations
--     — a package that ever held a verification can never be
--     hard-deleted, and the blocker reports it cleanly as a 409
--     instead of a raw FK 500. The delete function itself is
--     untouched (it already calls the blocker function).
--   * Terminal-package retire carve-out: retire stays available on
--     cancelled/verified_closed packages so the owner can retire open
--     drafts/submissions for audit (brief §4). Create/update/
--     decision/link/unlink refuse terminal packages.
--
-- Live collision check, 2026-11-20 (before writing this file):
--   * No repo migration file 20261120000000 exists (latest repo file
--     is 20261118020000, the health-document RLS migration).
--   * No live table or function with a field_verification name
--     exists — verified by a live catalog read is NOT possible from
--     this VM (no production connectivity here); the PGlite battery
--     applies this file after the prerequisite slices and proves the
--     names are fresh there, and the apply-time receipt must
--     re-verify the live catalog before declaring done (standing
--     rule).
--   * The sb-sql --file apply transport does not record rows in
--     supabase_migrations.schema_migrations, so the history table is
--     not a collision signal here; the live catalog is.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One field verification: one independently reviewed observation
-- against one step or one takeoff line. The source snapshot is taken
-- server-side at create time; a later plan change never rewrites it.
create table if not exists public.forge_work_field_verifications (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  target_type text not null check (target_type in ('WORK_STEP', 'TAKEOFF_LINE')),
  step_id text,
  takeoff_line_id text,
  work_location text not null check (work_location in ('SHOP', 'FIELD')),
  inspection_date date not null,
  source_checked_at timestamptz not null,
  source_step_version integer check (source_step_version is null or source_step_version >= 1),
  source_line_id text,
  source_drawing_id text,
  source_drawing_revision_id text,
  scope_baseline_id text
    check (scope_baseline_id is null or char_length(scope_baseline_id) between 1 and 200)
    check (scope_baseline_id is null or scope_baseline_id !~ '[[:cntrl:]]'),
  scope_baseline_version integer check (scope_baseline_version is null or scope_baseline_version >= 1),
  source_progress_entry_ids text[],
  progress_as_of date,
  source_progress_digest text check (source_progress_digest is null or char_length(source_progress_digest) = 32),
  source_progress_total_quantity numeric(18, 4) check (source_progress_total_quantity is null or source_progress_total_quantity >= 0),
  source_fingerprint text not null check (char_length(source_fingerprint) = 32),
  planned_step_hours numeric(12, 2)
    check (planned_step_hours is null or (planned_step_hours > 0 and planned_step_hours <= 1000000
      and planned_step_hours = round(planned_step_hours, 2))),
  planned_line_quantity numeric(18, 4) check (planned_line_quantity is null or planned_line_quantity >= 0),
  unit text check (unit is null or (char_length(btrim(unit)) >= 1 and char_length(unit) <= 40)),
  observed_installed_quantity numeric(18, 4)
    check (observed_installed_quantity is null or observed_installed_quantity >= 0)
    check (observed_installed_quantity is null or observed_installed_quantity = round(observed_installed_quantity, 4)),
  observed_basis text
    check (observed_basis is null or char_length(observed_basis) between 1 and 1000)
    check (observed_basis is null or observed_basis !~ '[[:cntrl:]]'),
  physical_completion text check (physical_completion is null or physical_completion in (
    'NOT_COMPLETE', 'PARTIALLY_COMPLETE', 'COMPLETE', 'UNABLE_TO_VERIFY')),
  acceptance_criteria_checked text
    check (acceptance_criteria_checked is null or char_length(acceptance_criteria_checked) between 1 and 2000)
    check (acceptance_criteria_checked is null or acceptance_criteria_checked !~ '[[:cntrl:]]'),
  field_reported_hours numeric(12, 2)
    check (field_reported_hours is null or (field_reported_hours >= 0 and field_reported_hours <= 1000000
      and field_reported_hours = round(field_reported_hours, 2))),
  field_hours_source text
    check (field_hours_source is null or char_length(field_hours_source) between 1 and 500)
    check (field_hours_source is null or field_hours_source !~ '[[:cntrl:]]'),
  observation_note text not null
    check (char_length(btrim(observation_note)) >= 1 and char_length(observation_note) <= 2000)
    check (observation_note !~ '[[:cntrl:]]'),
  evidence_ref text
    check (evidence_ref is null or char_length(evidence_ref) between 1 and 500)
    check (evidence_ref is null or evidence_ref !~ '[[:cntrl:]]'),
  evidence_summary text
    check (evidence_summary is null or char_length(evidence_summary) <= 2000)
    check (evidence_summary is null or evidence_summary !~ '[[:cntrl:]]'),
  status text not null default 'DRAFT' check (status in (
    'DRAFT', 'SUBMITTED', 'ACCEPTED', 'RETURNED', 'REJECTED', 'RETIRED')),
  version integer not null default 1 check (version >= 1),
  supersedes_verification_id text,
  submitted_by text,
  submitted_at timestamptz,
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text
    check (review_note is null or char_length(review_note) <= 2000)
    check (review_note is null or review_note !~ '[[:cntrl:]]'),
  retired_at timestamptz,
  retired_by text,
  retirement_reason text
    check (retirement_reason is null or char_length(retirement_reason) between 1 and 1000)
    check (retirement_reason is null or retirement_reason !~ '[[:cntrl:]]'),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  -- Same-package parentage at the database level (a step or line from
  -- another package cannot be attached, even by direct SQL). The
  -- steps table carries unique (owner_id, work_package_id, id) and
  -- the takeoff-lines table unique (owner_id, package_id, id).
  foreign key (owner_id, work_package_id, step_id)
    references public.forge_work_steps (owner_id, work_package_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, takeoff_line_id)
    references public.forge_work_takeoff_lines (owner_id, package_id, id) on delete restrict,
  -- Real composite FK to the slice-7 drawing-revision identity.
  foreign key (owner_id, work_package_id, source_drawing_id, source_drawing_revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id) on delete restrict,
  foreign key (owner_id, supersedes_verification_id)
    references public.forge_work_field_verifications (owner_id, id) on delete restrict,
  check (retired_at is null or (retired_by is not null and retirement_reason is not null and btrim(retirement_reason) <> '')),
  check (retired_at is null or version >= 2),
  check (status <> 'RETIRED' or retired_at is not null),
  check (retired_at is null or status = 'RETIRED'),
  -- Exactly one target, matching target_type; step fields only on
  -- steps, line fields only on lines.
  check (
    (target_type = 'WORK_STEP' and step_id is not null and takeoff_line_id is null
      and planned_line_quantity is null and observed_installed_quantity is null
      and source_line_id is null and source_progress_entry_ids is null
      and progress_as_of is null and source_progress_digest is null
      and source_progress_total_quantity is null and source_step_version is not null)
    or (target_type = 'TAKEOFF_LINE' and takeoff_line_id is not null and step_id is null
      and planned_step_hours is null and physical_completion is null
      and field_reported_hours is null and field_hours_source is null
      and source_step_version is null and source_line_id is not null)
  ),
  -- Submitted/accepted facts: a line observation needs its observed
  -- quantity; a step observation needs its completion finding. (The
  -- RPC enforces these at submit/accept time, where the status is
  -- known; the table CHECKs below only guard scale/null shapes that
  -- hold in every status.)
  check (field_reported_hours is null or field_hours_source is not null),
  check (supersedes_verification_id is null or supersedes_verification_id <> id),
  check (submitted_at is null or submitted_by is not null),
  check (reviewed_at is null or reviewed_by is not null),
  check (status <> 'ACCEPTED' or reviewed_by is not null),
  check (status <> 'ACCEPTED' or review_note is not null)
);

create index if not exists idx_forge_work_field_verifications_owner_package_status
  on public.forge_work_field_verifications (owner_id, work_package_id, status, inspection_date desc);
create index if not exists idx_forge_work_field_verifications_owner_package_step
  on public.forge_work_field_verifications (owner_id, work_package_id, step_id);
create index if not exists idx_forge_work_field_verifications_owner_package_line
  on public.forge_work_field_verifications (owner_id, work_package_id, takeoff_line_id);
create index if not exists idx_forge_work_field_verifications_owner_package_target
  on public.forge_work_field_verifications (owner_id, work_package_id, target_type, inspection_date desc);

-- One active observation per target + inspection date + source
-- fingerprint. NULL target parts are normalized with coalesce so two
-- rows with a NULL step_id still collide. REJECTED and RETIRED rows
-- fall out of the index, so a re-observation after a rejection or a
-- retirement is a fresh record, never a silent overwrite of history.
create unique index if not exists uq_forge_work_field_verifications_active_observation
  on public.forge_work_field_verifications (
    owner_id, work_package_id, target_type,
    coalesce(step_id, ''), coalesce(takeoff_line_id, ''),
    inspection_date, source_fingerprint)
  where status not in ('REJECTED', 'RETIRED');

-- Immutable audit of every verification change. One row per version.
create table if not exists public.forge_work_field_verification_revisions (
  owner_id text not null,
  id text not null,
  verification_id text not null,
  version integer not null check (version >= 1),
  actor_id text not null,
  action text not null check (action in (
    'create', 'update', 'submit', 'accept', 'return', 'reject',
    'retire', 'link', 'unlink')),
  old_values jsonb,
  new_values jsonb,
  reason text check (reason is null or char_length(reason) <= 2000),
  recorded_at timestamptz not null default now(),
  request_id text check (request_id is null or char_length(request_id) between 1 and 200),
  primary key (owner_id, id),
  unique (owner_id, verification_id, version),
  foreign key (owner_id, verification_id)
    references public.forge_work_field_verifications (owner_id, id)
    on delete restrict
);

create index if not exists idx_forge_work_field_verification_revisions_owner_verification_version
  on public.forge_work_field_verification_revisions (owner_id, verification_id, version);

-- Revisions are append-only history: no UPDATE, no DELETE.
create or replace function public.forge_work_field_verification_revisions_immutable()
returns trigger language plpgsql as $$
begin
  raise exception 'forge_work: field verification revisions are append-only — record a new revision, never edit history';
end $$;
drop trigger if exists forge_work_field_verification_revisions_immutable_trg
  on public.forge_work_field_verification_revisions;
create trigger forge_work_field_verification_revisions_immutable_trg
  before update or delete on public.forge_work_field_verification_revisions
  for each row execute function public.forge_work_field_verification_revisions_immutable();

-- Validated links to associated records. One typed FK column per
-- kind (exactly one set, enforced by CHECK); the link RPC proves the
-- exact owner/package parent chain and target existence. A link never
-- closes a bust, never approves a change order, never mutates the
-- linked record. Unlinking retires the link row (history kept); a
-- link is never hard-deleted.
create table if not exists public.forge_work_field_verification_links (
  owner_id text not null,
  id text not null,
  verification_id text not null,
  work_package_id text not null,
  target_kind text not null check (target_kind in (
    'BUST', 'CHANGE_ORDER', 'PROGRESS_ENTRY', 'DRAWING')),
  bust_id text,
  change_order_id text,
  progress_entry_id text,
  drawing_id text,
  created_by text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by text,
  reason text check (reason is null or char_length(reason) <= 1000),
  version integer not null default 1 check (version >= 1),
  primary key (owner_id, id),
  foreign key (owner_id, verification_id)
    references public.forge_work_field_verifications (owner_id, id)
    on delete restrict,
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  foreign key (owner_id, bust_id)
    references public.forge_work_package_busts (owner_id, id) on delete restrict,
  foreign key (owner_id, change_order_id)
    references public.forge_work_change_orders (owner_id, id) on delete restrict,
  foreign key (owner_id, progress_entry_id)
    references public.forge_work_progress_entries (owner_id, id) on delete restrict,
  foreign key (owner_id, work_package_id, drawing_id)
    references public.forge_work_drawings (owner_id, package_id, id) on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (retired_at is null or version >= 2),
  check (
    (target_kind = 'BUST' and bust_id is not null and change_order_id is null
      and progress_entry_id is null and drawing_id is null)
    or (target_kind = 'CHANGE_ORDER' and change_order_id is not null and bust_id is null
      and progress_entry_id is null and drawing_id is null)
    or (target_kind = 'PROGRESS_ENTRY' and progress_entry_id is not null and bust_id is null
      and change_order_id is null and drawing_id is null)
    or (target_kind = 'DRAWING' and drawing_id is not null and bust_id is null
      and change_order_id is null and progress_entry_id is null)
  )
);

create unique index if not exists uq_forge_work_field_verification_links_active
  on public.forge_work_field_verification_links (
    owner_id, verification_id, target_kind,
    coalesce(bust_id, ''), coalesce(change_order_id, ''),
    coalesce(progress_entry_id, ''), coalesce(drawing_id, ''))
  where retired_at is null;
create index if not exists idx_forge_work_field_verification_links_owner_verification
  on public.forge_work_field_verification_links (owner_id, verification_id, retired_at);

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct app-client
-- mutations. This mirrors slices 3-9: the SELECT policy is the only
-- policy, and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_work_field_verifications enable row level security;
alter table public.forge_work_field_verifications force row level security;
alter table public.forge_work_field_verification_revisions enable row level security;
alter table public.forge_work_field_verification_revisions force row level security;
alter table public.forge_work_field_verification_links enable row level security;
alter table public.forge_work_field_verification_links force row level security;

drop policy if exists forge_work_field_verifications_select on public.forge_work_field_verifications;
create policy forge_work_field_verifications_select
  on public.forge_work_field_verifications for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_field_verification_revisions_select on public.forge_work_field_verification_revisions;
create policy forge_work_field_verification_revisions_select
  on public.forge_work_field_verification_revisions for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_work_field_verification_links_select on public.forge_work_field_verification_links;
create policy forge_work_field_verification_links_select
  on public.forge_work_field_verification_links for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or service_role.
-- Supabase default privileges re-grant ALL on new public tables and EXECUTE
-- on new functions to the app roles, so every grant is stated explicitly
-- here (and verified after the apply with an ACL/RLS receipt). Per the
-- PR #766 lesson, function EXECUTE is revoked from each named role
-- explicitly — REVOKE ... FROM public alone is a no-op for functions.
-- ---------------------------------------------------------------------------

revoke all on table public.forge_work_field_verifications from public, anon, service_role, authenticated;
grant select on table public.forge_work_field_verifications to authenticated;
revoke all on table public.forge_work_field_verification_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_field_verification_revisions to authenticated;
revoke all on table public.forge_work_field_verification_links from public, anon, service_role, authenticated;
grant select on table public.forge_work_field_verification_links to authenticated;

-- ---------------------------------------------------------------------------
-- Trusted transactional write paths. Each RPC enforces, in order:
-- workspace access (via has_workspace_access, which reads the caller's
-- auth.uid() — SECURITY DEFINER changes only permission checks, never
-- the caller's identity), package existence/status and same-package
-- parentage, field validation, the terminal-package rule, the
-- optimistic version guard, and the idempotency check — then performs
-- the mutation AND the revision insert in this one transaction, so a
-- failed revision insert rolls the mutation back. The audit actor is
-- derived inside each RPC from auth.uid() — there is deliberately NO
-- caller-supplied actor parameter, so no caller can forge another
-- actor's audit history by invoking the RPC directly (slice 2's P1
-- lesson). search_path is emptied and every reference is
-- schema-qualified, so a caller cannot redirect resolution;
-- row_security is off so the RPC is not gated by the FORCE RLS
-- policies it is deliberately bypassing (its own checks above are the
-- gate instead).
-- ---------------------------------------------------------------------------

-- Internal helper: validate a fixed-scale decimal (null = absent).
-- Hours use 2 decimals, quantities 4. Raises WPPFV_INVALID_VALUE.
create or replace function public.forge_work_field_verification_check_decimal(
  p_value numeric,
  p_scale integer
)
returns numeric
language plpgsql
immutable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_value is null then
    return null;
  end if;
  if p_value < 0 or p_value <> round(p_value, p_scale) then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  return p_value;
end;
$$;

-- Internal helper: render a numeric canonically for fingerprinting —
-- trailing zeros and a trailing point are stripped ('100.0000' ->
-- '100', '40.5000' -> '40.5'), so the fingerprint is identical
-- whether the caller passed 40.5 or 40.5000. The RPC caps decimal
-- scale at 4, so this is exactly equivalent to a toFixed(4)-then-
-- strip rendering for every value the RPC accepts.
create or replace function public.forge_work_field_verification_canonical_number(
  p_value numeric
)
returns text
language plpgsql
immutable
security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_value is null then
    return '';
  end if;
  return case when p_value::text like '%.%'
    then trim(trailing '.' from trim(trailing '0' from p_value::text))
    else p_value::text end;
end;
$$;

-- Internal helper: the canonical source fingerprint for one target.
-- Lines: md5 over the line id, planned quantity/unit, as-of date, and
-- the ordered contributing non-void progress entries (id, work date,
-- installed quantity) — so any progress edit, void, or future-dated
-- entry landing inside the window changes the fingerprint. Steps:
-- md5 over the step id, its current version, and its planned hours —
-- so any step edit (which bumps version) changes the fingerprint.
-- Returns null when the target row does not exist (the caller maps
-- that to TARGET_RETIRED / TARGET_NOT_FOUND, never to a fingerprint).
-- A fingerprint is a freshness guard, not a security hash.
create or replace function public.forge_work_field_verification_compute_fingerprint(
  p_owner_id text,
  p_package_id text,
  p_target_type text,
  p_target_id text,
  p_as_of date
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_step_version integer;
  v_planned_hours numeric;
  v_line_quantity numeric;
  v_line_unit text;
  v_entries text;
begin
  if p_target_type = 'WORK_STEP' then
    select version, planned_person_hours into v_step_version, v_planned_hours
      from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_target_id;
    if not found then
      return null;
    end if;
    return md5('STEP|' || p_target_id || '|'
      || coalesce(v_step_version::text, '') || '|'
      || public.forge_work_field_verification_canonical_number(v_planned_hours));
  elsif p_target_type = 'TAKEOFF_LINE' then
    select quantity, unit into v_line_quantity, v_line_unit
      from public.forge_work_takeoff_lines
      where owner_id = p_owner_id and package_id = p_package_id
        and id = p_target_id;
    if not found then
      return null;
    end if;
    select coalesce(string_agg(
        e.id || ':' || e.work_date::text || ':'
        || public.forge_work_field_verification_canonical_number(e.installed_quantity),
        ',' order by e.id), '')
      into v_entries
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = p_package_id
        and e.takeoff_line_id = p_target_id
        and e.voided_at is null
        and e.work_date <= p_as_of;
    return md5('LINE|' || p_target_id || '|'
      || public.forge_work_field_verification_canonical_number(v_line_quantity) || '|'
      || coalesce(v_line_unit, '') || '|'
      || coalesce(p_as_of::text, '') || '|'
      || v_entries);
  end if;
  raise exception 'WPPFV_INVALID_TARGET';
end;
$$;

-- Internal helper: look up a prior create/decision/link revision by
-- idempotency request id. Returns the verification id when the same
-- actor already performed this operation with the same payload digest
-- (a safe replay), raises WPPFV_IDEMPOTENCY_CONFLICT when the same
-- request id carries a different payload, and returns null when the
-- request id is new. The digest lives in new_values.requestDigest.
create or replace function public.forge_work_field_verification_idempotency_check(
  p_owner_id text,
  p_actor text,
  p_action text,
  p_request_id text,
  p_request_digest text
)
returns text
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_row record;
begin
  if p_request_id is null or btrim(p_request_id) = '' then
    return null;
  end if;
  select verification_id, new_values ->> 'requestDigest' as digest
    into v_row
    from public.forge_work_field_verification_revisions
    where owner_id = p_owner_id
      and actor_id = p_actor
      and action = p_action
      and request_id = p_request_id
    order by recorded_at desc
    limit 1;
  if not found then
    return null;
  end if;
  if v_row.digest is distinct from p_request_digest then
    raise exception 'WPPFV_IDEMPOTENCY_CONFLICT';
  end if;
  return v_row.verification_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_field_verification_sources
-- Read-only assembled source preview for a new observation: the
-- target, its planned figures, the installed-as-of total with
-- contributing entry ids and the source fingerprint, the drawing +
-- latest revision, and the package status — in ONE statement, so a
-- new observation can never be recorded against a mixed-revision
-- source. SECURITY INVOKER so the caller's RLS policies apply to
-- every table read; STABLE because it only reads. The fingerprint
-- the caller reviews here is the exact fingerprint the create RPC
-- recomputes and requires to match. It is computed INLINE in this
-- function (not via the compute_fingerprint helper): this RPC is
-- SECURITY INVOKER, and a revoked helper cannot be called from an
-- invoker context (the execute check runs as the caller) — the same
-- rule the busts slice follows, whose SECURITY INVOKER snapshot
-- never calls its revoked fingerprint helper. The canonical
-- rendering below is byte-identical to the helper's, and the
-- migration battery cross-checks the two copies on every create
-- (the stored fingerprint must equal the sources fingerprint).
--
-- p_as_of null means "today" (CURRENT_DATE). A retired step still
-- previews (targetRetired true) so history stays readable; the
-- create RPC refuses a retired step as a NEW observation's target.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_sources(
  p_owner_id text,
  p_package_id text,
  p_target_type text,
  p_target_id text,
  p_as_of date
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_as_of date := coalesce(p_as_of, current_date);
  v_fingerprint text;
  v_step record;
  v_line record;
  v_drawing record;
  v_revision record;
  v_total numeric;
  v_entry_ids text[];
  v_entries text;
  v_digest text;
  v_package_status text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  select status into v_package_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPPFV_PACKAGE_NOT_FOUND';
  end if;
  if p_target_type is null or p_target_type not in ('WORK_STEP', 'TAKEOFF_LINE') then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_target_id is null or btrim(p_target_id) = '' then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if v_as_of > current_date then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;

  if p_target_type = 'WORK_STEP' then
    select s.id, s.title, s.version, s.planned_person_hours, s.retired_at,
           s.craft_key, s.craft_label
      into v_step
      from public.forge_work_steps s
      where s.owner_id = p_owner_id and s.work_package_id = p_package_id
        and s.id = p_target_id;
    if not found then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    -- Inline step fingerprint (see the header comment): md5 over
    -- the step id, its current version, and its planned hours —
    -- byte-identical to the helper's rendering.
    v_fingerprint := md5('STEP|' || v_step.id || '|'
      || coalesce(v_step.version::text, '') || '|'
      || case when v_step.planned_person_hours is null then ''
        when v_step.planned_person_hours::text like '%.%'
          then trim(trailing '.' from trim(trailing '0' from v_step.planned_person_hours::text))
        else v_step.planned_person_hours::text end);
    select jsonb_build_object(
      'packageStatus', v_package_status,
      'asOf', v_as_of,
      'targetType', 'WORK_STEP',
      'targetId', v_step.id,
      'targetLabel', v_step.title,
      'targetRetired', v_step.retired_at is not null,
      'stepVersion', v_step.version,
      'plannedStepHours', v_step.planned_person_hours,
      'craftKey', v_step.craft_key,
      'craftLabel', v_step.craft_label,
      'plannedLineQuantity', null,
      'unit', null,
      'drawingId', null,
      'drawingNumber', null,
      'latestRevision', null,
      'progressAsOf', null,
      'installedAsOf', null,
      'progressEntryIds', null,
      'sourceProgressDigest', null,
      'sourceFingerprint', v_fingerprint
    ) into v_result;
    return v_result;
  end if;

  -- TAKEOFF_LINE
  select l.id, l.drawing_id, l.quantity, l.unit,
         d.drawing_number
    into v_line
    from public.forge_work_takeoff_lines l
    join public.forge_work_drawings d
      on d.owner_id = l.owner_id and d.id = l.drawing_id
    where l.owner_id = p_owner_id and l.id = p_target_id
      and d.package_id = p_package_id;
  if not found then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  select coalesce(sum(e.installed_quantity), 0) into v_total
    from public.forge_work_progress_entries e
    where e.owner_id = p_owner_id and e.work_package_id = p_package_id
      and e.takeoff_line_id = p_target_id
      and e.voided_at is null
      and e.work_date <= v_as_of;
  select coalesce(array_agg(e.id order by e.id), '{}'::text[]) into v_entry_ids
    from public.forge_work_progress_entries e
    where e.owner_id = p_owner_id and e.work_package_id = p_package_id
      and e.takeoff_line_id = p_target_id
      and e.voided_at is null
      and e.work_date <= v_as_of;
  -- Contributing entries, rendered canonically once: the entries
  -- string feeds BOTH the entries-only digest and the line
  -- fingerprint below (inline, per the header comment).
  select coalesce(string_agg(
      e.id || ':' || e.work_date::text || ':'
      || case when e.installed_quantity is null then ''
        when e.installed_quantity::text like '%.%'
          then trim(trailing '.' from trim(trailing '0' from e.installed_quantity::text))
        else e.installed_quantity::text end,
      ',' order by e.id), '')
    into v_entries
    from public.forge_work_progress_entries e
    where e.owner_id = p_owner_id and e.work_package_id = p_package_id
      and e.takeoff_line_id = p_target_id
      and e.voided_at is null
      and e.work_date <= v_as_of;
  -- Entries-only digest (the brief's source_progress_digest): the
  -- contributing entry set alone, so a progress edit is visible even
  -- when the planned figure never moved.
  v_digest := md5(v_entries);
  -- Inline line fingerprint: md5 over the line id, planned
  -- quantity/unit, as-of date, and the contributing entries —
  -- byte-identical to the helper's rendering.
  v_fingerprint := md5('LINE|' || v_line.id || '|'
    || case when v_line.quantity is null then ''
      when v_line.quantity::text like '%.%'
        then trim(trailing '.' from trim(trailing '0' from v_line.quantity::text))
      else v_line.quantity::text end || '|'
    || coalesce(v_line.unit, '') || '|'
    || v_as_of::text || '|'
    || v_entries);
  select r.id, r.revision_code, r.issued_as, r.issued_at, r.retired_at
    into v_revision
    from public.forge_wp_drawing_revisions r
    where r.owner_id = p_owner_id and r.package_id = p_package_id
      and r.drawing_id = v_line.drawing_id
    order by r.issued_at desc, r.id desc
    limit 1;
  select jsonb_build_object(
    'packageStatus', v_package_status,
    'asOf', v_as_of,
    'targetType', 'TAKEOFF_LINE',
    'targetId', v_line.id,
    'targetLabel', v_line.drawing_number,
    'targetRetired', false,
    'stepVersion', null,
    'plannedStepHours', null,
    'plannedLineQuantity', v_line.quantity,
    'unit', v_line.unit,
    'drawingId', v_line.drawing_id,
    'drawingNumber', v_line.drawing_number,
    'latestRevision', case when v_revision is null then null else jsonb_build_object(
      'id', v_revision.id,
      'revisionCode', v_revision.revision_code,
      'issuedAs', v_revision.issued_as,
      'issuedAt', v_revision.issued_at,
      'retired', v_revision.retired_at is not null) end,
    'progressAsOf', v_as_of,
    'installedAsOf', v_total,
    'progressEntryIds', to_jsonb(v_entry_ids),
    'sourceProgressDigest', v_digest,
    'sourceFingerprint', v_fingerprint
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_field_verification_source_statuses
-- One call maps every verification in a package to CURRENT /
-- CHANGED_SINCE_REVIEW / TARGET_RETIRED by comparing each stored
-- fingerprint to the live recomputation. SECURITY INVOKER so the
-- caller's RLS policies apply; STABLE because it only reads. The
-- list/detail endpoints call this once per fetch — never once per
-- row — so the read path stays one round trip. The live fingerprint
-- is computed INLINE (not via the compute_fingerprint helper) for
-- the same reason as the sources RPC: an invoker context cannot call
-- a revoked helper. The rendering is byte-identical to the helper's.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_source_statuses(
  p_owner_id text,
  p_package_id text
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPPFV_PACKAGE_NOT_FOUND';
  end if;
  select coalesce(jsonb_object_agg(v.id, v.source_status), '{}'::jsonb)
    into v_result
    from (
      select fv.id,
        case
          when fv.target_type = 'WORK_STEP' and not exists (
            select 1 from public.forge_work_steps s
            where s.owner_id = fv.owner_id and s.work_package_id = fv.work_package_id
              and s.id = fv.step_id
          ) then 'TARGET_RETIRED'
          when fv.target_type = 'WORK_STEP' and exists (
            select 1 from public.forge_work_steps s
            where s.owner_id = fv.owner_id and s.work_package_id = fv.work_package_id
              and s.id = fv.step_id and s.retired_at is not null
          ) then 'TARGET_RETIRED'
          when fv.target_type = 'TAKEOFF_LINE' and not exists (
            select 1 from public.forge_work_takeoff_lines l
            where l.owner_id = fv.owner_id and l.package_id = fv.work_package_id
              and l.id = fv.takeoff_line_id
          ) then 'TARGET_RETIRED'
          when live.fingerprint = fv.source_fingerprint then 'CURRENT'
          else 'CHANGED_SINCE_REVIEW'
        end as source_status
      from public.forge_work_field_verifications fv
      left join lateral (
        select
          case fv.target_type
            when 'WORK_STEP' then (
              select md5('STEP|' || s.id || '|' || coalesce(s.version::text, '') || '|' ||
                case when s.planned_person_hours is null then ''
                  when s.planned_person_hours::text like '%.%'
                    then trim(trailing '.' from trim(trailing '0' from s.planned_person_hours::text))
                  else s.planned_person_hours::text end)
              from public.forge_work_steps s
              where s.owner_id = fv.owner_id and s.work_package_id = fv.work_package_id
                and s.id = fv.step_id)
            when 'TAKEOFF_LINE' then (
              select md5('LINE|' || l.id || '|' ||
                case when l.quantity is null then ''
                  when l.quantity::text like '%.%'
                    then trim(trailing '.' from trim(trailing '0' from l.quantity::text))
                  else l.quantity::text end || '|' ||
                coalesce(l.unit, '') || '|' || coalesce(fv.progress_as_of::text, '') || '|' ||
                coalesce((
                  select string_agg(
                    e.id || ':' || e.work_date::text || ':' ||
                    case when e.installed_quantity is null then ''
                      when e.installed_quantity::text like '%.%'
                        then trim(trailing '.' from trim(trailing '0' from e.installed_quantity::text))
                      else e.installed_quantity::text end,
                    ',' order by e.id)
                  from public.forge_work_progress_entries e
                  where e.owner_id = fv.owner_id and e.work_package_id = fv.work_package_id
                    and e.takeoff_line_id = fv.takeoff_line_id
                    and e.voided_at is null and e.work_date <= fv.progress_as_of), ''))
              from public.forge_work_takeoff_lines l
              where l.owner_id = fv.owner_id and l.package_id = fv.work_package_id
                and l.id = fv.takeoff_line_id)
          end as fingerprint
      ) live on true
      where fv.owner_id = p_owner_id and fv.work_package_id = p_package_id
    ) v;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_field_verification_create
-- Create a DRAFT observation. The caller supplies the observation;
-- the server takes the source snapshot itself (step version + planned
-- hours, or line planned quantity/unit + installed-as-of total +
-- contributing entry ids + digest) and recomputes the source
-- fingerprint — a caller-supplied fingerprint that disagrees means
-- the reviewed source is stale (409). Terminal packages are
-- read-only. A retired step cannot be a new observation's target.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_create(
  p_owner_id text,
  p_package_id text,
  p_target_type text,
  p_step_id text,
  p_takeoff_line_id text,
  p_work_location text,
  p_inspection_date date,
  p_source_checked_at timestamptz,
  p_source_drawing_revision_id text,
  p_scope_baseline_id text,
  p_scope_baseline_version integer,
  p_observed_installed_quantity numeric,
  p_observed_basis text,
  p_physical_completion text,
  p_acceptance_criteria_checked text,
  p_field_reported_hours numeric,
  p_field_hours_source text,
  p_observation_note text,
  p_evidence_ref text,
  p_evidence_summary text,
  p_source_fingerprint text,
  p_request_id text,
  p_supersedes_verification_id text,
  p_reason text
)
returns public.forge_work_field_verifications
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_ver public.forge_work_field_verifications%rowtype;
  v_fingerprint text;
  v_digest text;
  v_replay_id text;
  v_existing_id text;
  v_step_version integer;
  v_planned_hours numeric;
  v_line_quantity numeric;
  v_line_unit text;
  v_line_drawing_id text;
  v_total numeric;
  v_entry_ids text[];
  v_reason text;
  v_observed numeric;
  v_reported_hours numeric;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPPFV_INVALID_ACTOR';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id for update;
  if not found then
    raise exception 'WPPFV_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPPFV_PACKAGE_TERMINAL';
  end if;

  -- Target shape.
  if p_target_type is null or p_target_type not in ('WORK_STEP', 'TAKEOFF_LINE') then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_target_type = 'WORK_STEP' and (p_step_id is null or p_takeoff_line_id is not null) then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_target_type = 'TAKEOFF_LINE' and (p_takeoff_line_id is null or p_step_id is not null) then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_work_location is null or p_work_location not in ('SHOP', 'FIELD') then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  if p_inspection_date is null or p_inspection_date > current_date then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  if p_source_checked_at is null or p_source_checked_at > now() then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;

  -- Target existence in this same package; a retired step cannot be
  -- attached to a new observation.
  if p_target_type = 'WORK_STEP' then
    select version, planned_person_hours into v_step_version, v_planned_hours
      from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_step_id;
    if not found then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    if exists (
      select 1 from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and id = p_step_id and retired_at is not null
    ) then
      raise exception 'WPPFV_TARGET_RETIRED';
    end if;
    if p_physical_completion is null or p_physical_completion not in (
      'NOT_COMPLETE', 'PARTIALLY_COMPLETE', 'COMPLETE', 'UNABLE_TO_VERIFY') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
    if p_observed_installed_quantity is not null then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    if p_physical_completion = 'COMPLETE'
      and (p_acceptance_criteria_checked is null
        or btrim(p_acceptance_criteria_checked) = '') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
  else
    select l.quantity, l.unit, l.drawing_id
      into v_line_quantity, v_line_unit, v_line_drawing_id
      from public.forge_work_takeoff_lines l
      join public.forge_work_drawings d
        on d.owner_id = l.owner_id and d.id = l.drawing_id
      where l.owner_id = p_owner_id and l.id = p_takeoff_line_id
        and d.package_id = p_package_id;
    if not found then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    if p_physical_completion is not null then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_observed := public.forge_work_field_verification_check_decimal(
      p_observed_installed_quantity, 4);
    -- Observed quantity may be absent in a DRAFT (the brief requires
    -- it at submit); when present it must be valid.
  end if;

  -- Drawing revision: when given it must be a live (non-retired)
  -- revision of a drawing in this package.
  if p_source_drawing_revision_id is not null then
    if not exists (
      select 1 from public.forge_wp_drawing_revisions r
      where r.owner_id = p_owner_id and r.package_id = p_package_id
        and r.id = p_source_drawing_revision_id and r.retired_at is null
    ) then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
  end if;
  if p_scope_baseline_id is not null and (
    char_length(p_scope_baseline_id) > 200
    or p_scope_baseline_id ~ '[[:cntrl:]]') then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  if p_scope_baseline_version is not null and p_scope_baseline_version < 1 then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;

  -- Observation fields.
  if p_observation_note is null or char_length(btrim(p_observation_note)) < 1
     or char_length(p_observation_note) > 2000
     or p_observation_note ~ '[[:cntrl:]]' then
    raise exception 'WPPFV_INVALID_EVIDENCE';
  end if;
  if p_evidence_ref is not null and (char_length(p_evidence_ref) > 500
     or p_evidence_ref ~ '[[:cntrl:]]') then
    raise exception 'WPPFV_INVALID_EVIDENCE';
  end if;
  if p_evidence_summary is not null and (char_length(p_evidence_summary) > 2000
     or p_evidence_summary ~ '[[:cntrl:]]') then
    raise exception 'WPPFV_INVALID_EVIDENCE';
  end if;
  if p_observed_basis is not null and (char_length(p_observed_basis) > 1000
     or p_observed_basis ~ '[[:cntrl:]]') then
    raise exception 'WPPFV_INVALID_EVIDENCE';
  end if;
  if p_acceptance_criteria_checked is not null and (
    char_length(p_acceptance_criteria_checked) > 2000
    or p_acceptance_criteria_checked ~ '[[:cntrl:]]') then
    raise exception 'WPPFV_INVALID_EVIDENCE';
  end if;
  v_reported_hours := public.forge_work_field_verification_check_decimal(
    p_field_reported_hours, 2);
  if v_reported_hours is not null and (p_field_hours_source is null
     or btrim(p_field_hours_source) = ''
     or char_length(p_field_hours_source) > 500) then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  if p_field_hours_source is not null and p_field_hours_source ~ '[[:cntrl:]]' then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  if p_supersedes_verification_id is not null and not exists (
    select 1 from public.forge_work_field_verifications
    where owner_id = p_owner_id and work_package_id = p_package_id
      and id = p_supersedes_verification_id
  ) then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) > 1000 then
    raise exception 'WPPFV_REASON_TOO_LONG';
  end if;
  if v_reason = '' then
    v_reason := 'Field verification recorded';
  end if;

  -- Idempotency first: the same request id + actor + action with the
  -- same payload digest replays to the existing verification; a
  -- different payload under the same request id is a conflict. The
  -- digest deliberately excludes the live fingerprint: the fingerprint
  -- is recomputed from live sources below, and a source change
  -- between the original attempt and a retry must replay the original
  -- observation, not false-conflict on a moved source.
  v_replay_id := public.forge_work_field_verification_idempotency_check(
    p_owner_id, v_actor, 'create', p_request_id,
    md5(p_target_type || '|' || coalesce(p_step_id, p_takeoff_line_id, '') || '|'
      || p_inspection_date::text || '|' || btrim(p_observation_note) || '|'
      || coalesce(btrim(p_evidence_ref), '')));
  if v_replay_id is not null then
    select * into v_ver from public.forge_work_field_verifications
      where owner_id = p_owner_id and id = v_replay_id;
    if found then
      return v_ver;
    end if;
  end if;

  -- Server-side source snapshot + fingerprint. The caller-reviewed
  -- fingerprint must match the live recomputation, or the observation
  -- was reviewed against a source that has since moved.
  v_fingerprint := public.forge_work_field_verification_compute_fingerprint(
    p_owner_id, p_package_id, p_target_type,
    coalesce(p_step_id, p_takeoff_line_id), p_inspection_date);
  if v_fingerprint is null then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_source_fingerprint is null or p_source_fingerprint <> v_fingerprint then
    raise exception 'WPPFV_SOURCE_CHANGED';
  end if;
  if p_target_type = 'TAKEOFF_LINE' then
    select coalesce(sum(e.installed_quantity), 0) into v_total
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = p_package_id
        and e.takeoff_line_id = p_takeoff_line_id
        and e.voided_at is null
        and e.work_date <= p_inspection_date;
    select coalesce(array_agg(e.id order by e.id), '{}'::text[]) into v_entry_ids
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = p_package_id
        and e.takeoff_line_id = p_takeoff_line_id
        and e.voided_at is null
        and e.work_date <= p_inspection_date;
    select md5(coalesce(string_agg(
        e.id || ':' || e.work_date::text || ':'
        || public.forge_work_field_verification_canonical_number(e.installed_quantity),
        ',' order by e.id), ''))
      into v_digest
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = p_package_id
        and e.takeoff_line_id = p_takeoff_line_id
        and e.voided_at is null
        and e.work_date <= p_inspection_date;
  end if;

  -- Dedup: one active observation per target + inspection date +
  -- source fingerprint. A re-record of the same observation is a
  -- 409 naming the existing verification.
  select id into v_existing_id
    from public.forge_work_field_verifications
    where owner_id = p_owner_id and work_package_id = p_package_id
      and target_type = p_target_type
      and coalesce(step_id, '') = coalesce(p_step_id, '')
      and coalesce(takeoff_line_id, '') = coalesce(p_takeoff_line_id, '')
      and inspection_date = p_inspection_date
      and source_fingerprint = v_fingerprint
      and status not in ('REJECTED', 'RETIRED')
    limit 1;
  if found then
    raise exception 'WPPFV_DUPLICATE_ACTIVE:%', v_existing_id;
  end if;

  insert into public.forge_work_field_verifications
    (owner_id, id, work_package_id, target_type, step_id, takeoff_line_id,
     work_location, inspection_date, source_checked_at,
     source_step_version, source_line_id, source_drawing_id,
     source_drawing_revision_id, scope_baseline_id, scope_baseline_version,
     source_progress_entry_ids, progress_as_of, source_progress_digest,
     source_progress_total_quantity, source_fingerprint,
     planned_step_hours, planned_line_quantity, unit,
     observed_installed_quantity, observed_basis,
     physical_completion, acceptance_criteria_checked,
     field_reported_hours, field_hours_source,
     observation_note, evidence_ref, evidence_summary,
     status, version, supersedes_verification_id,
     created_by, updated_by)
  values
    (p_owner_id,
     'forge_wpfv_' || replace(gen_random_uuid()::text, '-', ''),
     p_package_id, p_target_type, p_step_id, p_takeoff_line_id,
     p_work_location, p_inspection_date, p_source_checked_at,
     case when p_target_type = 'WORK_STEP' then v_step_version else null end,
     case when p_target_type = 'TAKEOFF_LINE' then p_takeoff_line_id else null end,
     case when p_target_type = 'TAKEOFF_LINE' then v_line_drawing_id
       when p_source_drawing_revision_id is not null then (
         select drawing_id from public.forge_wp_drawing_revisions
         where owner_id = p_owner_id and id = p_source_drawing_revision_id)
       else null end,
     p_source_drawing_revision_id, p_scope_baseline_id, p_scope_baseline_version,
     case when p_target_type = 'TAKEOFF_LINE' then v_entry_ids else null end,
     case when p_target_type = 'TAKEOFF_LINE' then p_inspection_date else null end,
     case when p_target_type = 'TAKEOFF_LINE' then v_digest else null end,
     case when p_target_type = 'TAKEOFF_LINE' then v_total else null end,
     v_fingerprint,
     case when p_target_type = 'WORK_STEP' then v_planned_hours else null end,
     case when p_target_type = 'TAKEOFF_LINE' then v_line_quantity else null end,
     case when p_target_type = 'TAKEOFF_LINE' then v_line_unit else null end,
     v_observed,
     case when p_observed_basis is null then null else btrim(p_observed_basis) end,
     p_physical_completion,
     case when p_acceptance_criteria_checked is null then null else btrim(p_acceptance_criteria_checked) end,
     v_reported_hours,
     case when p_field_hours_source is null then null else btrim(p_field_hours_source) end,
     btrim(p_observation_note),
     case when p_evidence_ref is null then null else btrim(p_evidence_ref) end,
     case when p_evidence_summary is null then null else btrim(p_evidence_summary) end,
     'DRAFT', 1, p_supersedes_verification_id,
     v_actor, v_actor)
  returning * into v_ver;

  insert into public.forge_work_field_verification_revisions
    (owner_id, id, verification_id, version, actor_id, action, old_values, new_values, reason, request_id)
  values
    (p_owner_id,
     'forge_wpfvr_' || replace(gen_random_uuid()::text, '-', ''),
     v_ver.id, 1, v_actor, 'create', null,
     jsonb_build_object(
       'target_type', v_ver.target_type,
       'status', 'DRAFT',
       'version', 1,
       'sourceFingerprint', v_fingerprint,
       'requestDigest', md5(p_target_type || '|' || coalesce(p_step_id, p_takeoff_line_id, '') || '|'
         || p_inspection_date::text || '|' || btrim(p_observation_note) || '|'
         || coalesce(btrim(p_evidence_ref), ''))),
     v_reason, p_request_id);

  return v_ver;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_field_verification_update
-- Reasoned correction of a DRAFT or RETURNED verification's
-- observation fields (never the target, never the snapshotted plan
-- figures — those are server-derived). Editing the inspection date
-- re-bases the source snapshot to the new date and stores the fresh
-- fingerprint, so the resubmission is reviewed against current
-- sources. Version-guarded with a required reason. Terminal packages
-- are read-only.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_update(
  p_owner_id text,
  p_verification_id text,
  p_expected_version integer,
  p_work_location text,
  p_set_work_location boolean,
  p_inspection_date date,
  p_set_inspection_date boolean,
  p_source_checked_at timestamptz,
  p_set_source_checked_at boolean,
  p_source_drawing_revision_id text,
  p_set_source_drawing_revision_id boolean,
  p_observed_installed_quantity numeric,
  p_set_observed_installed_quantity boolean,
  p_observed_basis text,
  p_set_observed_basis boolean,
  p_physical_completion text,
  p_set_physical_completion boolean,
  p_acceptance_criteria_checked text,
  p_set_acceptance_criteria_checked boolean,
  p_field_reported_hours numeric,
  p_set_field_reported_hours boolean,
  p_field_hours_source text,
  p_set_field_hours_source boolean,
  p_observation_note text,
  p_set_observation_note boolean,
  p_evidence_ref text,
  p_set_evidence_ref boolean,
  p_evidence_summary text,
  p_set_evidence_summary boolean,
  p_reason text
)
returns public.forge_work_field_verifications
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_ver public.forge_work_field_verifications%rowtype;
  v_reason text;
  v_fingerprint text;
  v_total numeric;
  v_entry_ids text[];
  v_digest text;
  v_observed numeric;
  v_reported_hours numeric;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPPFV_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPPFV_REASON_REQUIRED';
  end if;
  select * into v_ver from public.forge_work_field_verifications
    where owner_id = p_owner_id and id = p_verification_id
    for update;
  if not found then
    raise exception 'WPPFV_VERIFICATION_NOT_FOUND';
  end if;
  if v_ver.retired_at is not null or v_ver.status = 'RETIRED' then
    raise exception 'WPPFV_RETIRED';
  end if;
  -- Optimistic-concurrency order: a stale version is a conflict
  -- whatever the state (a caller replaying an old write must hear
  -- VERSION_CONFLICT, not the state error) — the same order the
  -- decision and retire RPCs use.
  if p_expected_version is null or p_expected_version <> v_ver.version then
    raise exception 'WPPFV_VERSION_CONFLICT';
  end if;
  if v_ver.status not in ('DRAFT', 'RETURNED') then
    raise exception 'WPPFV_INVALID_TRANSITION';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_ver.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPPFV_PACKAGE_TERMINAL';
  end if;

  -- Apply the requested edits with the same validation as create.
  if p_set_work_location then
    if p_work_location is null or p_work_location not in ('SHOP', 'FIELD') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
    v_ver.work_location := p_work_location;
  end if;
  if p_set_inspection_date then
    if p_inspection_date is null or p_inspection_date > current_date then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
    v_ver.inspection_date := p_inspection_date;
  end if;
  if p_set_source_checked_at then
    if p_source_checked_at is null or p_source_checked_at > now() then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
    v_ver.source_checked_at := p_source_checked_at;
  end if;
  if p_set_source_drawing_revision_id then
    if p_source_drawing_revision_id is not null and not exists (
      select 1 from public.forge_wp_drawing_revisions r
      where r.owner_id = p_owner_id and r.package_id = v_ver.work_package_id
        and r.id = p_source_drawing_revision_id and r.retired_at is null
    ) then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_ver.source_drawing_revision_id := p_source_drawing_revision_id;
    if p_source_drawing_revision_id is not null then
      select drawing_id into v_ver.source_drawing_id
        from public.forge_wp_drawing_revisions
        where owner_id = p_owner_id and id = p_source_drawing_revision_id;
    elsif v_ver.target_type = 'TAKEOFF_LINE' then
      select drawing_id into v_ver.source_drawing_id
        from public.forge_work_takeoff_lines
        where owner_id = p_owner_id and id = v_ver.takeoff_line_id;
    else
      v_ver.source_drawing_id := null;
    end if;
  end if;
  if p_set_observed_installed_quantity then
    if v_ver.target_type <> 'TAKEOFF_LINE' and p_observed_installed_quantity is not null then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_observed := public.forge_work_field_verification_check_decimal(
      p_observed_installed_quantity, 4);
    v_ver.observed_installed_quantity := v_observed;
  end if;
  if p_set_observed_basis then
    if p_observed_basis is not null and (char_length(p_observed_basis) > 1000
       or p_observed_basis ~ '[[:cntrl:]]') then
      raise exception 'WPPFV_INVALID_EVIDENCE';
    end if;
    v_ver.observed_basis := case when p_observed_basis is null then null else btrim(p_observed_basis) end;
  end if;
  if p_set_physical_completion then
    if v_ver.target_type <> 'WORK_STEP' and p_physical_completion is not null then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    if p_physical_completion is null or p_physical_completion not in (
      'NOT_COMPLETE', 'PARTIALLY_COMPLETE', 'COMPLETE', 'UNABLE_TO_VERIFY') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
    v_ver.physical_completion := p_physical_completion;
    if p_physical_completion = 'COMPLETE'
      and (v_ver.acceptance_criteria_checked is null
        or btrim(v_ver.acceptance_criteria_checked) = '') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
  end if;
  if p_set_acceptance_criteria_checked then
    if p_acceptance_criteria_checked is not null and (
      char_length(p_acceptance_criteria_checked) > 2000
      or p_acceptance_criteria_checked ~ '[[:cntrl:]]') then
      raise exception 'WPPFV_INVALID_EVIDENCE';
    end if;
    v_ver.acceptance_criteria_checked := case when p_acceptance_criteria_checked is null then null else btrim(p_acceptance_criteria_checked) end;
    if v_ver.physical_completion = 'COMPLETE'
      and (v_ver.acceptance_criteria_checked is null
        or btrim(v_ver.acceptance_criteria_checked) = '') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
  end if;
  if p_set_field_reported_hours then
    if v_ver.target_type <> 'WORK_STEP' and p_field_reported_hours is not null then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_reported_hours := public.forge_work_field_verification_check_decimal(
      p_field_reported_hours, 2);
    v_ver.field_reported_hours := v_reported_hours;
    if v_reported_hours is not null and (v_ver.field_hours_source is null
       or btrim(v_ver.field_hours_source) = '') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
  end if;
  if p_set_field_hours_source then
    if p_field_hours_source is not null and (char_length(p_field_hours_source) > 500
       or p_field_hours_source ~ '[[:cntrl:]]') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
    v_ver.field_hours_source := case when p_field_hours_source is null then null else btrim(p_field_hours_source) end;
    if v_ver.field_reported_hours is not null and (v_ver.field_hours_source is null
       or btrim(v_ver.field_hours_source) = '') then
      raise exception 'WPPFV_INVALID_VALUE';
    end if;
  end if;
  if p_set_observation_note then
    if p_observation_note is null or char_length(btrim(p_observation_note)) < 1
       or char_length(p_observation_note) > 2000
       or p_observation_note ~ '[[:cntrl:]]' then
      raise exception 'WPPFV_INVALID_EVIDENCE';
    end if;
    v_ver.observation_note := btrim(p_observation_note);
  end if;
  if p_set_evidence_ref then
    if p_evidence_ref is not null and (char_length(p_evidence_ref) > 500
       or p_evidence_ref ~ '[[:cntrl:]]') then
      raise exception 'WPPFV_INVALID_EVIDENCE';
    end if;
    v_ver.evidence_ref := case when p_evidence_ref is null then null else btrim(p_evidence_ref) end;
  end if;
  if p_set_evidence_summary then
    if p_evidence_summary is not null and (char_length(p_evidence_summary) > 2000
       or p_evidence_summary ~ '[[:cntrl:]]') then
      raise exception 'WPPFV_INVALID_EVIDENCE';
    end if;
    v_ver.evidence_summary := case when p_evidence_summary is null then null else btrim(p_evidence_summary) end;
  end if;

  -- Re-base the source snapshot on the (possibly new) inspection
  -- date: the draft is not a decision yet, so re-basing is correct
  -- — the resubmission is reviewed against current sources.
  v_fingerprint := public.forge_work_field_verification_compute_fingerprint(
    p_owner_id, v_ver.work_package_id, v_ver.target_type,
    coalesce(v_ver.step_id, v_ver.takeoff_line_id), v_ver.inspection_date);
  if v_fingerprint is null then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  v_ver.source_fingerprint := v_fingerprint;
  if v_ver.target_type = 'WORK_STEP' then
    select version, planned_person_hours
      into v_ver.source_step_version, v_ver.planned_step_hours
      from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = v_ver.work_package_id
        and id = v_ver.step_id;
    if not found then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    if exists (
      select 1 from public.forge_work_steps
      where owner_id = p_owner_id and work_package_id = v_ver.work_package_id
        and id = v_ver.step_id and retired_at is not null
    ) then
      raise exception 'WPPFV_TARGET_RETIRED';
    end if;
  else
    select l.quantity, l.unit into v_ver.planned_line_quantity, v_ver.unit
      from public.forge_work_takeoff_lines l
      where l.owner_id = p_owner_id and l.id = v_ver.takeoff_line_id;
    if not found then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_ver.progress_as_of := v_ver.inspection_date;
    select coalesce(sum(e.installed_quantity), 0) into v_total
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = v_ver.work_package_id
        and e.takeoff_line_id = v_ver.takeoff_line_id
        and e.voided_at is null
        and e.work_date <= v_ver.inspection_date;
    select coalesce(array_agg(e.id order by e.id), '{}'::text[]) into v_entry_ids
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = v_ver.work_package_id
        and e.takeoff_line_id = v_ver.takeoff_line_id
        and e.voided_at is null
        and e.work_date <= v_ver.inspection_date;
    select md5(coalesce(string_agg(
        e.id || ':' || e.work_date::text || ':'
        || public.forge_work_field_verification_canonical_number(e.installed_quantity),
        ',' order by e.id), ''))
      into v_digest
      from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.work_package_id = v_ver.work_package_id
        and e.takeoff_line_id = v_ver.takeoff_line_id
        and e.voided_at is null
        and e.work_date <= v_ver.inspection_date;
    v_ver.source_progress_total_quantity := v_total;
    v_ver.source_progress_entry_ids := v_entry_ids;
    v_ver.source_progress_digest := v_digest;
  end if;

  update public.forge_work_field_verifications
    set work_location = v_ver.work_location,
        inspection_date = v_ver.inspection_date,
        source_checked_at = v_ver.source_checked_at,
        source_step_version = v_ver.source_step_version,
        source_drawing_id = v_ver.source_drawing_id,
        source_drawing_revision_id = v_ver.source_drawing_revision_id,
        source_progress_entry_ids = v_ver.source_progress_entry_ids,
        progress_as_of = v_ver.progress_as_of,
        source_progress_digest = v_ver.source_progress_digest,
        source_progress_total_quantity = v_ver.source_progress_total_quantity,
        source_fingerprint = v_ver.source_fingerprint,
        planned_step_hours = v_ver.planned_step_hours,
        planned_line_quantity = v_ver.planned_line_quantity,
        unit = v_ver.unit,
        observed_installed_quantity = v_ver.observed_installed_quantity,
        observed_basis = v_ver.observed_basis,
        physical_completion = v_ver.physical_completion,
        acceptance_criteria_checked = v_ver.acceptance_criteria_checked,
        field_reported_hours = v_ver.field_reported_hours,
        field_hours_source = v_ver.field_hours_source,
        observation_note = v_ver.observation_note,
        evidence_ref = v_ver.evidence_ref,
        evidence_summary = v_ver.evidence_summary,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_verification_id
    returning * into v_ver;
  insert into public.forge_work_field_verification_revisions
    (owner_id, id, verification_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpfvr_' || replace(gen_random_uuid()::text, '-', ''),
     v_ver.id, v_ver.version, v_actor, 'update',
     jsonb_build_object('version', v_ver.version - 1),
     jsonb_build_object(
       'status', v_ver.status,
       'version', v_ver.version,
       'sourceFingerprint', v_ver.source_fingerprint),
     v_reason);
  return v_ver;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_field_verification_decision
-- The independent review decision. Actions:
--   submit  DRAFT/RETURNED -> SUBMITTED (completeness + fresh source)
--   accept  SUBMITTED -> ACCEPTED (two-person + fresh source + evidence
--           + affirmative review statement; UNABLE_TO_VERIFY cannot be
--           accepted)
--   return  SUBMITTED -> RETURNED (two-person; reviewer reason)
--   reject  SUBMITTED -> REJECTED (two-person; reviewer reason)
-- The caller passes the exact fingerprint they reviewed; submit and
-- accept recompute it live and refuse when stale (409
-- WPPFV_SOURCE_CHANGED). A returned record is corrected by the
-- submitter (update re-bases the snapshot) and resubmitted; a
-- rejected record is terminal — the correction is a new observation.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_decision(
  p_owner_id text,
  p_verification_id text,
  p_action text,
  p_expected_version integer,
  p_source_fingerprint text,
  p_reason text,
  p_review_note text,
  p_request_id text
)
returns public.forge_work_field_verifications
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_status text;
  v_ver public.forge_work_field_verifications%rowtype;
  v_live_fingerprint text;
  v_reason text;
  v_review_note text;
  v_replay_id text;
  v_new_status text;
  v_old_values jsonb;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPPFV_INVALID_ACTOR';
  end if;
  if p_action is null or p_action not in ('submit', 'accept', 'return', 'reject') then
    raise exception 'WPPFV_INVALID_ACTION';
  end if;
  select * into v_ver from public.forge_work_field_verifications
    where owner_id = p_owner_id and id = p_verification_id
    for update;
  if not found then
    raise exception 'WPPFV_VERIFICATION_NOT_FOUND';
  end if;
  if v_ver.retired_at is not null or v_ver.status = 'RETIRED' then
    raise exception 'WPPFV_RETIRED';
  end if;

  -- Idempotency BEFORE the version/legality checks: a successful
  -- prior decision with this request id replays to the current row
  -- even though the version has since incremented. The digest binds
  -- the decision to the exact fingerprint the caller reviewed.
  v_reason := btrim(coalesce(p_reason, ''));
  v_review_note := btrim(coalesce(p_review_note, ''));
  v_replay_id := public.forge_work_field_verification_idempotency_check(
    p_owner_id, v_actor, p_action, p_request_id,
    md5(p_action || '|' || v_ver.id || '|' || coalesce(p_source_fingerprint, '') || '|' || v_reason || '|' || v_review_note));
  if v_replay_id is not null then
    select * into v_ver from public.forge_work_field_verifications
      where owner_id = p_owner_id and id = v_replay_id;
    if found then
      return v_ver;
    end if;
  end if;

  if p_expected_version is null or p_expected_version <> v_ver.version then
    raise exception 'WPPFV_VERSION_CONFLICT';
  end if;
  select status into v_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_ver.work_package_id;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPPFV_PACKAGE_TERMINAL';
  end if;

  -- Legal transitions, two-person integrity, and per-action evidence.
  if p_action = 'submit' then
    if v_ver.status not in ('DRAFT', 'RETURNED') then
      raise exception 'WPPFV_INVALID_TRANSITION';
    end if;
    v_new_status := 'SUBMITTED';
  elsif p_action = 'accept' then
    if v_ver.status <> 'SUBMITTED' then
      raise exception 'WPPFV_INVALID_TRANSITION';
    end if;
    if v_actor = v_ver.submitted_by then
      raise exception 'WPPFV_SELF_REVIEW';
    end if;
    v_new_status := 'ACCEPTED';
  elsif p_action = 'return' then
    if v_ver.status <> 'SUBMITTED' then
      raise exception 'WPPFV_INVALID_TRANSITION';
    end if;
    if v_actor = v_ver.submitted_by then
      raise exception 'WPPFV_SELF_REVIEW';
    end if;
    v_new_status := 'RETURNED';
  else -- reject
    if v_ver.status <> 'SUBMITTED' then
      raise exception 'WPPFV_INVALID_TRANSITION';
    end if;
    if v_actor = v_ver.submitted_by then
      raise exception 'WPPFV_SELF_REVIEW';
    end if;
    v_new_status := 'REJECTED';
  end if;

  if p_action in ('return', 'reject') and v_reason = '' then
    raise exception 'WPPFV_REASON_REQUIRED';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'WPPFV_REASON_TOO_LONG';
  end if;
  if p_action = 'accept' and (v_review_note = '' or char_length(v_review_note) > 2000) then
    raise exception 'WPPFV_REVIEW_NOTE_REQUIRED';
  end if;
  if p_action <> 'accept' and char_length(v_review_note) > 2000 then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;

  -- Fresh-source guard on submit and accept: the live fingerprint
  -- must equal BOTH the stored snapshot and the fingerprint the
  -- caller reviewed. A plan/progress change since the review refuses
  -- the decision — the record must be returned (or corrected and
  -- resubmitted) against the new source, never silently accepted.
  if p_action in ('submit', 'accept') then
    if p_source_fingerprint is null then
      raise exception 'WPPFV_SOURCE_CHANGED';
    end if;
    v_live_fingerprint := public.forge_work_field_verification_compute_fingerprint(
      p_owner_id, v_ver.work_package_id, v_ver.target_type,
      coalesce(v_ver.step_id, v_ver.takeoff_line_id), v_ver.inspection_date);
    if v_live_fingerprint is null or v_live_fingerprint <> v_ver.source_fingerprint
      or v_live_fingerprint <> p_source_fingerprint then
      raise exception 'WPPFV_SOURCE_CHANGED';
    end if;
  end if;

  -- Completeness at submit: the observation must be complete for its
  -- target, with evidence (an evidence ref, or a substantive note of
  -- at least 40 characters — the brief's shop/floor-paper trail).
  if p_action = 'submit' then
    if v_ver.target_type = 'TAKEOFF_LINE' and v_ver.observed_installed_quantity is null then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
    if v_ver.target_type = 'WORK_STEP' and v_ver.physical_completion is null then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
    if v_ver.physical_completion = 'COMPLETE'
      and (v_ver.acceptance_criteria_checked is null
        or btrim(v_ver.acceptance_criteria_checked) = '') then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
    if (v_ver.evidence_ref is null or btrim(v_ver.evidence_ref) = '')
      and char_length(v_ver.observation_note) < 40 then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
  end if;

  -- Completeness at accept: evidence is mandatory (a note alone no
  -- longer suffices), the review statement is mandatory, and an
  -- UNABLE_TO_VERIFY step cannot be accepted (it is a finding, not a
  -- confirmation).
  if p_action = 'accept' then
    if v_ver.evidence_ref is null or btrim(v_ver.evidence_ref) = '' then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
    if v_ver.target_type = 'WORK_STEP' and v_ver.physical_completion = 'UNABLE_TO_VERIFY' then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
    if v_ver.target_type = 'TAKEOFF_LINE' and v_ver.observed_installed_quantity is null then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
    if v_ver.target_type = 'WORK_STEP' and v_ver.physical_completion is null then
      raise exception 'WPPFV_INCOMPLETE_OBSERVATION';
    end if;
  end if;

  v_old_values := jsonb_build_object(
    'status', v_ver.status, 'version', v_ver.version,
    'submittedBy', v_ver.submitted_by, 'reviewedBy', v_ver.reviewed_by);
  update public.forge_work_field_verifications
    set status = v_new_status,
        version = version + 1,
        submitted_by = case when p_action = 'submit' then v_actor else submitted_by end,
        submitted_at = case when p_action = 'submit' then now() else submitted_at end,
        reviewed_by = case when p_action in ('accept', 'return', 'reject') then v_actor else reviewed_by end,
        reviewed_at = case when p_action in ('accept', 'return', 'reject') then now() else reviewed_at end,
        review_note = case when p_action in ('accept', 'return', 'reject') then nullif(v_review_note, '') else review_note end,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_verification_id
    returning * into v_ver;
  insert into public.forge_work_field_verification_revisions
    (owner_id, id, verification_id, version, actor_id, action, old_values, new_values, reason, request_id)
  values
    (p_owner_id,
     'forge_wpfvr_' || replace(gen_random_uuid()::text, '-', ''),
     v_ver.id, v_ver.version, v_actor, p_action, v_old_values,
     jsonb_build_object(
       'status', v_ver.status,
       'version', v_ver.version,
       'submittedBy', v_ver.submitted_by,
       'reviewedBy', v_ver.reviewed_by,
       'requestDigest', md5(p_action || '|' || v_ver.id || '|' || coalesce(p_source_fingerprint, '') || '|' || v_reason || '|' || v_review_note)),
     case when v_reason = '' then 'Decision: ' || p_action else v_reason end,
     p_request_id);
  return v_ver;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_work_field_verification_retire
-- Soft-retire a verification (any non-retired status) with a required
-- reason. The revision stays in the immutable audit stream and the
-- row stays queryable as history — retiring is how a mistaken
-- observation is withdrawn without rewriting history. Retire stays
-- available on terminal packages so the owner can retire open
-- drafts/submissions for audit (brief §4).
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_retire(
  p_owner_id text,
  p_verification_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_field_verifications
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_ver public.forge_work_field_verifications%rowtype;
  v_reason text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPPFV_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPPFV_REASON_REQUIRED';
  end if;
  select * into v_ver from public.forge_work_field_verifications
    where owner_id = p_owner_id and id = p_verification_id
    for update;
  if not found then
    raise exception 'WPPFV_VERIFICATION_NOT_FOUND';
  end if;
  if v_ver.retired_at is not null or v_ver.status = 'RETIRED' then
    raise exception 'WPPFV_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_ver.version then
    raise exception 'WPPFV_VERSION_CONFLICT';
  end if;
  update public.forge_work_field_verifications
    set status = 'RETIRED',
        version = version + 1,
        retired_at = now(),
        retired_by = v_actor,
        retirement_reason = v_reason,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = p_verification_id
    returning * into v_ver;
  insert into public.forge_work_field_verification_revisions
    (owner_id, id, verification_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpfvr_' || replace(gen_random_uuid()::text, '-', ''),
     v_ver.id, v_ver.version, v_actor, 'retire',
     jsonb_build_object('status', 'RETIRED', 'version', v_ver.version - 1),
     jsonb_build_object('status', 'RETIRED', 'version', v_ver.version),
     v_reason);
  return v_ver;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPCs: forge_work_field_verification_link / _unlink
-- Attach or retire a validated link from a DRAFT or RETURNED
-- verification to a bust, change order, progress entry, or drawing
-- in the same package. The RPC proves the exact owner/package parent
-- chain and target existence; the typed FK columns enforce it at
-- the database level too. A link never closes a bust, never approves
-- a change order, never mutates the linked record. Reviewers cite
-- references in their decision note; they do not change links.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_field_verification_link(
  p_owner_id text,
  p_verification_id text,
  p_target_kind text,
  p_target_id text,
  p_request_id text,
  p_reason text
)
returns public.forge_work_field_verification_links
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_ver public.forge_work_field_verifications%rowtype;
  v_pkg_status text;
  v_link public.forge_work_field_verification_links%rowtype;
  v_replay_id text;
  v_existing_id text;
  v_new_version integer;
  v_reason text;
  v_bust_id text;
  v_change_order_id text;
  v_progress_entry_id text;
  v_drawing_id text;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPPFV_INVALID_ACTOR';
  end if;
  if p_target_kind is null or p_target_kind not in (
    'BUST', 'CHANGE_ORDER', 'PROGRESS_ENTRY', 'DRAWING') then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_target_id is null or btrim(p_target_id) = '' then
    raise exception 'WPPFV_INVALID_TARGET';
  end if;
  if p_request_id is not null and char_length(p_request_id) > 200 then
    raise exception 'WPPFV_INVALID_VALUE';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if char_length(v_reason) > 1000 then
    raise exception 'WPPFV_REASON_TOO_LONG';
  end if;
  if v_reason = '' then
    v_reason := 'Linked ' || p_target_kind;
  end if;
  select * into v_ver from public.forge_work_field_verifications
    where owner_id = p_owner_id and id = p_verification_id
    for update;
  if not found then
    raise exception 'WPPFV_VERIFICATION_NOT_FOUND';
  end if;
  if v_ver.retired_at is not null or v_ver.status = 'RETIRED' then
    raise exception 'WPPFV_RETIRED';
  end if;
  if v_ver.status not in ('DRAFT', 'RETURNED') then
    raise exception 'WPPFV_INVALID_TRANSITION';
  end if;
  select status into v_pkg_status from public.forge_work_packages
    where owner_id = p_owner_id and id = v_ver.work_package_id;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPPFV_PACKAGE_TERMINAL';
  end if;

  -- Parent-chain proof for the linked target: it must exist in this
  -- same package. The typed FK columns enforce the same at the
  -- database level; this check is the RPC's human-readable gate.
  if p_target_kind = 'BUST' then
    if not exists (
      select 1 from public.forge_work_package_busts b
      where b.owner_id = p_owner_id and b.id = p_target_id
        and b.work_package_id = v_ver.work_package_id
    ) then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_bust_id := p_target_id;
  elsif p_target_kind = 'CHANGE_ORDER' then
    if not exists (
      select 1 from public.forge_work_change_orders c
      where c.owner_id = p_owner_id and c.id = p_target_id
        and c.work_package_id = v_ver.work_package_id
    ) then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_change_order_id := p_target_id;
  elsif p_target_kind = 'PROGRESS_ENTRY' then
    if not exists (
      select 1 from public.forge_work_progress_entries e
      where e.owner_id = p_owner_id and e.id = p_target_id
        and e.work_package_id = v_ver.work_package_id
    ) then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_progress_entry_id := p_target_id;
  else -- DRAWING
    if not exists (
      select 1 from public.forge_work_drawings d
      where d.owner_id = p_owner_id and d.id = p_target_id
        and d.package_id = v_ver.work_package_id
    ) then
      raise exception 'WPPFV_INVALID_TARGET';
    end if;
    v_drawing_id := p_target_id;
  end if;

  -- Idempotency: same request id + actor + action + payload replays.
  v_replay_id := public.forge_work_field_verification_idempotency_check(
    p_owner_id, v_actor, 'link', p_request_id,
    md5(v_ver.id || '|' || p_target_kind || '|' || p_target_id));
  if v_replay_id is not null then
    select * into v_link from public.forge_work_field_verification_links
      where owner_id = p_owner_id and verification_id = v_replay_id
        and target_kind = p_target_kind
        and coalesce(bust_id, change_order_id, progress_entry_id, drawing_id, '') = p_target_id
        and retired_at is null
      order by created_at desc limit 1;
    if found then
      return v_link;
    end if;
  end if;

  select id into v_existing_id
    from public.forge_work_field_verification_links
    where owner_id = p_owner_id and verification_id = p_verification_id
      and target_kind = p_target_kind
      and coalesce(bust_id, '') = coalesce(v_bust_id, '')
      and coalesce(change_order_id, '') = coalesce(v_change_order_id, '')
      and coalesce(progress_entry_id, '') = coalesce(v_progress_entry_id, '')
      and coalesce(drawing_id, '') = coalesce(v_drawing_id, '')
      and retired_at is null
    limit 1;
  if found then
    raise exception 'WPPFV_LINK_EXISTS:%', v_existing_id;
  end if;

  insert into public.forge_work_field_verification_links
    (owner_id, id, verification_id, work_package_id, target_kind,
     bust_id, change_order_id, progress_entry_id, drawing_id,
     created_by, version)
  values
    (p_owner_id,
     'forge_wpfvl_' || replace(gen_random_uuid()::text, '-', ''),
     p_verification_id, v_ver.work_package_id, p_target_kind,
     v_bust_id, v_change_order_id, v_progress_entry_id, v_drawing_id,
     v_actor, 1)
  returning * into v_link;
  -- A link changes the verification's record, so it is a versioned
  -- edit like every other mutation: one new version, one revision
  -- at that version. The revisions unique key is one row per
  -- version — recording the link at v_ver.version would collide
  -- with the create revision and with every earlier link.
  update public.forge_work_field_verifications
    set version = version + 1
    where owner_id = p_owner_id and id = v_ver.id
    returning version into v_new_version;
  insert into public.forge_work_field_verification_revisions
    (owner_id, id, verification_id, version, actor_id, action, old_values, new_values, reason, request_id)
  values
    (p_owner_id,
     'forge_wpfvr_' || replace(gen_random_uuid()::text, '-', ''),
     v_ver.id, v_new_version, v_actor, 'link', null,
     jsonb_build_object(
       'linkId', v_link.id,
       'targetKind', p_target_kind,
       'targetId', p_target_id,
       'verificationVersion', v_new_version,
       'requestDigest', md5(v_ver.id || '|' || p_target_kind || '|' || p_target_id)),
     v_reason, p_request_id);
  return v_link;
end;
$$;

create or replace function public.forge_work_field_verification_unlink(
  p_owner_id text,
  p_link_id text,
  p_expected_version integer,
  p_reason text
)
returns public.forge_work_field_verification_links
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_link public.forge_work_field_verification_links%rowtype;
  v_ver public.forge_work_field_verifications%rowtype;
  v_reason text;
  v_new_version integer;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPPFV_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPPFV_INVALID_ACTOR';
  end if;
  v_reason := btrim(coalesce(p_reason, ''));
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'WPPFV_REASON_REQUIRED';
  end if;
  select * into v_link from public.forge_work_field_verification_links
    where owner_id = p_owner_id and id = p_link_id
    for update;
  if not found then
    raise exception 'WPPFV_LINK_NOT_FOUND';
  end if;
  if v_link.retired_at is not null then
    raise exception 'WPPFV_LINK_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_link.version then
    raise exception 'WPPFV_VERSION_CONFLICT';
  end if;
  select * into v_ver from public.forge_work_field_verifications
    where owner_id = p_owner_id and id = v_link.verification_id
    for update;
  if not found then
    raise exception 'WPPFV_VERIFICATION_NOT_FOUND';
  end if;
  if v_ver.status not in ('DRAFT', 'RETURNED') then
    raise exception 'WPPFV_INVALID_TRANSITION';
  end if;
  update public.forge_work_field_verification_links
    set retired_at = now(),
        retired_by = v_actor,
        reason = v_reason,
        version = version + 1
    where owner_id = p_owner_id and id = p_link_id
    returning * into v_link;
  -- An unlink is a versioned edit like a link: one new version,
  -- one revision at that version (see the link RPC).
  update public.forge_work_field_verifications
    set version = version + 1
    where owner_id = p_owner_id and id = v_ver.id
    returning version into v_new_version;
  insert into public.forge_work_field_verification_revisions
    (owner_id, id, verification_id, version, actor_id, action, old_values, new_values, reason)
  values
    (p_owner_id,
     'forge_wpfvr_' || replace(gen_random_uuid()::text, '-', ''),
     v_ver.id, v_new_version, v_actor, 'unlink',
     jsonb_build_object('linkId', v_link.id, 'linkVersion', v_link.version - 1),
     jsonb_build_object('linkId', v_link.id, 'linkVersion', v_link.version, 'verificationVersion', v_new_version),
     v_reason);
  return v_link;
end;
$$;

-- ---------------------------------------------------------------------------
-- ---------------------------------------------------------------------------
-- Deletion eligibility: a package that ever held a field verification
-- can never be hard-deleted — verifications are immutable audit
-- history with no hard-delete path, so purging them on package delete
-- would erase attestations. The three new branches count ALL rows
-- (including retired) — unlike the active-only branches below, which
-- count rows the delete function purges — and report the count
-- cleanly so the API can return a 409 naming the blocker instead of
-- a raw FK 500.
--
-- This is the 20261113030000 body VERBATIM (the latest definition;
-- the earlier 20261110070000 body is superseded) plus the three
-- branches. The trial-entitlement gate, the JSON-array return shape
-- ({type, count} objects, count > 0 only, ordered by type), and
-- every existing branch are preserved exactly — a replacement that
-- dropped a branch would silently unblock deletions. The delete
-- function itself is untouched (it already calls this blocker).
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_package_deletion_blocker_counts(
  p_owner_id text,
  p_package_id text
) returns jsonb
language plpgsql security definer set search_path = public as $$
begin
  if not public.forge_has_app_entitlement(p_owner_id, 'planner') then
    raise exception 'FORGE_TRIAL_ENTITLEMENT_REQUIRED' using errcode = '42501';
  end if;
  return (
select coalesce(
    jsonb_agg(
      jsonb_build_object('type', t.type, 'count', t.count)
      order by t.type
    ),
    '[]'::jsonb
  )
  from (
    select 'attestations'::text as type, count(*)::int as count
      from forge_work_gate_attestations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'budget_revisions', count(*)::int
      from forge_work_package_budget_revisions
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    -- Carry-forward (2026-11-24, PR #784 fix round): a budget
    -- allocation references its control estimate (ON DELETE RESTRICT,
    -- 20261121000000:70) and is never hard-deleted, so a retired
    -- estimate with a surviving allocation still blocks. Counted
    -- regardless of the allocation's own retired_at: the FK fires on
    -- the row in any soft state.
    select 'budget_allocations', count(*)::int
      from forge_work_budget_allocations a
      where a.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_control_estimates e
          where e.owner_id = a.owner_id and e.id = a.control_estimate_id
            and e.work_package_id = p_package_id and e.retired_at is not null
        )
    union all
    select 'gate_evaluations', count(*)::int
      from forge_work_gate_evaluations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'gate_overrides', count(*)::int
      from forge_work_gate_overrides
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'link_confirmations', count(*)::int
      from forge_work_link_confirmations c
      where c.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_links l
          where l.owner_id = c.owner_id and l.id = c.link_id
            and ((l.source_domain = 'workmgmt' and l.source_type = 'work_package'
                  and l.source_id = p_package_id)
              or (l.target_domain = 'workmgmt' and l.target_type = 'work_package'
                  and l.target_id = p_package_id))
        )
    union all
    select 'links', count(*)::int
      from forge_work_links
      where owner_id = p_owner_id
        and ((source_domain = 'workmgmt' and source_type = 'work_package'
              and source_id = p_package_id)
          or (target_domain = 'workmgmt' and target_type = 'work_package'
              and target_id = p_package_id))
    union all
    select 'manpower_days', count(*)::int
      from forge_work_manpower_days
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'observations', count(*)::int
      from forge_work_inspection_observations
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'package_baselines', count(*)::int
      from forge_work_package_baselines
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'progress_snapshots', count(*)::int
      from forge_work_progress_snapshots
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'scope_baselines', count(*)::int
      from forge_work_scope_baselines
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'scope_changes', count(*)::int
      from forge_work_scope_changes
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'transitions', count(*)::int
      from forge_work_package_transitions
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'weekly_commitments', count(*)::int
      from forge_work_weekly_commitments
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'drawings', count(*)::int
      from forge_work_drawings
      where owner_id = p_owner_id and package_id = p_package_id
    union all
    select 'progress_entries', count(*)::int
      from forge_work_progress_entries
      where owner_id = p_owner_id and work_package_id = p_package_id
    -- --- changed by this fix: active-only (retired rows no longer block) ---
    union all
    select 'permit_annotations', count(*)::int
      from forge_work_permit_annotations
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'permit_annotation_revisions', count(*)::int
      from forge_work_permit_annotation_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_permit_annotations a
          where a.owner_id = r.owner_id and a.id = r.annotation_id
            and a.work_package_id = p_package_id and a.retired_at is null
        )
    union all
    select 'craft_assignments', count(*)::int
      from forge_work_craft_assignments
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'craft_assignment_revisions', count(*)::int
      from forge_work_craft_assignment_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_craft_assignments a
          where a.owner_id = r.owner_id and a.id = r.assignment_id
            and a.work_package_id = p_package_id and a.retired_at is null
        )
    union all
    select 'steps', count(*)::int
      from forge_work_steps
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'step_revisions', count(*)::int
      from forge_work_step_revisions sr
      where sr.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_steps s
          where s.owner_id = sr.owner_id and s.id = sr.step_id
            and s.work_package_id = p_package_id
            and s.retired_at is null
        )
    -- step_order intentionally dropped from this list -- see 20261110070000.
    union all
    select 'control_estimates', count(*)::int
      from forge_work_control_estimates
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'control_estimate_revisions', count(*)::int
      from forge_work_control_estimate_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_control_estimates e
          where e.owner_id = r.owner_id and e.id = r.estimate_id
            and e.work_package_id = p_package_id and e.retired_at is null
        )
    union all
    select 'change_orders', count(*)::int
      from forge_work_change_orders
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'change_order_revisions', count(*)::int
      from forge_work_change_order_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_change_orders o
          where o.owner_id = r.owner_id and o.id = r.change_order_id
            and o.work_package_id = p_package_id and o.retired_at is null
        )
    union all
    -- Carry-forward (2026-11-24, PR #784 fix round): bust links
    -- reference their change order (ON DELETE RESTRICT,
    -- 20261115000000:349) and are never hard-deleted (unlinking only
    -- soft-retires the link row), so a retired change order with a
    -- surviving link still blocks. Counted regardless of the link's
    -- own soft state: the FK fires on the row in any state.
    select 'bust_change_order_links', count(*)::int
      from forge_work_package_bust_change_orders b
      where b.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_change_orders o
          where o.owner_id = b.owner_id and o.id = b.change_order_id
            and o.work_package_id = p_package_id and o.retired_at is not null
        )
    union all
    select 'craft_rates', count(*)::int
      from forge_work_craft_rates
      where owner_id = p_owner_id and work_package_id = p_package_id
        and retired_at is null
    union all
    select 'craft_rate_revisions', count(*)::int
      from forge_work_craft_rate_revisions r
      where r.owner_id = p_owner_id
        and exists (
          select 1 from forge_work_craft_rates c
          where c.owner_id = r.owner_id and c.id = r.craft_rate_id
            and c.work_package_id = p_package_id and c.retired_at is null
        )
    -- --- added by the field-verification slice (20261120000000): ---
    -- --- verifications are immutable audit history with no hard- ---
    -- --- delete path, so ALL rows count, including retired ones. ---
    union all
    select 'field_verifications', count(*)::int
      from forge_work_field_verifications fv
      where fv.owner_id = p_owner_id and fv.work_package_id = p_package_id
    union all
    select 'field_verification_revisions', count(*)::int
      from forge_work_field_verification_revisions fvr
      join forge_work_field_verifications fv
        on fv.owner_id = fvr.owner_id and fv.id = fvr.verification_id
      where fv.owner_id = p_owner_id and fv.work_package_id = p_package_id
    union all
    select 'field_verification_links', count(*)::int
      from forge_work_field_verification_links fvl
      where fvl.owner_id = p_owner_id and fvl.work_package_id = p_package_id
  ) t
  where t.count > 0
  );
end;
$$;

revoke all on function public.forge_work_package_deletion_blocker_counts(text, text)
  from public, anon, authenticated;
grant execute on function public.forge_work_package_deletion_blocker_counts(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- Grants: EXECUTE on the read + write RPCs for authenticated; nothing
-- for anon or service_role. Per the PR #766 lesson, function EXECUTE
-- is revoked from each named role explicitly — REVOKE ... FROM public
-- alone is a no-op for functions. The internal helpers
-- (check_decimal, canonical_number, compute_fingerprint,
-- idempotency_check, revisions_immutable) deliberately receive NO
-- grant: they are reachable only from inside the gated RPCs.
-- ---------------------------------------------------------------------------

revoke execute on function public.forge_work_field_verification_sources(text, text, text, text, date) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_sources(text, text, text, text, date) to authenticated;
revoke execute on function public.forge_work_field_verification_source_statuses(text, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_source_statuses(text, text) to authenticated;
revoke execute on function public.forge_work_field_verification_create(text, text, text, text, text, text, date, timestamptz, text, text, integer, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_create(text, text, text, text, text, text, date, timestamptz, text, text, integer, numeric, text, text, text, numeric, text, text, text, text, text, text, text, text) to authenticated;
revoke execute on function public.forge_work_field_verification_update(text, text, integer, text, boolean, date, boolean, timestamptz, boolean, text, boolean, numeric, boolean, text, boolean, text, boolean, text, boolean, numeric, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_update(text, text, integer, text, boolean, date, boolean, timestamptz, boolean, text, boolean, numeric, boolean, text, boolean, text, boolean, text, boolean, numeric, boolean, text, boolean, text, boolean, text, boolean, text, boolean, text) to authenticated;
revoke execute on function public.forge_work_field_verification_decision(text, text, text, integer, text, text, text, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_decision(text, text, text, integer, text, text, text, text) to authenticated;
revoke execute on function public.forge_work_field_verification_retire(text, text, integer, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_retire(text, text, integer, text) to authenticated;
revoke execute on function public.forge_work_field_verification_link(text, text, text, text, text, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_link(text, text, text, text, text, text) to authenticated;
revoke execute on function public.forge_work_field_verification_unlink(text, text, integer, text) from public, anon, service_role, authenticated;
grant execute on function public.forge_work_field_verification_unlink(text, text, integer, text) to authenticated;

-- Internal helpers: no direct EXECUTE for any app role.
revoke execute on function public.forge_work_field_verification_check_decimal(numeric, integer) from public, anon, service_role, authenticated;
revoke execute on function public.forge_work_field_verification_canonical_number(numeric) from public, anon, service_role, authenticated;
revoke execute on function public.forge_work_field_verification_compute_fingerprint(text, text, text, text, date) from public, anon, service_role, authenticated;
revoke execute on function public.forge_work_field_verification_idempotency_check(text, text, text, text, text) from public, anon, service_role, authenticated;
