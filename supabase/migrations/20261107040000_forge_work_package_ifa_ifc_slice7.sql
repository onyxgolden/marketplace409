-- =============================================================================
-- Work Package Planner — Slice 7: IFA-to-IFC redline review workflow
-- =============================================================================
-- FILE ONLY. DO NOT APPLY without Jason's separate word. A production
-- migration apply needs his explicit authorization; this file ships the
-- change, nothing more.
--
-- Implementable scope (results/chatgpt/work-package-planner-slice7-ifa-ifc-
-- redline-scope-2026-11-08.md, drop d476195e): an auditable review of a
-- controlled drawing issued for approval (IFA), including redlines, and
-- release of a SPECIFIC immutable drawing revision as issued for
-- construction (IFC) only when its review is closed and accepted. FORGE
-- never edits a controlled drawing's file content and never relabels an
-- IFA file as IFC. Corrections return to drafters; the approved IFC is
-- a separately uploaded issued revision. A time-critical field
-- hand-redline is retained as a separate immutable historical evidence
-- artifact, not an edit to the controlled drawing.
--
-- CORRECTION to brief §1: the brief states slice-6 migration
-- 20261107030000 is "file only, not production-applied". That is
-- WRONG: the slice-6 migration WAS applied to production 2026-11-07
-- (receipt ~/workspace/migration-receipts-20261107030000-2026-11-07.json)
-- and forge_work_step_curve_placements /
-- forge_work_step_curve_placement_revisions exist live (verified by a
-- live catalog read 2026-11-08). This migration does not reference any
-- slice-6 object, so it is safe whether or not slice-6 is applied.
-- Prerequisite slices 1–5 ARE referenced (forge_work_drawings,
-- forge_work_steps, forge_work_step_drawing_links,
-- forge_work_permit_annotations and the slice-5 delete RPC this file
-- replaces) and are all live in production.
--
-- What this slice adds:
--   * forge_wp_drawing_revisions — one immutable revision envelope per
--     issued drawing revision (IFA or IFC label, document reference,
--     content SHA-256). No revision model existed before (slice 1
--     drawings are single rows), so this table is new, not a reuse.
--     IFA revisions are created by forge_wp_drawing_revision_create;
--     IFC revisions are created ONLY inside forge_wp_drawing_ifc_release
--     so no orphan IFC revision can exist without its release.
--   * forge_wp_drawing_reviews — one review round per revision
--     (OPEN/RETURNED/APPROVED/APPROVED_WITH_REDLINES/CANCELLED).
--     One OPEN review per revision at a time (partial unique index).
--     Closed rounds are immutable; reopening means a new round.
--   * forge_wp_drawing_redlines — anchored comments on a review
--     (severity INFO/REQUIRED; resolution OPEN/RESOLVED/
--     ACCEPTED_AS_NOTED). A redline may reference a step for planning
--     context only — it can never change a step's planning state.
--   * forge_wp_drawing_review_events — append-only audit of every
--     review/redline/release/retire transition. No UPDATE/DELETE
--     grants or policies: history is written by the RPCs only.
--   * forge_wp_drawing_field_redlines — immutable field hand-redline
--     evidence (scan/photo/PDF reference + hash + reason), kept as a
--     historical record until a drafter-issued revision reconciles it.
--   * forge_wp_drawing_ifc_releases — the release record that makes a
--     revision construction-usable. One ACTIVE release per drawing.
--   * forge_work_drawings.retired_at / retired_by — logical retire
--     for a drawing with review history. A drawing with any revision
--     is RETIRED by the delete RPC, never physically deleted, so its
--     rounds, redlines and evidence stay on file.
--   * forge_wp_drawing_readiness_snapshot — SECURITY INVOKER, STABLE
--     read RPC. ONE statement returns every drawing's derived
--     readiness (latest revision, latest review, active IFC release,
--     open-required-redline count) plus package counts. The derived
--     read model never mutates a controlled drawing row.
--
-- Roles (brief §3, fallback): no planner role model exists yet (the
-- admin-permissions scopes are brief-only), so all slice-7 writes are
-- gated on has_workspace_access(owner_id) — owner/co-owner only —
-- exactly as slices 1–6 gate. Separation of duties IS enforced at the
-- decide step in this slice (fix round 1): when a reviewer_id is
-- designated on a round and differs from the round opener, the opener
-- may not decide that round — only the designated reviewer or an
-- owner/co-owner other than the opener may. With no designated
-- reviewer the single-owner flow is unchanged (the owner decides).
-- opened_by/closed_by are recorded on every round.
--
-- Terminal-package coordination (fix round 1): cancelling or
-- verifying-closed a package retires its ACTIVE IFC releases and
-- cancels its OPEN reviews in the same transaction (trigger
-- forge_wp_drawing_package_terminal), so no cancelled/closed package
-- can show an IFC drawing as construction-usable; the readiness
-- snapshot also derives a Withdrawn badge for terminal packages, so
-- the read model is correct even for packages cancelled before this
-- slice. Idempotency keys are bound to their canonical target and
-- normalized payload: a replay with a different target or payload is
-- refused with WPP7_IDEMPOTENCY_CONFLICT (409), and a concurrent
-- same-key create re-checks after acquiring its serialization lock,
-- so it replays instead of failing.
--
-- What is NOT in this slice: busts/backcharges, field verification,
-- reusable templates, in-tool editing of controlled drawings, permit
-- records, changes to slice-2 progress math, slice-4 craft
-- assignments or slice-6 manpower-curve calculations/baselines,
-- notifications, external APIs/automations, contacting Josh.
--
-- Live collision check, 2026-11-08 (before writing this file):
--   * No repo migration file 20261107040000 exists (latest repo file
--     is 20261107030000).
--   * No live table or function with a slice-7 name exists
--     (forge_wp_drawing_revisions/reviews/redlines/review_events/
--     field_redlines/ifc_releases, forge_wp_drawing_* RPCs).
--   * Slice-6 tables DO exist live (see correction above).
--   * forge_work_drawings has no retired_at/retired_by columns yet.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Controlled-drawing retire columns (additive). Slice 1 deliberately has
-- no UPDATE grant/policy on forge_work_drawings; these columns are
-- written only by the SECURITY DEFINER RPCs below, never by the app
-- client directly.
-- ---------------------------------------------------------------------------

alter table public.forge_work_drawings
  add column if not exists retired_at timestamptz,
  add column if not exists retired_by text;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

-- One immutable revision envelope per issued drawing revision. The file
-- bytes live outside this table (document_ref names the storage path or
-- library object); the SHA-256 binds the envelope to the exact bytes.
-- A revision is never edited in place: a corrected drawing is a NEW
-- revision with a new code. Retiring a revision keeps it on file for
-- the audit trail; only the latest non-retired revision feeds the
-- derived readiness model.
create table if not exists public.forge_wp_drawing_revisions (
  owner_id text not null,
  id text not null,
  package_id text not null,
  drawing_id text not null,
  revision_code text not null
    check (btrim(revision_code) <> '' and char_length(revision_code) <= 40),
  document_ref text not null
    check (btrim(document_ref) <> '' and char_length(document_ref) <= 1000),
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-fA-F]{64}$'),
  issued_as text not null check (issued_as in ('IFA', 'IFC')),
  issued_at timestamptz not null default now(),
  created_by text not null,
  created_at timestamptz not null default now(),
  retired_at timestamptz,
  retired_by text,
  primary key (owner_id, id),
  unique (owner_id, drawing_id, revision_code),
  unique (owner_id, package_id, drawing_id, id),
  foreign key (owner_id, package_id, drawing_id)
    references public.forge_work_drawings (owner_id, package_id, id)
    on delete restrict,
  check (retired_at is null or retired_by is not null)
);

create index if not exists forge_wp_drawing_revisions_drawing_idx
  on public.forge_wp_drawing_revisions (owner_id, drawing_id, issued_at desc, id);

-- One review round bound to an exact revision and its content digest.
-- round_no is per-revision (1, 2, 3 ...); a new round is the ONLY way
-- to reopen a closed decision. reviewer_id records the assigned
-- reviewer; it does not restrict who may decide in this slice (see
-- header: owner/co-owner-only gates until the role model lands).
create table if not exists public.forge_wp_drawing_reviews (
  owner_id text not null,
  id text not null,
  package_id text not null,
  drawing_id text not null,
  drawing_revision_id text not null,
  round_no integer not null check (round_no >= 1),
  state text not null
    check (state in ('OPEN', 'RETURNED', 'APPROVED', 'APPROVED_WITH_REDLINES', 'CANCELLED')),
  reviewer_id text,
  idempotency_key text,
  opened_by text not null,
  opened_at timestamptz not null default now(),
  closed_by text,
  closed_at timestamptz,
  decision_reason text check (decision_reason is null or char_length(decision_reason) <= 1000),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  primary key (owner_id, id),
  unique (owner_id, drawing_revision_id, round_no),
  unique (owner_id, package_id, drawing_id, id),
  -- The four downstream FKs (redlines, review events, field
  -- redlines, IFC releases) reference (owner_id, package_id, id):
  -- PostgreSQL requires an exact unique constraint on the referenced
  -- columns, and the PK (owner_id, id) alone does not satisfy a
  -- three-column reference. Implied by the PK, stated explicitly.
  unique (owner_id, package_id, id),
  foreign key (owner_id, package_id, drawing_id, drawing_revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id)
    on delete restrict,
  check (closed_at is null or closed_by is not null),
  check (state = 'OPEN' or closed_at is not null),
  check (retired_at is null or retired_by is not null)
);

-- No two simultaneously OPEN reviews for the same drawing revision.
create unique index if not exists forge_wp_drawing_reviews_open_uq
  on public.forge_wp_drawing_reviews (owner_id, drawing_revision_id)
  where state = 'OPEN';

-- Idempotent review creation: a retry with the same key returns the
-- original round instead of opening a duplicate.
create unique index if not exists forge_wp_drawing_reviews_idempotency_uq
  on public.forge_wp_drawing_reviews (owner_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists forge_wp_drawing_reviews_drawing_idx
  on public.forge_wp_drawing_reviews (owner_id, drawing_id, opened_at desc, id);

-- One anchored comment on a review. anchor is a sheet/page plus a
-- bounded 0..1 x/y pair or a text reference; at least the comment is
-- always present. step_id is planning context only (reference, never
-- a planning-state change). A mistaken open redline is soft-retired
-- with a reason; a resolved redline keeps its resolution + note.
create table if not exists public.forge_wp_drawing_redlines (
  owner_id text not null,
  id text not null,
  package_id text not null,
  review_id text not null,
  drawing_id text not null,
  drawing_revision_id text not null,
  step_id text,
  anchor_page integer check (anchor_page is null or anchor_page >= 1),
  anchor_x numeric check (anchor_x is null or (anchor_x >= 0 and anchor_x <= 1)),
  anchor_y numeric check (anchor_y is null or (anchor_y >= 0 and anchor_y <= 1)),
  anchor_text text check (anchor_text is null or char_length(anchor_text) <= 500),
  comment text not null
    check (btrim(comment) <> '' and char_length(comment) <= 2000),
  severity text not null check (severity in ('INFO', 'REQUIRED')),
  resolution text not null default 'OPEN'
    check (resolution in ('OPEN', 'RESOLVED', 'ACCEPTED_AS_NOTED')),
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  idempotency_key text,
  created_by text not null,
  created_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  primary key (owner_id, id),
  unique (owner_id, package_id, review_id, id),
  foreign key (owner_id, package_id, review_id)
    references public.forge_wp_drawing_reviews (owner_id, package_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, drawing_id, drawing_revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, step_id)
    references public.forge_work_steps (owner_id, work_package_id, id)
    on delete restrict,
  check ((anchor_x is null and anchor_y is null) or (anchor_x is not null and anchor_y is not null)),
  -- A non-OPEN resolution on a REQUIRED redline must carry a note;
  -- INFO redlines never need one. (The resolve RPC enforces the same
  -- rule before the row can reach this CHECK.)
  check (resolution = 'OPEN' or severity = 'INFO' or resolution_note is not null),
  check (retired_at is null or retired_by is not null)
);

create unique index if not exists forge_wp_drawing_redlines_idempotency_uq
  on public.forge_wp_drawing_redlines (owner_id, idempotency_key)
  where idempotency_key is not null;

create index if not exists forge_wp_drawing_redlines_review_idx
  on public.forge_wp_drawing_redlines (owner_id, review_id, created_at, id);

-- Append-only audit of every review/redline/release/retire
-- transition. review_id is null for drawing-level events (drawing
-- retired); drawing_id is null only when the event is review-scoped
-- and the drawing is implied — in practice both are set by the RPCs.
-- No UPDATE/DELETE grants or policies exist for this table: the RPCs
-- are the only write path, and they only INSERT.
create table if not exists public.forge_wp_drawing_review_events (
  owner_id text not null,
  id text not null,
  package_id text not null,
  review_id text,
  drawing_id text,
  actor_id text not null,
  event_type text not null check (event_type in (
    'REVIEW_OPENED', 'REDLINE_ADDED', 'REDLINE_RESOLVED', 'REDLINE_RETIRED',
    'REVIEW_APPROVED', 'REVIEW_APPROVED_WITH_REDLINES', 'REVIEW_RETURNED',
    'REVIEW_CANCELLED', 'IFC_RELEASED', 'IFC_RELEASE_RETIRED',
    'DRAWING_RETIRED', 'FIELD_REDLINE_CAPTURED', 'FIELD_REDLINE_RECONCILED'
  )),
  before_state text,
  after_state text,
  payload_minimal jsonb,
  request_id text,
  occurred_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, package_id, review_id)
    references public.forge_wp_drawing_reviews (owner_id, package_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, drawing_id)
    references public.forge_work_drawings (owner_id, package_id, id)
    on delete restrict,
  check (review_id is not null or drawing_id is not null)
);

create index if not exists forge_wp_drawing_review_events_review_idx
  on public.forge_wp_drawing_review_events (owner_id, review_id, occurred_at, id);

create index if not exists forge_wp_drawing_review_events_drawing_idx
  on public.forge_wp_drawing_review_events (owner_id, drawing_id, occurred_at, id);

-- Immutable field hand-redline evidence. A scan/photo/PDF of a
-- hand-marked iso, captured as its own artifact with the source
-- revision's identity — it never modifies, replaces or approves the
-- controlled file and never converts IFA to IFC. It stays
-- HISTORICAL_PENDING_RECONCILIATION until a drafter-issued corrected
-- revision is linked; both artifacts are retained permanently.
create table if not exists public.forge_wp_drawing_field_redlines (
  owner_id text not null,
  id text not null,
  package_id text not null,
  drawing_id text not null,
  drawing_revision_id text not null,
  review_id text,
  artifact_ref text not null
    check (btrim(artifact_ref) <> '' and char_length(artifact_ref) <= 1000),
  sha256 text not null check (sha256 ~ '^[0-9a-fA-F]{64}$'),
  captured_by text not null,
  captured_at timestamptz not null default now(),
  field_reason text not null
    check (btrim(field_reason) <> '' and char_length(field_reason) <= 1000),
  record_state text not null default 'HISTORICAL_PENDING_RECONCILIATION'
    check (record_state in ('HISTORICAL_PENDING_RECONCILIATION', 'RECONCILED', 'RETIRED')),
  reconciled_revision_id text,
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  primary key (owner_id, id),
  unique (owner_id, package_id, drawing_id, id),
  foreign key (owner_id, package_id, drawing_id, drawing_revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, review_id)
    references public.forge_wp_drawing_reviews (owner_id, package_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, drawing_id, reconciled_revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id)
    on delete restrict,
  check (retired_at is null or retired_by is not null),
  check (record_state <> 'RECONCILED' or reconciled_revision_id is not null)
);

create index if not exists forge_wp_drawing_field_redlines_drawing_idx
  on public.forge_wp_drawing_field_redlines (owner_id, drawing_id, captured_at desc, id);

-- The release record that makes a revision construction-usable. An IFC
-- revision without a live release here is NOT construction-usable —
-- the derived readiness model reads this table, never the revision's
-- issued_as label alone. One ACTIVE release per drawing; a re-issue
-- retires the previous release (kept on file) in the same transaction.
create table if not exists public.forge_wp_drawing_ifc_releases (
  owner_id text not null,
  id text not null,
  package_id text not null,
  drawing_id text not null,
  ifc_revision_id text not null,
  review_id text not null,
  released_by text not null,
  released_at timestamptz not null default now(),
  version integer not null default 1 check (version >= 1),
  retired_at timestamptz,
  retired_by text,
  primary key (owner_id, id),
  unique (owner_id, package_id, drawing_id, id),
  foreign key (owner_id, package_id, drawing_id, ifc_revision_id)
    references public.forge_wp_drawing_revisions (owner_id, package_id, drawing_id, id)
    on delete restrict,
  foreign key (owner_id, package_id, review_id)
    references public.forge_wp_drawing_reviews (owner_id, package_id, id)
    on delete restrict,
  check (retired_at is null or retired_by is not null)
);

create unique index if not exists forge_wp_drawing_ifc_releases_active_uq
  on public.forge_wp_drawing_ifc_releases (owner_id, drawing_id)
  where retired_at is null;

-- ---------------------------------------------------------------------------
-- Row-level security: owner-scoped SELECT only, forced on every role.
-- Writes go through the SECURITY DEFINER RPCs below; no direct
-- app-client mutations. This mirrors slices 3–6: the SELECT policy is
-- the only policy, and there are no write policies.
-- ---------------------------------------------------------------------------

alter table public.forge_wp_drawing_revisions enable row level security;
alter table public.forge_wp_drawing_revisions force row level security;
alter table public.forge_wp_drawing_reviews enable row level security;
alter table public.forge_wp_drawing_reviews force row level security;
alter table public.forge_wp_drawing_redlines enable row level security;
alter table public.forge_wp_drawing_redlines force row level security;
alter table public.forge_wp_drawing_review_events enable row level security;
alter table public.forge_wp_drawing_review_events force row level security;
alter table public.forge_wp_drawing_field_redlines enable row level security;
alter table public.forge_wp_drawing_field_redlines force row level security;
alter table public.forge_wp_drawing_ifc_releases enable row level security;
alter table public.forge_wp_drawing_ifc_releases force row level security;

drop policy if exists forge_wp_drawing_revisions_select on public.forge_wp_drawing_revisions;
create policy forge_wp_drawing_revisions_select
  on public.forge_wp_drawing_revisions for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_wp_drawing_reviews_select on public.forge_wp_drawing_reviews;
create policy forge_wp_drawing_reviews_select
  on public.forge_wp_drawing_reviews for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_wp_drawing_redlines_select on public.forge_wp_drawing_redlines;
create policy forge_wp_drawing_redlines_select
  on public.forge_wp_drawing_redlines for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_wp_drawing_review_events_select on public.forge_wp_drawing_review_events;
create policy forge_wp_drawing_review_events_select
  on public.forge_wp_drawing_review_events for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_wp_drawing_field_redlines_select on public.forge_wp_drawing_field_redlines;
create policy forge_wp_drawing_field_redlines_select
  on public.forge_wp_drawing_field_redlines for select to authenticated
  using (has_workspace_access(owner_id));

drop policy if exists forge_wp_drawing_ifc_releases_select on public.forge_wp_drawing_ifc_releases;
create policy forge_wp_drawing_ifc_releases_select
  on public.forge_wp_drawing_ifc_releases for select to authenticated
  using (has_workspace_access(owner_id));

-- ---------------------------------------------------------------------------
-- Grants: SELECT-only for authenticated; nothing for anon or
-- service_role. Supabase default privileges re-grant ALL on new public
-- tables and EXECUTE on new functions to the app roles, so every grant
-- is stated explicitly here (and verified after the apply with an
-- ACL/RLS receipt). The explicit REVOKEs below are load-bearing: a
-- selective GRANT alone does NOT remove an already-effective broad
-- default privilege.
-- ---------------------------------------------------------------------------

revoke all on table public.forge_wp_drawing_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_revisions to authenticated;
revoke all on table public.forge_wp_drawing_reviews from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_reviews to authenticated;
revoke all on table public.forge_wp_drawing_redlines from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_redlines to authenticated;
revoke all on table public.forge_wp_drawing_review_events from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_review_events to authenticated;
revoke all on table public.forge_wp_drawing_field_redlines from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_field_redlines to authenticated;
revoke all on table public.forge_wp_drawing_ifc_releases from public, anon, service_role, authenticated;
grant select on table public.forge_wp_drawing_ifc_releases to authenticated;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_revision_create
-- Upload one immutable IFA revision envelope for a drawing. IFC
-- revisions are NOT created here — they are created only inside
-- forge_wp_drawing_ifc_release, so no orphan IFC revision can exist
-- without its release. The revision's document_ref + SHA-256 bind the
-- envelope to the exact uploaded bytes; the bytes themselves live in
-- storage, never in this table.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_revision_create(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_revision_code text,
  p_document_ref text,
  p_content_sha256 text
)
returns setof public.forge_wp_drawing_revisions
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_revision_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_revision_code is null or btrim(p_revision_code) = ''
     or char_length(p_revision_code) > 40
     or p_revision_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$' then
    raise exception 'WPP7_INVALID_REVISION_CODE';
  end if;
  if p_document_ref is null or btrim(p_document_ref) = ''
     or char_length(p_document_ref) > 1000 then
    raise exception 'WPP7_INVALID_DOCUMENT_REF';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'WPP7_INVALID_SHA256';
  end if;

  -- Lock the package row: a concurrent package cancellation (whose
  -- trigger retires ACTIVE releases) serializes against this release
  -- instead of racing it — whichever commits first, the drawing ends
  -- non-usable in a terminal package.
  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
  for update;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  v_revision_id := 'forge_wpdrv_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_revisions (
      owner_id, id, package_id, drawing_id, revision_code,
      document_ref, content_sha256, issued_as, created_by
    ) values (
      p_owner_id, v_revision_id, p_package_id, p_drawing_id,
      btrim(p_revision_code), btrim(p_document_ref), lower(p_content_sha256),
      'IFA', v_actor_id
    );
  exception when unique_violation then
    raise exception 'WPP7_DUPLICATE_REVISION';
  end;

  return query
    select *
    from public.forge_wp_drawing_revisions
    where owner_id = p_owner_id and id = v_revision_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_review_create
-- Open one review round on an exact IFA revision. round_no is the next
-- per-revision round; the revision row is locked so two concurrent
-- opens serialize instead of racing the same round number. A retry
-- with the same idempotency key returns the original round.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_review_create(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_drawing_revision_id text,
  p_reviewer_id text default null,
  p_idempotency_key text default null,
  p_reason text default null
)
returns setof public.forge_wp_drawing_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_revision public.forge_wp_drawing_revisions%rowtype;
  v_existing public.forge_wp_drawing_reviews%rowtype;
  v_round_no integer;
  v_review_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_TOO_LONG';
  end if;

  -- Idempotency first: a retry returns the original round even if
  -- the revision has since been retired or the package closed. The
  -- key is bound to its canonical target (drawing revision) and
  -- normalized payload (designated reviewer): a replay whose target
  -- or reviewer differs is a different request and is refused with
  -- WPP7_IDEMPOTENCY_CONFLICT instead of returning the wrong round.
  -- The reason is free text and is NOT part of the fingerprint, so a
  -- retry that rewords it still replays.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.drawing_revision_id <> p_drawing_revision_id
         or v_existing.reviewer_id is distinct from p_reviewer_id then
        raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
      end if;
      return query
        select * from public.forge_wp_drawing_reviews
        where owner_id = p_owner_id and id = v_existing.id;
      return;
    end if;
  end if;

  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  -- Lock the revision: concurrent opens serialize here, so the round
  -- number and the one-OPEN-review rule can never race.
  select * into v_revision
  from public.forge_wp_drawing_revisions
  where owner_id = p_owner_id and package_id = p_package_id
    and drawing_id = p_drawing_id and id = p_drawing_revision_id
  for update;
  if not found then
    raise exception 'WPP7_REVISION_NOT_FOUND';
  end if;
  if v_revision.retired_at is not null then
    raise exception 'WPP7_REVISION_RETIRED';
  end if;
  if v_revision.issued_as <> 'IFA' then
    raise exception 'WPP7_REVISION_NOT_IFA';
  end if;

  -- Recheck after the serialization lock: a concurrent same-key
  -- open may have committed while this call waited on the revision
  -- row — replay it (or refuse a conflicting key) instead of racing
  -- the insert.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.drawing_revision_id <> p_drawing_revision_id
         or v_existing.reviewer_id is distinct from p_reviewer_id then
        raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
      end if;
      return query
        select * from public.forge_wp_drawing_reviews
        where owner_id = p_owner_id and id = v_existing.id;
      return;
    end if;
  end if;

  select coalesce(max(round_no), 0) + 1 into v_round_no
  from public.forge_wp_drawing_reviews
  where owner_id = p_owner_id and drawing_revision_id = p_drawing_revision_id;

  v_review_id := 'forge_wpdrvw_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_reviews (
      owner_id, id, package_id, drawing_id, drawing_revision_id,
      round_no, state, reviewer_id, idempotency_key, opened_by
    ) values (
      p_owner_id, v_review_id, p_package_id, p_drawing_id,
      p_drawing_revision_id, v_round_no, 'OPEN', p_reviewer_id,
      p_idempotency_key, v_actor_id
    );
  exception when unique_violation then
    -- Two requests racing the same key, or a second OPEN review on
    -- the same revision: tell them apart by re-reading the key. A
    -- matching key replays; a mismatched key conflicts; anything
    -- else is the one-OPEN-review rule.
    if p_idempotency_key is not null then
      select * into v_existing
      from public.forge_wp_drawing_reviews
      where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
      if found then
        if v_existing.drawing_revision_id <> p_drawing_revision_id
           or v_existing.reviewer_id is distinct from p_reviewer_id then
          raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
        end if;
        return query
          select * from public.forge_wp_drawing_reviews
          where owner_id = p_owner_id and id = v_existing.id;
        return;
      end if;
    end if;
    raise exception 'WPP7_DUPLICATE_OPEN_REVIEW';
  end;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    p_package_id, v_review_id, p_drawing_id, v_actor_id,
    'REVIEW_OPENED', null, 'OPEN',
    jsonb_build_object('round_no', v_round_no, 'reviewer_id', p_reviewer_id, 'reason', p_reason)
  );

  return query
    select *
    from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and id = v_review_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_redline_create
-- Add one anchored comment to an OPEN review. The redline is bound to
-- the review's exact revision (a caller-supplied revision that does
-- not match the review is refused). A step link is planning context
-- only and can never change the step's planning state.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_redline_create(
  p_owner_id text,
  p_review_id text,
  p_drawing_revision_id text,
  p_comment text,
  p_severity text,
  p_step_id text default null,
  p_anchor_page integer default null,
  p_anchor_x numeric default null,
  p_anchor_y numeric default null,
  p_anchor_text text default null,
  p_idempotency_key text default null
)
returns setof public.forge_wp_drawing_redlines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_existing public.forge_wp_drawing_redlines%rowtype;
  v_step public.forge_work_steps%rowtype;
  v_redline_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_comment is null or btrim(p_comment) = '' or char_length(p_comment) > 2000
     or p_comment ~ '[\x00-\x1F\x7F]'
     or p_comment ~ '<[A-Za-z][^>]*>' then
    raise exception 'WPP7_INVALID_COMMENT';
  end if;
  if p_severity not in ('INFO', 'REQUIRED') then
    raise exception 'WPP7_INVALID_SEVERITY';
  end if;
  if p_anchor_page is not null and p_anchor_page < 1 then
    raise exception 'WPP7_INVALID_ANCHOR';
  end if;
  if (p_anchor_x is null) <> (p_anchor_y is null) then
    raise exception 'WPP7_INVALID_ANCHOR';
  end if;
  if p_anchor_x is not null and (p_anchor_x < 0 or p_anchor_x > 1) then
    raise exception 'WPP7_INVALID_ANCHOR';
  end if;
  if p_anchor_y is not null and (p_anchor_y < 0 or p_anchor_y > 1) then
    raise exception 'WPP7_INVALID_ANCHOR';
  end if;
  if p_anchor_text is not null and char_length(p_anchor_text) > 500 then
    raise exception 'WPP7_INVALID_ANCHOR';
  end if;

  -- Idempotency first: a retry returns the original redline even if
  -- the review has since closed. The key is bound to its canonical
  -- target (review + revision) and normalized payload (comment,
  -- severity, step link, anchor): a replay whose target or payload
  -- differs is a different request and is refused with
  -- WPP7_IDEMPOTENCY_CONFLICT instead of returning the wrong redline.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.forge_wp_drawing_redlines
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.review_id <> p_review_id
         or v_existing.drawing_revision_id <> p_drawing_revision_id
         or v_existing.comment <> p_comment
         or v_existing.severity <> p_severity
         or v_existing.step_id is distinct from p_step_id
         or v_existing.anchor_page is distinct from p_anchor_page
         or v_existing.anchor_x is distinct from p_anchor_x
         or v_existing.anchor_y is distinct from p_anchor_y
         or v_existing.anchor_text is distinct from p_anchor_text then
        raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
      end if;
      return query
        select * from public.forge_wp_drawing_redlines
        where owner_id = p_owner_id and id = v_existing.id;
      return;
    end if;
  end if;

  select * into v_review
  from public.forge_wp_drawing_reviews
  where owner_id = p_owner_id and id = p_review_id
  for update;
  if not found then
    raise exception 'WPP7_REVIEW_NOT_FOUND';
  end if;
  if v_review.state <> 'OPEN' then
    raise exception 'WPP7_REVIEW_CLOSED';
  end if;
  if v_review.drawing_revision_id <> p_drawing_revision_id then
    raise exception 'WPP7_REVISION_MISMATCH';
  end if;

  if p_step_id is not null then
    select * into v_step
    from public.forge_work_steps
    where owner_id = p_owner_id and work_package_id = v_review.package_id and id = p_step_id;
    if not found then
      raise exception 'WPP7_STEP_NOT_FOUND';
    end if;
    if v_step.retired_at is not null then
      raise exception 'WPP7_STEP_RETIRED';
    end if;
  end if;

  -- Recheck after the serialization lock: a concurrent same-key
  -- create may have committed while this call waited on the review
  -- row — replay it (or refuse a conflicting key) instead of
  -- failing on the unique index.
  if p_idempotency_key is not null then
    select * into v_existing
    from public.forge_wp_drawing_redlines
    where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
    if found then
      if v_existing.review_id <> p_review_id
         or v_existing.drawing_revision_id <> p_drawing_revision_id
         or v_existing.comment <> p_comment
         or v_existing.severity <> p_severity
         or v_existing.step_id is distinct from p_step_id
         or v_existing.anchor_page is distinct from p_anchor_page
         or v_existing.anchor_x is distinct from p_anchor_x
         or v_existing.anchor_y is distinct from p_anchor_y
         or v_existing.anchor_text is distinct from p_anchor_text then
        raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
      end if;
      return query
        select * from public.forge_wp_drawing_redlines
        where owner_id = p_owner_id and id = v_existing.id;
      return;
    end if;
  end if;

  v_redline_id := 'forge_wpdrl_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_redlines (
      owner_id, id, package_id, review_id, drawing_id, drawing_revision_id,
      step_id, anchor_page, anchor_x, anchor_y, anchor_text,
      comment, severity, idempotency_key, created_by
    ) values (
      p_owner_id, v_redline_id, v_review.package_id, p_review_id,
      v_review.drawing_id, p_drawing_revision_id,
      p_step_id, p_anchor_page, p_anchor_x, p_anchor_y, p_anchor_text,
      p_comment, p_severity, p_idempotency_key, v_actor_id
    );
  exception when unique_violation then
    -- A same-key create racing this one: the recheck above should
    -- have caught it, but the unique index is the final arbiter.
    -- Re-read the key — a matching key replays, a mismatched key
    -- conflicts, anything else re-raises as-is.
    if p_idempotency_key is not null then
      select * into v_existing
      from public.forge_wp_drawing_redlines
      where owner_id = p_owner_id and idempotency_key = p_idempotency_key;
      if found then
        if v_existing.review_id <> p_review_id
           or v_existing.drawing_revision_id <> p_drawing_revision_id
           or v_existing.comment <> p_comment
           or v_existing.severity <> p_severity
           or v_existing.step_id is distinct from p_step_id
           or v_existing.anchor_page is distinct from p_anchor_page
           or v_existing.anchor_x is distinct from p_anchor_x
           or v_existing.anchor_y is distinct from p_anchor_y
           or v_existing.anchor_text is distinct from p_anchor_text then
          raise exception 'WPP7_IDEMPOTENCY_CONFLICT';
        end if;
        return query
          select * from public.forge_wp_drawing_redlines
          where owner_id = p_owner_id and id = v_existing.id;
        return;
      end if;
    end if;
    raise;
  end;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    v_review.package_id, p_review_id, v_review.drawing_id, v_actor_id,
    'REDLINE_ADDED', null, 'OPEN',
    jsonb_build_object('redline_id', v_redline_id, 'severity', p_severity)
  );

  return query
    select *
    from public.forge_wp_drawing_redlines
    where owner_id = p_owner_id and id = v_redline_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_redline_resolve
-- Resolve one open redline (RESOLVED or ACCEPTED_AS_NOTED) or
-- soft-retire a mistaken open redline, guarded by the caller's
-- expected version. A non-OPEN resolution on a REQUIRED redline must
-- carry a note. Redlines on a closed review cannot change: the
-- review's decision stands, and a new round is the only way forward.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_redline_resolve(
  p_owner_id text,
  p_redline_id text,
  p_expected_version integer,
  p_resolution text,
  p_resolution_note text default null,
  p_retire boolean default false,
  p_reason text default null
)
returns setof public.forge_wp_drawing_redlines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_redline public.forge_wp_drawing_redlines%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_TOO_LONG';
  end if;

  select * into v_redline
  from public.forge_wp_drawing_redlines
  where owner_id = p_owner_id and id = p_redline_id
  for update;
  if not found then
    raise exception 'WPP7_REDLINE_NOT_FOUND';
  end if;
  if v_redline.retired_at is not null then
    raise exception 'WPP7_REDLINE_RETIRED';
  end if;
  if p_expected_version is null or p_expected_version <> v_redline.version then
    raise exception 'WPP7_VERSION_CONFLICT';
  end if;

  select * into v_review
  from public.forge_wp_drawing_reviews
  where owner_id = p_owner_id and id = v_redline.review_id;
  if not found or v_review.state <> 'OPEN' then
    raise exception 'WPP7_REVIEW_CLOSED';
  end if;

  if p_retire then
    if p_reason is null or btrim(p_reason) = '' then
      raise exception 'WPP7_REASON_REQUIRED';
    end if;
    update public.forge_wp_drawing_redlines
    set retired_at = now(),
        retired_by = v_actor_id,
        version = version + 1
    where owner_id = p_owner_id and id = p_redline_id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      v_redline.package_id, v_redline.review_id, v_redline.drawing_id, v_actor_id,
      'REDLINE_RETIRED', 'OPEN', 'RETIRED',
      jsonb_build_object('redline_id', p_redline_id, 'reason', p_reason)
    );
  else
    if p_resolution not in ('RESOLVED', 'ACCEPTED_AS_NOTED') then
      raise exception 'WPP7_INVALID_RESOLUTION';
    end if;
    if v_redline.resolution <> 'OPEN' then
      raise exception 'WPP7_REDLINE_RESOLVED';
    end if;
    if v_redline.severity = 'REQUIRED'
       and (p_resolution_note is null or btrim(p_resolution_note) = '') then
      raise exception 'WPP7_RESOLUTION_NOTE_REQUIRED';
    end if;
    if p_resolution_note is not null and char_length(p_resolution_note) > 1000 then
      raise exception 'WPP7_RESOLUTION_NOTE_TOO_LONG';
    end if;

    update public.forge_wp_drawing_redlines
    set resolution = p_resolution,
        resolution_note = p_resolution_note,
        version = version + 1
    where owner_id = p_owner_id and id = p_redline_id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      v_redline.package_id, v_redline.review_id, v_redline.drawing_id, v_actor_id,
      'REDLINE_RESOLVED', 'OPEN', p_resolution,
      jsonb_build_object('redline_id', p_redline_id, 'resolution_note', p_resolution_note, 'reason', p_reason)
    );
  end if;

  return query
    select *
    from public.forge_wp_drawing_redlines
    where owner_id = p_owner_id and id = p_redline_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_review_decide
-- Close an OPEN review: APPROVE (no open redlines at all),
-- APPROVE_WITH_REDLINES (no open REQUIRED redlines; INFO may remain
-- open), or RETURN_TO_DRAFTER. A reason is always required. The
-- decision, the actor and the time are recorded on the round, and the
-- round is immutable afterwards — corrections need a new round.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_review_decide(
  p_owner_id text,
  p_review_id text,
  p_expected_version integer,
  p_decision text,
  p_reason text
)
returns setof public.forge_wp_drawing_reviews
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_new_state text;
  v_event_type text;
  v_open_count integer;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_REQUIRED';
  end if;
  if p_decision not in ('APPROVE', 'APPROVE_WITH_REDLINES', 'RETURN_TO_DRAFTER') then
    raise exception 'WPP7_INVALID_DECISION';
  end if;

  select * into v_review
  from public.forge_wp_drawing_reviews
  where owner_id = p_owner_id and id = p_review_id
  for update;
  if not found then
    raise exception 'WPP7_REVIEW_NOT_FOUND';
  end if;
  if v_review.state <> 'OPEN' then
    raise exception 'WPP7_REVIEW_CLOSED';
  end if;
  if p_expected_version is null or p_expected_version <> v_review.version then
    raise exception 'WPP7_VERSION_CONFLICT';
  end if;

  -- Separation of duties: when a reviewer is designated on the round
  -- and differs from the round opener, the opener may not decide
  -- their own round — only the designated reviewer, or an
  -- owner/co-owner other than the opener, may. With no designated
  -- reviewer (or when the opener designated themself) the
  -- single-owner flow is unchanged: the opener decides.
  if v_review.reviewer_id is not null
     and v_review.reviewer_id <> v_review.opened_by
     and v_actor_id = v_review.opened_by then
    raise exception 'WPP7_DECISION_FORBIDDEN';
  end if;

  if p_decision = 'APPROVE' then
    select count(*) into v_open_count
    from public.forge_wp_drawing_redlines
    where owner_id = p_owner_id and review_id = p_review_id
      and resolution = 'OPEN' and retired_at is null;
    if v_open_count > 0 then
      raise exception 'WPP7_OPEN_REDLINES';
    end if;
    v_new_state := 'APPROVED';
    v_event_type := 'REVIEW_APPROVED';
  elsif p_decision = 'APPROVE_WITH_REDLINES' then
    select count(*) into v_open_count
    from public.forge_wp_drawing_redlines
    where owner_id = p_owner_id and review_id = p_review_id
      and resolution = 'OPEN' and severity = 'REQUIRED' and retired_at is null;
    if v_open_count > 0 then
      raise exception 'WPP7_OPEN_REQUIRED_REDLINES';
    end if;
    v_new_state := 'APPROVED_WITH_REDLINES';
    v_event_type := 'REVIEW_APPROVED_WITH_REDLINES';
  else
    v_new_state := 'RETURNED';
    v_event_type := 'REVIEW_RETURNED';
  end if;

  update public.forge_wp_drawing_reviews
  set state = v_new_state,
      closed_by = v_actor_id,
      closed_at = now(),
      decision_reason = btrim(p_reason),
      version = version + 1
  where owner_id = p_owner_id and id = p_review_id;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    v_review.package_id, p_review_id, v_review.drawing_id, v_actor_id,
    v_event_type, 'OPEN', v_new_state,
    jsonb_build_object('reason', p_reason)
  );

  return query
    select *
    from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and id = p_review_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_ifc_release
-- Issue one revision for construction. Atomically: create the distinct
-- IFC revision envelope, retire any previous ACTIVE release for the
-- drawing, and record the release + audit event. The release must
-- reference an ACCEPTED review (APPROVED or APPROVED_WITH_REDLINES)
-- whose revision is still the latest non-retired revision of the
-- drawing, and no other review of the drawing may be OPEN. Approval
-- alone never makes a drawing construction-usable — only this release
-- does, and the derived readiness model reads this table, never the
-- revision's issued_as label.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_ifc_release(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_review_id text,
  p_ifc_revision_code text,
  p_document_ref text,
  p_content_sha256 text,
  p_reason text default null
)
returns setof public.forge_wp_drawing_ifc_releases
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_latest_revision_id text;
  v_prior_release public.forge_wp_drawing_ifc_releases%rowtype;
  v_ifc_revision_id text;
  v_release_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_ifc_revision_code is null or btrim(p_ifc_revision_code) = ''
     or char_length(p_ifc_revision_code) > 40
     or p_ifc_revision_code !~ '^[A-Za-z0-9][A-Za-z0-9 ._-]*$' then
    raise exception 'WPP7_INVALID_REVISION_CODE';
  end if;
  if p_document_ref is null or btrim(p_document_ref) = ''
     or char_length(p_document_ref) > 1000 then
    raise exception 'WPP7_INVALID_DOCUMENT_REF';
  end if;
  if p_content_sha256 is null or p_content_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'WPP7_INVALID_SHA256';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_TOO_LONG';
  end if;

  -- Lock the package row: a concurrent package cancellation (whose
  -- trigger retires ACTIVE releases) serializes against this release
  -- instead of racing it — whichever commits first, the drawing ends
  -- non-usable in a terminal package.
  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id
  for update;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
  for update;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  select * into v_review
  from public.forge_wp_drawing_reviews
  where owner_id = p_owner_id and id = p_review_id
  for update;
  if not found then
    raise exception 'WPP7_REVIEW_NOT_FOUND';
  end if;
  if v_review.package_id <> p_package_id or v_review.drawing_id <> p_drawing_id then
    raise exception 'WPP7_REVIEW_MISMATCH';
  end if;
  if v_review.state not in ('APPROVED', 'APPROVED_WITH_REDLINES') then
    raise exception 'WPP7_REVIEW_NOT_APPROVED';
  end if;

  -- The accepted review must still be for the latest issued revision:
  -- a newer drafter revision after approval means the approval no
  -- longer covers the drawing.
  select id into v_latest_revision_id
  from public.forge_wp_drawing_revisions
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  order by issued_at desc, id desc
  limit 1;
  if v_latest_revision_id is distinct from v_review.drawing_revision_id then
    raise exception 'WPP7_REVIEW_STALE';
  end if;

  -- No open review may exist for the drawing (any revision) at
  -- release time.
  if exists (
    select 1 from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and drawing_id = p_drawing_id and state = 'OPEN'
  ) then
    raise exception 'WPP7_OPEN_REVIEW_EXISTS';
  end if;

  v_ifc_revision_id := 'forge_wpdrv_' || replace(gen_random_uuid()::text, '-', '');
  begin
    insert into public.forge_wp_drawing_revisions (
      owner_id, id, package_id, drawing_id, revision_code,
      document_ref, content_sha256, issued_as, created_by
    ) values (
      p_owner_id, v_ifc_revision_id, p_package_id, p_drawing_id,
      btrim(p_ifc_revision_code), btrim(p_document_ref), lower(p_content_sha256),
      'IFC', v_actor_id
    );
  exception when unique_violation then
    raise exception 'WPP7_DUPLICATE_REVISION';
  end;

  -- A re-issue retires the previous ACTIVE release (kept on file).
  select * into v_prior_release
  from public.forge_wp_drawing_ifc_releases
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  for update;
  if found then
    update public.forge_wp_drawing_ifc_releases
    set retired_at = now(),
        retired_by = v_actor_id,
        version = version + 1
    where owner_id = p_owner_id and id = v_prior_release.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_prior_release.review_id, p_drawing_id, v_actor_id,
      'IFC_RELEASE_RETIRED', 'ACTIVE', 'RETIRED',
      jsonb_build_object('release_id', v_prior_release.id, 'reason', p_reason)
    );
  end if;

  v_release_id := 'forge_wpdifc_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_wp_drawing_ifc_releases (
    owner_id, id, package_id, drawing_id, ifc_revision_id, review_id, released_by
  ) values (
    p_owner_id, v_release_id, p_package_id, p_drawing_id,
    v_ifc_revision_id, p_review_id, v_actor_id
  );

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    p_package_id, p_review_id, p_drawing_id, v_actor_id,
    'IFC_RELEASED', v_review.state, 'IFC',
    jsonb_build_object(
      'release_id', v_release_id,
      'ifc_revision_id', v_ifc_revision_id,
      'ifc_revision_code', btrim(p_ifc_revision_code),
      'reason', p_reason)
  );

  return query
    select *
    from public.forge_wp_drawing_ifc_releases
    where owner_id = p_owner_id and id = v_release_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_field_redline_create
-- Capture one field hand-redline as immutable evidence. The artifact
-- reference + SHA-256 bind the capture to the exact scan/photo/PDF;
-- the capture never modifies, replaces or approves the controlled
-- file and never converts IFA to IFC. It stays
-- HISTORICAL_PENDING_RECONCILIATION until a drafter-issued corrected
-- revision reconciles it (see the reconcile RPC).
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_field_redline_create(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_drawing_revision_id text,
  p_artifact_ref text,
  p_sha256 text,
  p_field_reason text,
  p_review_id text default null
)
returns setof public.forge_wp_drawing_field_redlines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_status text;
  v_drawing public.forge_work_drawings%rowtype;
  v_revision public.forge_wp_drawing_revisions%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_field_id text;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_artifact_ref is null or btrim(p_artifact_ref) = ''
     or char_length(p_artifact_ref) > 1000 then
    raise exception 'WPP7_INVALID_DOCUMENT_REF';
  end if;
  if p_sha256 is null or p_sha256 !~ '^[0-9a-fA-F]{64}$' then
    raise exception 'WPP7_INVALID_SHA256';
  end if;
  if p_field_reason is null or btrim(p_field_reason) = ''
     or char_length(p_field_reason) > 1000 then
    raise exception 'WPP7_REASON_REQUIRED';
  end if;

  select status into v_status
  from public.forge_work_packages
  where owner_id = p_owner_id and id = p_package_id;
  if not found then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;
  if v_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP7_PACKAGE_TERMINAL';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  select * into v_revision
  from public.forge_wp_drawing_revisions
  where owner_id = p_owner_id and package_id = p_package_id
    and drawing_id = p_drawing_id and id = p_drawing_revision_id;
  if not found then
    raise exception 'WPP7_REVISION_NOT_FOUND';
  end if;
  if v_revision.retired_at is not null then
    raise exception 'WPP7_REVISION_RETIRED';
  end if;

  if p_review_id is not null then
    select * into v_review
    from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and id = p_review_id;
    if not found or v_review.package_id <> p_package_id or v_review.drawing_id <> p_drawing_id then
      raise exception 'WPP7_REVIEW_NOT_FOUND';
    end if;
  end if;

  v_field_id := 'forge_wpdfr_' || replace(gen_random_uuid()::text, '-', '');
  insert into public.forge_wp_drawing_field_redlines (
    owner_id, id, package_id, drawing_id, drawing_revision_id, review_id,
    artifact_ref, sha256, captured_by, field_reason
  ) values (
    p_owner_id, v_field_id, p_package_id, p_drawing_id,
    p_drawing_revision_id, p_review_id,
    btrim(p_artifact_ref), lower(p_sha256), v_actor_id, btrim(p_field_reason)
  );

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    p_package_id, p_review_id, p_drawing_id, v_actor_id,
    'FIELD_REDLINE_CAPTURED', null, 'HISTORICAL_PENDING_RECONCILIATION',
    jsonb_build_object('field_redline_id', v_field_id, 'revision_id', p_drawing_revision_id)
  );

  return query
    select *
    from public.forge_wp_drawing_field_redlines
    where owner_id = p_owner_id and id = v_field_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_field_redline_reconcile
-- Link a drafter-issued corrected revision to a pending field
-- hand-redline. The evidence artifact is retained — reconciliation
-- records the link, it never replaces or deletes the capture.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_field_redline_reconcile(
  p_owner_id text,
  p_field_redline_id text,
  p_reconciled_revision_id text,
  p_reason text default null
)
returns setof public.forge_wp_drawing_field_redlines
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_field public.forge_wp_drawing_field_redlines%rowtype;
  v_revision public.forge_wp_drawing_revisions%rowtype;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is not null and char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_TOO_LONG';
  end if;

  select * into v_field
  from public.forge_wp_drawing_field_redlines
  where owner_id = p_owner_id and id = p_field_redline_id
  for update;
  if not found then
    raise exception 'WPP7_FIELD_REDLINE_NOT_FOUND';
  end if;
  if v_field.record_state <> 'HISTORICAL_PENDING_RECONCILIATION' then
    raise exception 'WPP7_FIELD_REDLINE_STATE';
  end if;
  if v_field.retired_at is not null then
    raise exception 'WPP7_FIELD_REDLINE_RETIRED';
  end if;

  select * into v_revision
  from public.forge_wp_drawing_revisions
  where owner_id = p_owner_id and package_id = v_field.package_id
    and drawing_id = v_field.drawing_id and id = p_reconciled_revision_id;
  if not found then
    raise exception 'WPP7_REVISION_NOT_FOUND';
  end if;
  if v_revision.retired_at is not null then
    raise exception 'WPP7_REVISION_RETIRED';
  end if;
  if p_reconciled_revision_id = v_field.drawing_revision_id then
    raise exception 'WPP7_SAME_REVISION';
  end if;

  update public.forge_wp_drawing_field_redlines
  set record_state = 'RECONCILED',
      reconciled_revision_id = p_reconciled_revision_id,
      version = version + 1
  where owner_id = p_owner_id and id = p_field_redline_id;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    v_field.package_id, v_field.review_id, v_field.drawing_id, v_actor_id,
    'FIELD_REDLINE_RECONCILED', 'HISTORICAL_PENDING_RECONCILIATION', 'RECONCILED',
    jsonb_build_object(
      'field_redline_id', p_field_redline_id,
      'reconciled_revision_id', p_reconciled_revision_id,
      'reason', p_reason)
  );

  return query
    select *
    from public.forge_wp_drawing_field_redlines
    where owner_id = p_owner_id and id = p_field_redline_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_retire
-- Logically retire a drawing: set retired_at/by on the drawing row,
-- cancel every OPEN review of the drawing (audited), retire its ACTIVE
-- IFC release (kept on file), and record the DRAWING_RETIRED event.
-- Step-drawing links and permit annotations are LEFT ALONE — they
-- reference a row that still exists, and the UI shows "Retired
-- drawing" instead of disappearing (brief §6). A retired drawing
-- accepts no new review, revision, release or field redline.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_retire(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text,
  p_reason text
)
returns setof public.forge_work_drawings
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id text := auth.uid();
  v_drawing public.forge_work_drawings%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_release public.forge_wp_drawing_ifc_releases%rowtype;
begin
  if v_actor_id is null then
    raise exception 'WPP7_INVALID_ACTOR';
  end if;
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if p_reason is null or btrim(p_reason) = '' or char_length(p_reason) > 1000 then
    raise exception 'WPP7_REASON_REQUIRED';
  end if;

  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;

  select * into v_drawing
  from public.forge_work_drawings
  where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
  for update;
  if not found then
    raise exception 'WPP7_DRAWING_NOT_FOUND';
  end if;
  if v_drawing.retired_at is not null then
    raise exception 'WPP7_DRAWING_RETIRED';
  end if;

  for v_review in
    select * from public.forge_wp_drawing_reviews
    where owner_id = p_owner_id and drawing_id = p_drawing_id and state = 'OPEN'
    order by opened_at asc
    for update
  loop
    update public.forge_wp_drawing_reviews
    set state = 'CANCELLED',
        closed_by = v_actor_id,
        closed_at = now(),
        decision_reason = 'Drawing retired.',
        version = version + 1
    where owner_id = p_owner_id and id = v_review.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_review.id, p_drawing_id, v_actor_id,
      'REVIEW_CANCELLED', 'OPEN', 'CANCELLED',
      jsonb_build_object('reason', p_reason)
    );
  end loop;

  select * into v_release
  from public.forge_wp_drawing_ifc_releases
  where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
  for update;
  if found then
    update public.forge_wp_drawing_ifc_releases
    set retired_at = now(),
        retired_by = v_actor_id,
        version = version + 1
    where owner_id = p_owner_id and id = v_release.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, v_release.review_id, p_drawing_id, v_actor_id,
      'IFC_RELEASE_RETIRED', 'ACTIVE', 'RETIRED',
      jsonb_build_object('release_id', v_release.id, 'reason', p_reason)
    );
  end if;

  update public.forge_work_drawings
  set retired_at = now(),
      retired_by = v_actor_id
  where owner_id = p_owner_id and id = p_drawing_id;

  insert into public.forge_wp_drawing_review_events (
    owner_id, id, package_id, review_id, drawing_id, actor_id,
    event_type, before_state, after_state, payload_minimal
  ) values (
    p_owner_id,
    'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
    p_package_id, null, p_drawing_id, v_actor_id,
    'DRAWING_RETIRED', null, 'RETIRED',
    jsonb_build_object('reason', p_reason)
  );

  return query
    select *
    from public.forge_work_drawings
    where owner_id = p_owner_id and id = p_drawing_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- RPC: forge_wp_drawing_readiness_snapshot
-- The whole package's drawing readiness in ONE statement (one
-- snapshot): every drawing with its latest non-retired revision, its
-- latest review, its ACTIVE IFC release (if any), and its open
-- REQUIRED redline count, plus package counts. SECURITY INVOKER so the
-- caller's RLS policies apply to every table read; STABLE because it
-- only reads. The badge rules here must agree with
-- deriveDrawingReadiness in src/domains/work-management/
-- drawingReviews.js (the domain module is the UI's source of truth;
-- the migration tests assert both on the same fixtures):
--   retired drawing            -> "Retired"
--   ACTIVE IFC release         -> "IFC — Issued for construction"
--   latest review OPEN         -> "IFA — In review"
--   latest review RETURNED     -> "IFA — Returned to drafter"
--   latest review APPROVED(*)  -> "IFA — Approved; IFC not issued"
--   latest review CANCELLED /
--   revision, no review        -> "IFA — Awaiting review"
--   no revision at all         -> "No issued revision"
-- A drawing is construction-usable ONLY when an ACTIVE release exists.
-- A cancelled/verified_closed package is reported with its status;
-- its reviews are nonactionable through the read model (brief §6 —
-- no package-transition code is touched in this slice), and every
-- write RPC above refuses terminal packages.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_readiness_snapshot(
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
    raise exception 'WPP7_WORKSPACE_FORBIDDEN';
  end if;
  if not exists (
    select 1 from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ) then
    raise exception 'WPP7_PACKAGE_NOT_FOUND';
  end if;

  with package_row as (
    select status from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
  ),
  drawings as (
    select d.id, d.drawing_number, d.drawing_type, d.title, d.retired_at
    from public.forge_work_drawings d
    where d.owner_id = p_owner_id and d.package_id = p_package_id
  ),
  latest_revision as (
    select distinct on (r.drawing_id)
      r.drawing_id, r.id as revision_id, r.revision_code, r.issued_as,
      r.document_ref, r.content_sha256, r.issued_at
    from public.forge_wp_drawing_revisions r
    where r.owner_id = p_owner_id and r.retired_at is null
    order by r.drawing_id, r.created_at desc, r.id desc
  ),
  latest_review as (
    select distinct on (v.drawing_id)
      v.drawing_id, v.id as review_id, v.round_no, v.state,
      v.opened_at, v.closed_at, v.decision_reason
    from public.forge_wp_drawing_reviews v
    where v.owner_id = p_owner_id
    order by v.drawing_id, v.opened_at desc, v.id desc
  ),
  active_release as (
    select rel.drawing_id, rel.id as release_id, rel.ifc_revision_id,
           rel.review_id as release_review_id, rel.released_at
    from public.forge_wp_drawing_ifc_releases rel
    where rel.owner_id = p_owner_id and rel.retired_at is null
  ),
  open_required as (
    select v.drawing_id, count(*)::integer as open_required_redlines
    from public.forge_wp_drawing_redlines rl
    join public.forge_wp_drawing_reviews v
      on v.owner_id = rl.owner_id and v.id = rl.review_id
    where rl.owner_id = p_owner_id
      and rl.resolution = 'OPEN' and rl.severity = 'REQUIRED' and rl.retired_at is null
      and v.state = 'OPEN'
    group by v.drawing_id
  ),
  pending_field as (
    select f.drawing_id, count(*)::integer as pending_field_redlines
    from public.forge_wp_drawing_field_redlines f
    where f.owner_id = p_owner_id
      and f.record_state = 'HISTORICAL_PENDING_RECONCILIATION' and f.retired_at is null
    group by f.drawing_id
  ),
  enriched as (
    select
      d.id as drawing_id,
      d.drawing_number,
      d.drawing_type,
      d.title,
      d.retired_at,
      lr.revision_id as latest_revision_id,
      lr.revision_code as latest_revision_code,
      lr.issued_as as latest_issued_as,
      lr.document_ref as latest_document_ref,
      lr.content_sha256 as latest_content_sha256,
      lr.issued_at as latest_issued_at,
      lv.review_id as latest_review_id,
      lv.round_no as latest_review_round_no,
      lv.state as latest_review_state,
      lv.opened_at as latest_review_opened_at,
      lv.closed_at as latest_review_closed_at,
      lv.decision_reason as latest_review_decision_reason,
      ar.release_id as active_release_id,
      ar.ifc_revision_id as active_ifc_revision_id,
      ar.release_review_id as active_release_review_id,
      ar.released_at as active_release_released_at,
      coalesce(oqr.open_required_redlines, 0) as open_required_redlines,
      coalesce(pf.pending_field_redlines, 0) as pending_field_redlines,
      case
        when d.retired_at is not null then 'Retired'
        -- A terminal package withdraws every drawing it holds: an
        -- ACTIVE release no longer authorizes construction, and an
        -- IFA round no longer awaits review. A drawing with no
        -- revision at all keeps its own state (nothing to withdraw).
        when pr.status in ('cancelled', 'verified_closed') and lr.revision_id is not null then
          case when pr.status = 'cancelled' then 'Withdrawn — package cancelled'
               else 'Withdrawn — package verified closed' end
        when ar.release_id is not null then 'IFC — Issued for construction'
        when lv.state = 'OPEN' then 'IFA — In review'
        when lv.state = 'RETURNED' then 'IFA — Returned to drafter'
        when lv.state in ('APPROVED', 'APPROVED_WITH_REDLINES') then 'IFA — Approved; IFC not issued'
        when lr.revision_id is not null then 'IFA — Awaiting review'
        else 'No issued revision'
      end as badge,
      (ar.release_id is not null
        and pr.status not in ('cancelled', 'verified_closed')) as construction_usable,
      -- Preliminary = an IFA drawing that is not retired, not
      -- released IFC, and not withdrawn with its package. The
      -- progress history shows this as a PRE-IFC flag (display only).
      (d.retired_at is null
        and ar.release_id is null
        and pr.status not in ('cancelled', 'verified_closed')
        and lr.revision_id is not null) as preliminary
    from drawings d
    cross join package_row pr
    left join latest_revision lr on lr.drawing_id = d.id
    left join latest_review lv on lv.drawing_id = d.id
    left join active_release ar on ar.drawing_id = d.id
    left join open_required oqr on oqr.drawing_id = d.id
    left join pending_field pf on pf.drawing_id = d.id
  )
  select jsonb_build_object(
    'packageId', p_package_id,
    'packageStatus', (select status from package_row),
    'drawings', coalesce(
      (select jsonb_agg(to_jsonb(e) order by e.drawing_type, e.drawing_number) from enriched e),
      '[]'::jsonb),
    'counts', jsonb_build_object(
      'drawingsTotal', (select count(*) from enriched),
      'ifcReleased', (select count(*) from enriched where construction_usable),
      'pendingReview', (select count(*) from enriched
        where badge in ('IFA — In review', 'IFA — Awaiting review')),
      'returned', (select count(*) from enriched where badge = 'IFA — Returned to drafter'),
      'openRequiredRedlines', (select coalesce(sum(open_required_redlines), 0) from enriched),
      'pendingFieldRedlines', (select coalesce(sum(pending_field_redlines), 0) from enriched))
  ) into v_result;
  return v_result;
end;
$$;

-- ---------------------------------------------------------------------------
-- Trigger: forge_wp_drawing_package_terminal
-- Cancelling or verifying-closed a package coordinates with slice 7
-- in the SAME transaction as the status change (the transition RPC
-- locks the package row first, so a concurrent IFC release serializes
-- against it): every ACTIVE IFC release of the package's drawings is
-- retired and every OPEN review is cancelled, each with its own
-- auditable event, and the reason names the terminal state. History
-- is retained — releases and rounds stay on file, only their state
-- changes. Reopening a cancelled package (cancelled -> draft) does
-- NOT restore releases or rounds: a reopened package must re-issue
-- IFC through a fresh approved review.
--
-- The actor is the JWT caller when present (the transition RPC runs
-- with the caller's JWT set); a direct service update with no JWT
-- records 'system'. The function is SECURITY DEFINER with
-- row_security off so the FORCED-RLS tables accept its writes, and
-- it runs as the migration owner (postgres in production), which is
-- why the trigger fires identically for transition-RPC updates and
-- direct SQL updates.
-- ---------------------------------------------------------------------------

create or replace function public.forge_wp_drawing_on_package_terminal()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  -- auth.uid() is a uuid or null (never an empty string), so a plain
  -- text cast is the correct fallback shape.
  v_actor_id text := coalesce(auth.uid()::text, 'system');
  v_reason text;
  v_release public.forge_wp_drawing_ifc_releases%rowtype;
  v_review public.forge_wp_drawing_reviews%rowtype;
begin
  if new.status = 'cancelled' then
    v_reason := 'Package cancelled.';
  else
    v_reason := 'Package verified closed.';
  end if;

  for v_release in
    select *
    from public.forge_wp_drawing_ifc_releases
    where owner_id = new.owner_id and package_id = new.id and retired_at is null
    order by released_at, id
  loop
    update public.forge_wp_drawing_ifc_releases
    set retired_at = now(), retired_by = v_actor_id
    where owner_id = new.owner_id and id = v_release.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      new.owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      new.id, v_release.review_id, v_release.drawing_id, v_actor_id,
      'IFC_RELEASE_RETIRED', 'ACTIVE', 'RETIRED',
      jsonb_build_object('release_id', v_release.id, 'reason', v_reason)
    );
  end loop;

  for v_review in
    select *
    from public.forge_wp_drawing_reviews
    where owner_id = new.owner_id and package_id = new.id and state = 'OPEN'
    order by opened_at, id
  loop
    update public.forge_wp_drawing_reviews
    set state = 'CANCELLED',
        closed_by = v_actor_id,
        closed_at = now(),
        decision_reason = v_reason,
        version = version + 1
    where owner_id = new.owner_id and id = v_review.id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      new.owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      new.id, v_review.id, v_review.drawing_id, v_actor_id,
      'REVIEW_CANCELLED', 'OPEN', 'CANCELLED',
      jsonb_build_object('reason', v_reason)
    );
  end loop;

  return new;
end;
$$;

drop trigger if exists forge_wp_drawing_package_terminal on public.forge_work_packages;
create trigger forge_wp_drawing_package_terminal
  after update of status on public.forge_work_packages
  for each row
  when (new.status in ('cancelled', 'verified_closed')
        and old.status not in ('cancelled', 'verified_closed'))
  execute function public.forge_wp_drawing_on_package_terminal();

-- ---------------------------------------------------------------------------
-- Function grants: no default PUBLIC EXECUTE on new functions (Supabase
-- defaults re-grant it — revoked here explicitly), EXECUTE only where
-- the app needs it. The snapshot RPC is a read, but PostgREST still
-- needs EXECUTE on it; its SECURITY INVOKER body enforces the
-- caller's RLS. The delete RPC's grants are restated here (they are
-- unchanged by the CREATE OR REPLACE above, but the restatement keeps
-- the effective posture visible in this file).
-- ---------------------------------------------------------------------------

revoke all on function public.forge_wp_drawing_revision_create(text, text, text, text, text, text) from public;
revoke all on function public.forge_wp_drawing_review_create(text, text, text, text, text, text, text) from public;
revoke all on function public.forge_wp_drawing_redline_create(text, text, text, text, text, text, integer, numeric, numeric, text, text) from public;
revoke all on function public.forge_wp_drawing_redline_resolve(text, text, integer, text, text, boolean, text) from public;
revoke all on function public.forge_wp_drawing_review_decide(text, text, integer, text, text) from public;
revoke all on function public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text) from public;
revoke all on function public.forge_wp_drawing_field_redline_create(text, text, text, text, text, text, text, text) from public;
revoke all on function public.forge_wp_drawing_field_redline_reconcile(text, text, text, text) from public;
revoke all on function public.forge_wp_drawing_retire(text, text, text, text) from public;
revoke all on function public.forge_wp_drawing_readiness_snapshot(text, text) from public;

-- Belt and braces against DIRECT default grants: a REVOKE from
-- PUBLIC does not remove a privilege granted directly to a named
-- role, and Supabase's default privileges grant EXECUTE on new
-- functions to anon. anon and service_role are explicitly revoked
-- EXECUTE on every function, so the effective posture is
-- authenticated-only even if the PUBLIC revoke is ever bypassed.
-- (The migration test proves this with has_function_privilege for
-- authenticated / anon / service_role / PUBLIC on all ten.)
revoke execute on function public.forge_wp_drawing_revision_create(text, text, text, text, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_review_create(text, text, text, text, text, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_redline_create(text, text, text, text, text, text, integer, numeric, numeric, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_redline_resolve(text, text, integer, text, text, boolean, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_review_decide(text, text, integer, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_field_redline_create(text, text, text, text, text, text, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_field_redline_reconcile(text, text, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_retire(text, text, text, text) from anon, service_role;
revoke execute on function public.forge_wp_drawing_readiness_snapshot(text, text) from anon, service_role;

grant execute on function public.forge_wp_drawing_revision_create(text, text, text, text, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_review_create(text, text, text, text, text, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_redline_create(text, text, text, text, text, text, integer, numeric, numeric, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_redline_resolve(text, text, integer, text, text, boolean, text) to authenticated;
grant execute on function public.forge_wp_drawing_review_decide(text, text, integer, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_ifc_release(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_field_redline_create(text, text, text, text, text, text, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_field_redline_reconcile(text, text, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_retire(text, text, text, text) to authenticated;
grant execute on function public.forge_wp_drawing_readiness_snapshot(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- RPC replacement: forge_work_permit_annotation_delete_drawing
-- Slice 7 extends slice 5's replacement (which itself extended slice
-- 3's): a drawing WITH slice-7 review history is logically retired in
-- the same transaction (open reviews cancelled, ACTIVE IFC release
-- retired, DRAWING_RETIRED event recorded) instead of physically
-- deleted. A drawing with NO slice-7 history keeps the exact slice-5
-- behavior below (annotation + step-link retirement, then DELETE).
-- The slice-5 body is reproduced verbatim apart from the two added
-- declarations and the slice-7 branch above the HAS_CHILDREN guard.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_permit_annotation_delete_drawing(
  p_owner_id text,
  p_package_id text,
  p_drawing_id text
)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_drawing public.forge_work_drawings%rowtype;
  v_actor text;
  v_annotation public.forge_work_permit_annotations%rowtype;
  v_retired_at timestamptz;
  v_retired_by text;
  v_old_version integer;
  v_link public.forge_work_step_drawing_links%rowtype;
  v_link_retired_at timestamptz;
  v_link_retired_by text;
  v_link_old_version integer;
  v_review public.forge_wp_drawing_reviews%rowtype;
  v_release public.forge_wp_drawing_ifc_releases%rowtype;
begin
  if not public.has_workspace_access(p_owner_id) then
    raise exception 'WPP3_WORKSPACE_FORBIDDEN';
  end if;
  -- The audit actor is the authenticated caller, never a parameter.
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP3_INVALID_ACTOR';
  end if;
  if not exists (select 1 from public.forge_work_packages
                 where owner_id = p_owner_id and id = p_package_id) then
    raise exception 'WPP3_PACKAGE_NOT_FOUND';
  end if;
  -- Row lock: a concurrent annotation create on this drawing
  -- serializes here, so it either lands before the delete (and is
  -- retired below) or fails against the deleted drawing after it.
  select * into v_drawing from public.forge_work_drawings
    where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id
    for update;
  if not found then
    raise exception 'WPP3_DRAWING_NOT_FOUND';
  end if;

  -- Slice 7: a drawing with any review history (an issued revision
  -- exists) is a controlled document with an audit trail — it is
  -- RETIRED, never physically deleted, so its rounds, redlines,
  -- releases and field-redline evidence stay on file. The physical
  -- delete below runs only for drawings with no slice-7 history.
  -- This branch skips the HAS_CHILDREN / HAS_LINES guards below:
  -- those guard a physical row delete, and nothing is deleted here.
  -- Step links and permit annotations are left alone — they reference
  -- a row that still exists, and the UI shows "Retired drawing"
  -- instead of disappearing (brief §6). The service distinguishes
  -- retired from deleted by re-reading the drawing row after the call.
  if exists (select 1 from public.forge_wp_drawing_revisions
             where owner_id = p_owner_id and drawing_id = p_drawing_id) then
    if v_drawing.retired_at is not null then
      raise exception 'WPP7_DRAWING_RETIRED';
    end if;

    for v_review in
      select * from public.forge_wp_drawing_reviews
      where owner_id = p_owner_id and drawing_id = p_drawing_id and state = 'OPEN'
      order by opened_at asc
      for update
    loop
      update public.forge_wp_drawing_reviews
      set state = 'CANCELLED',
          closed_by = v_actor,
          closed_at = now(),
          decision_reason = 'Drawing retired.',
          version = version + 1
      where owner_id = p_owner_id and id = v_review.id;

      insert into public.forge_wp_drawing_review_events (
        owner_id, id, package_id, review_id, drawing_id, actor_id,
        event_type, before_state, after_state, payload_minimal
      ) values (
        p_owner_id,
        'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
        p_package_id, v_review.id, p_drawing_id, v_actor,
        'REVIEW_CANCELLED', 'OPEN', 'CANCELLED',
        jsonb_build_object('reason', 'Drawing retired.')
      );
    end loop;

    select * into v_release
    from public.forge_wp_drawing_ifc_releases
    where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
    for update;
    if found then
      update public.forge_wp_drawing_ifc_releases
      set retired_at = now(),
          retired_by = v_actor,
          version = version + 1
      where owner_id = p_owner_id and id = v_release.id;

      insert into public.forge_wp_drawing_review_events (
        owner_id, id, package_id, review_id, drawing_id, actor_id,
        event_type, before_state, after_state, payload_minimal
      ) values (
        p_owner_id,
        'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
        p_package_id, v_release.review_id, p_drawing_id, v_actor,
        'IFC_RELEASE_RETIRED', 'ACTIVE', 'RETIRED',
        jsonb_build_object('release_id', v_release.id, 'reason', 'Drawing retired.')
      );
    end if;

    update public.forge_work_drawings
    set retired_at = now(),
        retired_by = v_actor
    where owner_id = p_owner_id and id = p_drawing_id;

    insert into public.forge_wp_drawing_review_events (
      owner_id, id, package_id, review_id, drawing_id, actor_id,
      event_type, before_state, after_state, payload_minimal
    ) values (
      p_owner_id,
      'forge_wpdre_' || replace(gen_random_uuid()::text, '-', ''),
      p_package_id, null, p_drawing_id, v_actor,
      'DRAWING_RETIRED', null, 'RETIRED',
      jsonb_build_object('reason', 'Drawing retired.')
    );

    return true;
  end if;

  if exists (select 1 from public.forge_work_drawings
             where owner_id = p_owner_id and p_id_drawing_id = p_drawing_id) then
    raise exception 'WPP3_DRAWING_HAS_CHILDREN';
  end if;
  if exists (select 1 from public.forge_work_takeoff_lines
             where owner_id = p_owner_id and drawing_id = p_drawing_id) then
    raise exception 'WPP3_DRAWING_HAS_LINES';
  end if;

  -- Retire every active annotation on this drawing, with one
  -- parent_drawing_deleted revision each, in this same transaction.
  -- Package-level annotations are untouched. The live drawing id is
  -- nulled (the drawing row is about to be gone); original_drawing_id
  -- is kept, so history still names the drawing.
  for v_annotation in
    select * from public.forge_work_permit_annotations
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
      order by created_at asc
      for update
  loop
    update public.forge_work_permit_annotations
      set retired_at = now(),
          retired_by = v_actor,
          drawing_id = null,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = v_annotation.id
      returning * into v_annotation;

    insert into public.forge_work_permit_annotation_revisions
      (owner_id, id, annotation_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, v_annotation.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'target_kind', 'drawing',
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', null::timestamptz,
         'retired_by', null::text,
         'version', v_annotation.version - 1),
       jsonb_build_object(
         'target_kind', v_annotation.target_kind,
         'drawing_id', v_annotation.drawing_id,
         'original_drawing_id', v_annotation.original_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', v_annotation.retired_at,
         'retired_by', v_annotation.retired_by,
         'version', v_annotation.version),
       'Parent drawing deleted.', now());
  end loop;

  -- Detach annotations already retired before this delete: they
  -- still hold the restrictive FK on the drawing row, so the final
  -- DELETE below would fail on them. Their retirement stands
  -- (retired_at/retired_by unchanged); only the live drawing id is
  -- cleared, and the detachment is recorded with a
  -- parent_drawing_deleted revision, like the active retirements
  -- above. The version bump is required: the revision's version must
  -- stay unique per annotation.
  for v_annotation in
    select * from public.forge_work_permit_annotations
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is not null
      order by created_at asc
      for update
  loop
    v_retired_at := v_annotation.retired_at;
    v_retired_by := v_annotation.retired_by;
    v_old_version := v_annotation.version;

    update public.forge_work_permit_annotations
      set drawing_id = null,
          version = version + 1,
          updated_by = v_actor,
          updated_at = now()
      where owner_id = p_owner_id and id = v_annotation.id
      returning * into v_annotation;

    insert into public.forge_work_permit_annotation_revisions
      (owner_id, id, annotation_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wppr_' || gen_random_uuid(), v_annotation.id, v_annotation.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'target_kind', 'drawing',
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', v_retired_at,
         'retired_by', v_retired_by,
         'version', v_old_version),
       jsonb_build_object(
         'target_kind', v_annotation.target_kind,
         'drawing_id', v_annotation.drawing_id,
         'original_drawing_id', v_annotation.original_drawing_id,
         'label', v_annotation.label,
         'url', v_annotation.url,
         'permit_reference', v_annotation.permit_reference,
         'note', v_annotation.note,
         'retired_at', v_annotation.retired_at,
         'retired_by', v_annotation.retired_by,
         'version', v_annotation.version),
       'Parent drawing deleted.', now());
  end loop;

  -- Slice 5: retire every active step-drawing link on this drawing,
  -- with one parent_drawing_deleted link revision each, in this same
  -- transaction. The live drawing id is nulled; original_drawing_id
  -- is kept, so link history still names the drawing. Links on other
  -- drawings are untouched.
  for v_link in
    select * from public.forge_work_step_drawing_links
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is null
      order by created_at asc
      for update
  loop
    update public.forge_work_step_drawing_links
      set retired_at = now(),
          retired_by = v_actor,
          drawing_id = null,
          version = version + 1
      where owner_id = p_owner_id and id = v_link.id
      returning * into v_link;

    insert into public.forge_work_step_drawing_link_revisions
      (owner_id, id, link_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', null::timestamptz,
         'retired_by', null::text,
         'version', v_link.version - 1),
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link.retired_at,
         'retired_by', v_link.retired_by,
         'version', v_link.version),
       'Parent drawing deleted.', now());
  end loop;

  -- Detach step links already retired before this delete: they still
  -- hold the restrictive FK on the drawing row, so the final DELETE
  -- below would fail on them. Their retirement stands; only the live
  -- drawing id is cleared, recorded the same way.
  for v_link in
    select * from public.forge_work_step_drawing_links
      where owner_id = p_owner_id and drawing_id = p_drawing_id and retired_at is not null
      order by created_at asc
      for update
  loop
    v_link_retired_at := v_link.retired_at;
    v_link_retired_by := v_link.retired_by;
    v_link_old_version := v_link.version;

    update public.forge_work_step_drawing_links
      set drawing_id = null,
          version = version + 1
      where owner_id = p_owner_id and id = v_link.id
      returning * into v_link;

    insert into public.forge_work_step_drawing_link_revisions
      (owner_id, id, link_id, version, actor_id, action,
       old_values, new_values, reason, recorded_at)
    values
      (p_owner_id, 'forge_wplr_' || gen_random_uuid(), v_link.id, v_link.version, v_actor,
       'parent_drawing_deleted',
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', p_drawing_id,
         'original_drawing_id', p_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link_retired_at,
         'retired_by', v_link_retired_by,
         'version', v_link_old_version),
       jsonb_build_object(
         'step_id', v_link.step_id,
         'drawing_id', v_link.drawing_id,
         'original_drawing_id', v_link.original_drawing_id,
         'refinement_note', v_link.refinement_note,
         'retired_at', v_link.retired_at,
         'retired_by', v_link.retired_by,
         'version', v_link.version),
       'Parent drawing deleted.', now());
  end loop;

  delete from public.forge_work_drawings
    where owner_id = p_owner_id and package_id = p_package_id and id = p_drawing_id;
  return true;
end;
$$;

-- RPC execution: functions are executable by PUBLIC by default, so
-- revoke that first, then grant only to the authenticated application
-- role. The two internal helpers (order row + apply order) are
-- deliberately left without an authenticated EXECUTE grant: they are
-- internal to the RPCs, and direct callers get no new surface. (The
-- SECURITY DEFINER RPCs still call them: the definer's rights apply
-- inside the RPC, so the PUBLIC revoke does not block the trusted
-- write path.) The drawing-delete function keeps its slice-3 grant,
-- re-issued here explicitly.
revoke all on function public.forge_work_step_order_row(text, text) from public;
revoke all on function public.forge_work_step_apply_order(text, text, text[], text, text, text) from public;
revoke all on function public.forge_work_step_create(text, text, text, text, text, integer, numeric, text, text, integer, text) from public;
revoke all on function public.forge_work_step_update(text, text, integer, text, text, text, integer, numeric, text, boolean, boolean, boolean, boolean, boolean, boolean, text) from public;
revoke all on function public.forge_work_step_reorder(text, text, text[], integer, text) from public;
revoke all on function public.forge_work_step_move(text, text, text, integer, integer, text) from public;
revoke all on function public.forge_work_step_retire(text, text, integer, text, boolean) from public;
revoke all on function public.forge_work_step_link_drawing_create(text, text, text, text, text, text) from public;

revoke all on function public.forge_work_permit_annotation_delete_drawing(text, text, text) from public;
grant execute on function public.forge_work_permit_annotation_delete_drawing(text, text, text) to authenticated;
