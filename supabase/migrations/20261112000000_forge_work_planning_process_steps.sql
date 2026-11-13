-- FORGE Work Management — Work Package Planner, planning-process steps.
--
-- Scope: forge-ai-drop briefs/marketplace/work-package-planner-planning-process-steps-scope-2026-11-10.md
-- (Jason's word, Nov 10: "start from scratch and use this document for the
-- basis of building work package planner"). Source of truth is Josh Morgan's
-- Packaged Planning Process PDF (PAR TAR PLANNING PROCESS, issued for review
-- 04-20-2024) ONLY: 22 numbered planning steps, 11 weighted earning
-- progress (credits sum 100%, 40 MHRS standard), 11 reporting-only at
-- 0%/0h, five word statuses, complexity scale Low 75% / Standard 100% /
-- Mid 150% / High 200% / H-High 300%. The GUIDANCE 21-step list and the KR
-- 20-step rollup are REFERENCE ONLY and were NOT used here (different step
-- counts, weights, owners).
--
-- Scope-review verdict (ChatGPT, 2026-11-12, drop babaaaa1 — NEEDS CHANGES,
-- core model accepted): this migration is SLICE A (canonical model +
-- checklist). The verdict's blocking corrections F1–F4 are applied here:
--   F1: planningPercent / earnedPlanningHours are kept strictly separate
--      from constructionReadiness. The checklist RPC returns
--      constructionReadiness { status: 'not_established' } — no
--      package-level release decision exists in this slice, and no
--      release API is invented. 100% planning NEVER implies
--      ready-for-construction or IFC released; a Complete on the IFC
--      step is planning progress only. The existing IFA→IFC
--      immutable-revision workflow is untouched.
--   F2: server-enforced status authority, evidence and transitions.
--      Actor/workspace/package/permission are derived server-side
--      (auth.uid() + has_workspace_access / has_planner_permission);
--      nothing browser-supplied (updatedBy/reviewedBy/role/earned
--      value) is trusted. Transition/authority matrix (fix round 1):
--      In-Progress/Complete need planner.planning_steps.update;
--      N/A, Reviewed and Needs Revision need
--      planner.planning_steps.review (owner/co-owner pass every gate).
--      Reviewed only from a distinct prior submission (Complete or
--      N/A by another actor, with existing qualifying evidence or
--      attestation); no new evidence/attestation in the same review
--      decision except an owner/co-owner reasoned override. A Reviewed
--      row may only go back through Needs Revision by review
--      authority; returning from Needs Revision is two-step
--      (resubmit Complete with fresh evidence, then a different
--      reviewer marks Reviewed). N/A needs a nonempty reason plus an
--      authorized confirmation. Needs Revision needs a reason plus
--      reviewer attribution (Reviewer role CAN record it; ordinary
--      Planner role must NOT). Complete needs an evidence reference
--      or a bounded completion attestation, validated against the
--      EFFECTIVE post-update evidence value (an explicit clear is not
--      evidence). Needs Revision revokes earned credit immediately
--      (computed — it earns zero). History is append-only with
--      before/after status, actor, reason, evidence digest/reference,
--      UTC time and request ID. Status update + event append happen in
--      one transaction; expected version (mandatory) and request ID
--      (mandatory, bounded; reuse with a different payload is a
--      conflict) are enforced — stale updates return 409. All rows
--      start In-Progress; there is no Pending state.
--   F3: immutable versioned template. 22 stable PDF step keys
--      (pdf-01 … pdf-22) with provenance, order, role, percent,
--      standard hours, description. Template version 1. A package
--      binds to a template version at creation (planning_template_version
--      on the package row) and an AFTER INSERT trigger creates exactly
--      22 instance rows in the SAME transaction — package creation
--      rolls back if initialization fails. The checklist RPC is
--      READ-ONLY: it validates and returns the existing complete set
--      and fails unavailable on missing/duplicate rows; it never
--      mutates on GET. Existing packages get an idempotent
--      owner/package/template-scoped backfill in this migration.
--      Weights must sum 100 and hours 40 BEFORE instantiation, and
--      progress is computed against the fixed denominator 100. Fail
--      closed on a missing/duplicated row. New template versions are
--      new versions; migrating a package needs a separately reviewed
--      action (planning_template_version is CHECKed to 1 in this
--      slice).
--   F4: the dashboard "Weighted Value" is earned planning MHRS /
--      total planned planning MHRS (e.g. 20/40 MHRS at Standard for
--      50% earned) — never cost EV, construction EV or actual labor
--      hours. Dashboard wiring itself is SLICE B (separate PR after
--      this slice merges); this slice only exposes the read model
--      (percent + earned/total planning MHRS) and shows missing /
--      invalid packages as unavailable, never 0 or 100.
-- Decision 7 CORRECTION (verdict ruling): the 5 Scope Package
-- Development items go in a SEPARATE pre-package/scoping section as
-- unweighted auditable items — they are NOT a "Phase 0" of this
-- checklist, not steps 23–27, and do not change the 100% denominator
-- or the 40-MHRS standard. They are NOT seeded here; the scoping
-- section is follow-up work, recorded in the build report.
--
-- Fix round 2 (ChatGPT re-review, 2026-11-12 — NEEDS CHANGES, F1–F5
-- CLOSED, two new P1s, both fixed here):
--   P1-A: a combined-form save (complexity + unrelated fields) was
--      two transactions — the complexity RPC committed first, then
--      the generic package UPDATE could still fail on property
--      resolution/validation/version, leaving complexity changed and
--      the version advanced while the save reported failure. New
--      RPC forge_work_planning_process_update_package applies the
--      field updates AND the complexity change AND the
--      complexity_change audit event in ONE transaction (any failure
--      rolls all of it back); updateWorkPackage routes every save
--      that carries a complexity change through it, after resolving
--      the property and validating the merged candidate before any
--      write. Saves with no complexity change keep the existing
--      single generic UPDATE (already one transaction) and never
--      call this RPC. Complexity/budget RPCs bump version; plain
--      edits do not — unchanged.
--   P1-B: set-status idempotency derived the effective evidence
--      from the row's CURRENT stored link before the idempotency
--      check, so replaying the original request after an intervening
--      evidence change falsely raised WPP10_REQUEST_ID_CONFLICT.
--      Idempotency now binds to the canonical original payload
--      (request_payload jsonb on the revision row): the caller's raw
--      inputs as supplied, including an explicit "evidence omitted"
--      mode distinct from an explicit clear and from a supplied
--      link. A same-key/same-payload retry replays after any
--      intervening evidence/status change; same key + different
--      raw payload conflicts.
--
-- What lands here:
--   1. forge_work_planning_process_template — the 22 checklist rows
--      seeded from the PDF, version 1, stable step keys pdf-01..pdf-22.
--      Shared reference data (no owner_id); credits are fixed from the
--      PDF, never edited per package.
--   2. forge_work_planning_process_instances — one row per package x
--      template step (exactly 22 per package): status, evidence link,
--      reviewer attribution, last-submitter tracking, row version.
--   3. forge_work_planning_process_revisions — append-only status-event
--      audit for the instances (F2 event contract). Each row also
--      carries request_payload jsonb — the canonical record of the
--      caller's original payload (fix round 2, P1-B) that set-status
--      idempotency compares against.
--   4. forge_work_packages.planning_complexity + planning_template_version
--      — per-package complexity (default Standard) and the bound
--      template version (1). MHRS per step is template MHRS x the
--      package multiplier, computed — never stored per step, never
--      overridden.
--   5. Three new planner capabilities (planner.planning_steps.read /
--      .update / .review), the starter-role provisioning function
--      updated to grant them, and a backfill for starter roles that
--      already exist.
--   6. RPCs: forge_work_planning_process_checklist (template
--      verification + the complete 22-row set, READ-ONLY — a
--      missing/duplicated set is unavailable, never auto-created)
--      and forge_work_planning_process_set_status (the only status
--      write path: F2 rules + revision in one transaction).
--   7. A SECURITY DEFINER trigger that creates the 22 checklist rows
--      atomically with the package row, plus an idempotent
--      owner/package/template-scoped backfill for existing packages.
--   8. RPC forge_work_planning_process_set_complexity — the only
--      complexity write path (expected version + request-id
--      idempotency; the complexity_change event is appended in the
--      same transaction). Complexity is no longer updated by a
--      client-side revisions insert or a generic package PATCH.
--   9. RPC forge_work_planning_process_update_package (fix round 2,
--      P1-A) — the single transaction for a combined save: the
--      requested field updates AND the complexity change AND the
--      complexity_change audit event commit or roll back together.
--      Called only by saves that carry a complexity change.
--
-- The existing free-form forge_work_steps table (slice 5) is untouched:
-- it stays the execution-step breakdown; these 22 are the *build*
-- checklist (planning gates, not execution work). Milestones (slice 9)
-- are execution gates; there is no overlap or double-counting — the
-- checklist never writes milestone state and milestones never read it.
-- A planning-step status cannot mutate an IFC drawing release, a
-- schedule milestone, craft assignments, actual progress or
-- construction authorization.
--
-- Migration discipline (Nov 4 / Nov 10 lessons): Supabase default
-- privileges grant ALL on newly created public tables, so every privilege
-- this migration does NOT intend is explicitly REVOKED below (template:
-- SELECT only for authenticated; instances/revisions: SELECT only for
-- authenticated; direct writes by any application role: denied — the
-- RPCs are the only write path). The post-apply effective-ACL receipt
-- is still mandatory before the migration gate counts complete — SQL
-- text alone is never proof. Table names were checked against the live
-- production schema before writing (no forge_work_planning_process_*
-- table exists there; forge_work_packages carries no planning_complexity
-- or planning_template_version column).
--
-- FILE ONLY in this PR. Do NOT apply to production without a merge +
-- Muse's GO (apply-on-GO standing rule, Jason 2026-11-10 ~14:03).
-- Migration number 20261112000000 confirmed as next free against main
-- 5fe750cb at build time (newest on main is 20261111010000).

-- ---------------------------------------------------------------------------
-- 1. Template table — shared reference data seeded from the PDF, version 1.
--    Immutable by design: a future template change creates a NEW version
--    (new rows), never an UPDATE of these rows; migrating a package to
--    a new version needs a separately reviewed action.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_work_planning_process_template (
  version integer not null check (version >= 1),
  step_key text not null
    check (char_length(btrim(step_key)) >= 1 and char_length(step_key) <= 32)
    check (step_key !~ '[[:cntrl:]]'),
  step_number integer not null check (step_number >= 1 and step_number <= 22),
  sort_order integer not null,
  name text not null
    check (char_length(btrim(name)) >= 1 and char_length(name) <= 120)
    check (name !~ '[[:cntrl:]]'),
  role text not null check (role in ('Planning', 'Operation')),
  credit_pct numeric(5, 2) not null check (credit_pct >= 0 and credit_pct <= 100),
  mhrs_standard numeric(6, 2) check (mhrs_standard is null or mhrs_standard > 0),
  description text not null
    check (char_length(btrim(description)) >= 1 and char_length(description) <= 1000)
    check (description !~ '[[:cntrl:]]'),
  provenance text not null
    check (char_length(btrim(provenance)) >= 1 and char_length(provenance) <= 200),
  primary key (version, step_key),
  unique (version, step_number),
  unique (version, sort_order),
  -- Reporting-only steps carry 0% / 0h; weighted steps carry both.
  check ((credit_pct = 0 and mhrs_standard is null)
      or (credit_pct > 0 and mhrs_standard is not null))
);

comment on table public.forge_work_planning_process_template is
  'Planning-process checklist template, versioned and immutable: 22 steps seeded from Josh Morgan''s Packaged Planning Process PDF (PAR TAR PLANNING PROCESS, 2024-04-20), version 1, stable step keys pdf-01..pdf-22. Credits (sum 100%) and standard MHRS (sum 40) are fixed from the PDF; per-package MHRS is template MHRS x the package complexity multiplier, computed, never stored. A future template change creates a new version, never an UPDATE of these rows.';

-- Seed: the 22 numbered steps, PDF order, version 1. Eleven weighted
-- (credits sum 100%, 40 MHRS standard); eleven reporting-only (0% / 0h).
insert into public.forge_work_planning_process_template
  (version, step_key, step_number, sort_order, name, role, credit_pct, mhrs_standard, description, provenance)
values
  (1, 'pdf-01', 1, 1, 'P & I.D. / MFD', 'Planning', 5, 2,
   'P&ID marked up by the planner to identify specific scope.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-02', 2, 2, 'Plot Plan', 'Planning', 5, 2,
   'Plot plan marked up with physical location and approximate elevation, for planning purposes only.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-03', 3, 3, 'Planning Photo''s', 'Planning', 5, 2,
   'Single scope item, photo marked up clearly; insulation removed to identify scope.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-04', 4, 4, 'Equip. Details/Dwgs', 'Planning', 10, 4,
   'Relevant data and drawings for the scope: specs, vendor data, cut sheet, pipe spec, existing ISOs.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-05', 5, 5, 'Inspection Requirements', 'Planning', 10, 4,
   'Inspection tab filled out as completely as possible; site inspection codes referenced.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-06', 6, 6, 'Engineering Request', 'Planning', 0, null,
   'Documentation gathered and submitted through the engineering request process; N/A if not required.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-07', 7, 7, 'I.F.C. Drawings', 'Planning', 10, 4,
   'Generated from the engineering request; planner attends drawing reviews (IFR, IFA, IFC) for constructibility, then uploads. A Complete here is planning progress only — it never authorizes construction or releases an IFC drawing.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-08', 8, 8, 'Work Blind List', 'Planning', 0, null,
   'Primary planner develops the initial blind list; contractor performs final review.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-09', 9, 9, 'Material B.O.M.', 'Planning', 10, 4,
   'Planner reviews and develops the initial list for long-lead identification and budgetary purposes; BOM submitted to Buyer.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-10', 10, 10, 'Material P.O.', 'Planning', 0, null,
   'Planner or stakeholder approves the material PR once vendor selected, deliverables accepted, quote approved; procurement tracking begins.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-11', 11, 11, 'Lifting Equipment', 'Planning', 10, 4,
   'Initial job walk completed; crane needs identified; planner and contractor agree; crane contractor walked the job if required.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-12', 12, 12, 'Scaffold Requisitions', 'Planning', 0, null,
   'Planner and contractor agree on scaffold needs; scaffold contractor walked the job and received a requisition.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-13', 13, 13, 'Planning Support', 'Planning', 0, null,
   'Compilation of miscellaneous data: insulation, abatement, steam trace, lead paint, crane needs.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-14', 14, 14, 'Safety Plan', 'Planning', 10, 4,
   'All hazards identified, mitigation developed and included in the execution plan.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-15', 15, 15, 'Job Plan Developed', 'Planning', 15, 6,
   'Detailed execution plan developed, submitted, and reviewed by the primary planner.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-16', 16, 16, 'Job Plan Integrated', 'Planning', 0, null,
   'Execution strategy reviewed by planner, contractor, master scheduler; density review and crew assignments.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-17', 17, 17, 'Operation Decon Plan', 'Operation', 0, null,
   'Process planner provides the scope safely; operations plans removal or minimization of hazards; plan loaded into the package.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-18', 18, 18, 'Operation LOTO', 'Operation', 10, 4,
   'Process planner develops the work-isolation blinding plan; confined-space isolations and ventilation captured; finished plans loaded into the package.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-19', 19, 19, 'Operations Review', 'Operation', 0, null,
   'Primary planner final approval and buy-in by primary stakeholders and unit operations.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-20', 20, 20, 'Engineer Repair Plan', 'Operation', 0, null,
   'Process-equipment repair plans generated by a mechanical engineer when modifying or repairing existing equipment.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-21', 21, 21, 'Engineer M-Spec', 'Operation', 0, null,
   'Process equipment requiring new or replacement parts verified by a qualified representative; documentation issued through document control.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20'),
  (1, 'pdf-22', 22, 22, 'MOC Ready', 'Operation', 0, null,
   'Scope requiring an MOC identified early; MOC requested from the primary stakeholder; complete once the MOC is approved for implementation.',
   'Packaged Planning Process PDF, PAR TAR PLANNING PROCESS, 2024-04-20')
on conflict (version, step_key) do nothing;

-- Credits sum to 100% and standard hours to 40 — validated, never
-- assumed. A seed that ever drifts (bad edit, partial insert) fails the
-- migration loudly instead of shipping a checklist that cannot reach 100%.
do $$
declare
  v_credit numeric;
  v_hours numeric;
  v_count integer;
  v_keys integer;
begin
  select count(*), count(distinct step_key),
         coalesce(sum(credit_pct), 0), coalesce(sum(mhrs_standard), 0)
    into v_count, v_keys, v_credit, v_hours
    from public.forge_work_planning_process_template
    where version = 1;
  if v_count <> 22 then
    raise exception 'WPP10_TEMPLATE_COUNT: expected 22 template steps for version 1, found %', v_count;
  end if;
  if v_keys <> 22 then
    raise exception 'WPP10_TEMPLATE_KEYS: expected 22 distinct step keys for version 1, found %', v_keys;
  end if;
  if v_credit <> 100 then
    raise exception 'WPP10_TEMPLATE_CREDITS: template credits must sum to 100, found %', v_credit;
  end if;
  if v_hours <> 40 then
    raise exception 'WPP10_TEMPLATE_HOURS: template standard hours must sum to 40, found %', v_hours;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Per-package instances — exactly one row per package x template step.
-- ---------------------------------------------------------------------------

create table if not exists public.forge_work_planning_process_instances (
  owner_id text not null,
  id text not null,
  work_package_id text not null,
  template_version integer not null check (template_version >= 1),
  template_step_id text not null,
  status text not null default 'In-Progress'
    check (status in ('N/A', 'In-Progress', 'Complete', 'Needs Revision', 'Reviewed')),
  evidence_link text
    check (evidence_link is null or char_length(evidence_link) <= 2000)
    check (evidence_link is null or evidence_link !~ '[[:cntrl:]]'),
  reviewed_by text,
  reviewed_at timestamptz,
  -- Last actor to submit a status/evidence change on this row. NULL
  -- until the first change (the ensure that creates the row is not a
  -- submission). The self-review ban reads this, not updated_by: merely
  -- opening the checklist must not count as submitting the step.
  submitted_by text,
  -- Optimistic-concurrency version: +1 on every status/evidence
  -- change. The set-status RPC rejects a stale expected version
  -- with WPP10_STALE_VERSION (409).
  version integer not null default 1 check (version >= 1),
  created_by text not null,
  updated_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  unique (owner_id, work_package_id, template_step_id),
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  foreign key (template_version, template_step_id)
    references public.forge_work_planning_process_template (version, step_key) on delete restrict,
  -- Reviewed is only ever recorded with a reviewer attached (the RPC sets
  -- both together); a row that claims Reviewed with no reviewer is corrupt.
  check (status <> 'Reviewed' or reviewed_by is not null),
  check (reviewed_at is null or reviewed_by is not null)
);

create index if not exists idx_forge_work_planning_process_instances_package
  on public.forge_work_planning_process_instances (owner_id, work_package_id, template_step_id);

comment on table public.forge_work_planning_process_instances is
  'Per-package planning-process checklist state: exactly one row per package x template step (22 per package, bound to the package''s template version). Status is one of the PDF''s five word statuses (N/A / In-Progress / Complete / Needs Revision / Reviewed). In-Progress is the default on a new package. Earned value is computed from status + template credit, never stored here. Row version increments on every change for optimistic concurrency; submitted_by tracks the latest submitter for the self-review ban.';

-- ---------------------------------------------------------------------------
-- 3. Revisions — append-only status-event audit for the instances (F2).
--    One row per change, never updated or deleted: before/after status,
--    actor, reason, evidence digest/reference, attestation, override
--    flag, UTC time, request ID. old_values/new_values carry the
--    generic event payload (status + evidence link for status changes,
--    from/to complexity for complexity-change events).
-- ---------------------------------------------------------------------------

create table if not exists public.forge_work_planning_process_revisions (
  owner_id text not null,
  id text not null,
  instance_id text,
  work_package_id text not null,
  template_step_id text,
  actor_id text not null,
  action text not null check (action in ('status_change', 'evidence_link_change', 'complexity_change')),
  old_status text check (old_status is null or old_status in ('N/A', 'In-Progress', 'Complete', 'Needs Revision', 'Reviewed')),
  new_status text check (new_status is null or new_status in ('N/A', 'In-Progress', 'Complete', 'Needs Revision', 'Reviewed')),
  reason text
    check (reason is null or char_length(reason) <= 500)
    check (reason is null or reason !~ '[[:cntrl:]]'),
  evidence_reference text
    check (evidence_reference is null or char_length(evidence_reference) <= 2000)
    check (evidence_reference is null or evidence_reference !~ '[[:cntrl:]]'),
  evidence_digest text
    check (evidence_digest is null or evidence_digest ~ '^[0-9a-f]{32}$'),
  attestation text
    check (attestation is null or char_length(attestation) <= 500)
    check (attestation is null or attestation !~ '[[:cntrl:]]'),
  is_override boolean not null default false,
  request_id text not null,
  request_payload jsonb,
  old_values jsonb,
  new_values jsonb,
  recorded_at timestamptz not null default now(),
  primary key (owner_id, id),
  foreign key (owner_id, instance_id)
    references public.forge_work_planning_process_instances (owner_id, id) on delete restrict,
  foreign key (owner_id, work_package_id)
    references public.forge_work_packages (owner_id, id) on delete restrict,
  -- A reviewed decision is never silently overwritten: the history is
  -- append-only, and a status change always carries both sides.
  check (action <> 'status_change' or (old_status is not null and new_status is not null))
);
-- Fix round 2 (P1-B): the canonical original-payload record that
-- set-status idempotency compares against. Guarded so a re-apply
-- over a table created by the fix-round-1 file still gains the
-- column.
alter table public.forge_work_planning_process_revisions
  add column if not exists request_payload jsonb;

create index if not exists idx_forge_work_planning_process_revisions_package
  on public.forge_work_planning_process_revisions (owner_id, work_package_id, recorded_at desc, id);

-- Idempotency: one request ID applies at most once per package x step.
-- (NULL template_step_id rows — package-level complexity events — never
-- collide under this index, because Postgres treats NULLs as distinct.)
create unique index if not exists idx_forge_work_planning_process_revisions_request
  on public.forge_work_planning_process_revisions (owner_id, work_package_id, template_step_id, request_id);

-- ---------------------------------------------------------------------------
-- 4. Per-package complexity + bound template version on the package row.
-- ---------------------------------------------------------------------------

alter table public.forge_work_packages
  add column if not exists planning_complexity text not null default 'standard';

-- Every row that existed before this migration was planned on the PDF's
-- standard 40-hour basis, so the 'standard' default is the honest
-- backfill — no UPDATE needed, no row changes meaning.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_forge_work_packages_planning_complexity'
      and conrelid = 'forge_work_packages'::regclass
  ) then
    alter table public.forge_work_packages
      add constraint chk_forge_work_packages_planning_complexity
        check (planning_complexity in ('low', 'standard', 'mid', 'high', 'h_high'));
  end if;
end $$;

comment on column public.forge_work_packages.planning_complexity is
  'Planning-process complexity (PDF scale): low 75% / standard 100% / mid 150% / high 200% / h_high 300% of the standard 40 planning hours. Per-step MHRS is template MHRS x this multiplier, computed — never stored per step, never overridden. Editable by an authorized planner/admin until a planning baseline/freeze exists; changes recalculate derived MHRS and are audited as complexity_change events. No planning freeze exists in Slice A — the gate activates with the freeze entity (follow-up, see build report).';

alter table public.forge_work_packages
  add column if not exists planning_template_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chk_forge_work_packages_planning_template_version'
      and conrelid = 'forge_work_packages'::regclass
  ) then
    alter table public.forge_work_packages
      add constraint chk_forge_work_packages_planning_template_version
        check (planning_template_version = 1);
  end if;
end $$;

comment on column public.forge_work_packages.planning_template_version is
  'Bound planning-process template version (Slice A: 1 only). New template versions are new versions; migrating a package to a new version needs a separately reviewed action — a reviewed migration widens this CHECK. Never changed silently.';

-- ---------------------------------------------------------------------------
-- 5. Planner capabilities: planner.planning_steps.read / .update / .review.
--    Read: everyone who can view steps. Update: Planner Admin + Planner
--    (status changes except Reviewed). Review: Planner Admin + Reviewer
--    (only they may mark a step Reviewed — the PDF's Reviewed status
--    means "reviewed and accepted by the reviewer"; a reviewer never
--    reviews their own latest submission). Owner/co-owner pass every
--    capability check via has_planner_permission by design.
-- ---------------------------------------------------------------------------

-- Extend the capability-key CHECK on forge_planner_role_capabilities.
-- The constraint is inline in the slice-1 table definition, so its name
-- is auto-generated; resolve it from the catalog and replace it only if
-- it does not already carry the new keys (idempotent re-apply).
do $$
declare
  v_con text;
  v_has_new boolean;
begin
  select conname into v_con
    from pg_constraint
    where conrelid = 'forge_planner_role_capabilities'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%planner.packages.read%';
  if v_con is null then
    raise exception 'WPP10_CAPABILITY_CHECK_MISSING: could not find the capability-key CHECK on forge_planner_role_capabilities';
  end if;
  select pg_get_constraintdef(oid) like '%planner.planning_steps.read%'
    into v_has_new
    from pg_constraint
    where conname = v_con
      and conrelid = 'forge_planner_role_capabilities'::regclass;
  if not coalesce(v_has_new, false) then
    execute format('alter table public.forge_planner_role_capabilities drop constraint %I', v_con);
    alter table public.forge_planner_role_capabilities
      add constraint forge_planner_role_capabilities_capability_key_check
        check (capability_key in (
          'planner.packages.read','planner.packages.create','planner.packages.edit','planner.packages.close','planner.packages.cancel',
          'planner.drawings.read','planner.drawings.upload','planner.drawings.link','planner.drawings.unlink','planner.drawings.delete',
          'planner.steps.read','planner.steps.create','planner.steps.edit','planner.steps.reorder','planner.steps.retire',
          'planner.crafts.read','planner.crafts.assign','planner.crafts.reassign','planner.crafts.clear',
          'planner.manpower.read','planner.manpower.placements.edit',
          'planner.baselines.read','planner.baselines.freeze','planner.baselines.select',
          'planner.progress.read','planner.progress.add','planner.progress.correct','planner.progress.void',
          'planner.permits.read','planner.permits.annotations.link','planner.permits.annotations.unlink',
          'planner.reports.read','planner.reports.export',
          'planner.settings.read','planner.settings.edit',
          'planner.staff.read','planner.staff.invite',
          'planner.roles.read','planner.roles.manage',
          'planner.audit.read',
          'planner.planning_steps.read','planner.planning_steps.update','planner.planning_steps.review'
        ));
  end if;
end $$;

-- Starter-role provisioning, updated to grant the three new capabilities
-- (same function body as 20261110000000, only the v_starter JSON
-- differs — verified by diff at build time: five role lines changed,
-- nothing else). New workspaces provisioned after this migration get
-- the capabilities from here; workspaces that already exist are covered
-- by the backfill below.
create or replace function public.forge_planner_roles_provision_starter_set(
  p_owner_id text, p_request_id text
)
returns setof public.forge_planner_roles
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor text := auth.uid()::text;
  v_is_owner boolean;
  v_starter jsonb := '[
    {"role_key":"planner_admin","name":"Planner Admin","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.packages.create","planner.packages.edit","planner.packages.close","planner.packages.cancel","planner.steps.create","planner.steps.edit","planner.steps.reorder","planner.steps.retire","planner.crafts.assign","planner.crafts.reassign","planner.crafts.clear","planner.manpower.placements.edit","planner.progress.add","planner.progress.correct","planner.progress.void","planner.permits.annotations.link","planner.permits.annotations.unlink","planner.drawings.upload","planner.drawings.link","planner.drawings.delete","planner.baselines.freeze","planner.baselines.select","planner.planning_steps.read","planner.planning_steps.update","planner.planning_steps.review"]},
    {"role_key":"planner","name":"Planner","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.packages.edit","planner.steps.edit","planner.crafts.assign","planner.manpower.placements.edit","planner.progress.add","planner.drawings.link","planner.planning_steps.read","planner.planning_steps.update"]},
    {"role_key":"scheduler","name":"Scheduler","capabilities":["planner.packages.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.planning_steps.read","planner.crafts.assign","planner.manpower.placements.edit"]},
    {"role_key":"reviewer","name":"Reviewer","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.reports.export","planner.planning_steps.read","planner.planning_steps.review"]},
    {"role_key":"read_only","name":"Read-only","capabilities":["planner.packages.read","planner.drawings.read","planner.steps.read","planner.crafts.read","planner.manpower.read","planner.baselines.read","planner.progress.read","planner.permits.read","planner.reports.read","planner.settings.read","planner.staff.read","planner.roles.read","planner.audit.read","planner.planning_steps.read"]}
  ]'::jsonb;
  v_def jsonb;
  v_role_id text;
  v_cap text;
begin
  if v_actor is null then raise exception 'PADM1_INVALID_ACTOR'; end if;
  if p_request_id is null or trim(p_request_id) = '' then raise exception 'PADM1_REQUEST_ID_REQUIRED'; end if;

  v_is_owner := (p_owner_id = v_actor) or exists (
    select 1 from workspace_members where owner_id = p_owner_id and member_user_id::text = v_actor and status = 'active' and role = 'co_owner'
  );
  if not v_is_owner then
    raise exception 'PADM1_OWNER_ONLY';
  end if;

  for v_def in select * from jsonb_array_elements(v_starter)
  loop
    if exists (select 1 from public.forge_planner_roles where owner_id = p_owner_id and role_key = v_def->>'role_key') then
      continue;
    end if;

    v_role_id := 'forge_pr_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.forge_planner_roles (owner_id, id, role_key, name, is_builtin, created_by, updated_by)
    values (p_owner_id, v_role_id, v_def->>'role_key', v_def->>'name', true, v_actor, v_actor);

    for v_cap in select jsonb_array_elements_text(v_def->'capabilities')
    loop
      insert into public.forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
      values (p_owner_id, 'forge_prc_' || replace(gen_random_uuid()::text, '-', ''), v_role_id, v_cap, v_actor);
    end loop;

    insert into public.forge_planner_permission_audit (owner_id, id, actor_id, action, target_role_id, old_values, new_values, reason, request_id)
    values (p_owner_id, 'forge_pa_' || replace(gen_random_uuid()::text, '-', ''), v_actor, 'role_create', v_role_id,
            null, jsonb_build_object('role_key', v_def->>'role_key', 'name', v_def->>'name', 'capabilities', v_def->'capabilities'),
            'starter role provisioning', p_request_id);
  end loop;

  return query
    select * from public.forge_planner_roles
    where owner_id = p_owner_id and is_builtin = true and retired_at is null
    order by role_key;
end;
$$;

revoke all on function public.forge_planner_roles_provision_starter_set(text, text) from public, anon, service_role;
grant execute on function public.forge_planner_roles_provision_starter_set(text, text) to authenticated;

-- Backfill: builtin starter roles that already exist (provisioned before
-- this migration) gain the new capabilities. Idempotent — the NOT EXISTS
-- guard means a second run inserts nothing. Custom roles are untouched:
-- an owner who built a custom role decides its capabilities in the
-- admin UI, where the three new keys now appear in the catalog.
insert into public.forge_planner_role_capabilities (owner_id, id, role_id, capability_key, created_by)
select r.owner_id,
       'forge_prc_' || replace(gen_random_uuid()::text, '-', ''),
       r.id, c.capability_key, 'migration-20261112000000'
from public.forge_planner_roles r
cross join (values
  ('planner_admin', 'planner.planning_steps.read'),
  ('planner_admin', 'planner.planning_steps.update'),
  ('planner_admin', 'planner.planning_steps.review'),
  ('planner', 'planner.planning_steps.read'),
  ('planner', 'planner.planning_steps.update'),
  ('scheduler', 'planner.planning_steps.read'),
  ('reviewer', 'planner.planning_steps.read'),
  ('reviewer', 'planner.planning_steps.review'),
  ('read_only', 'planner.planning_steps.read')
) as c(role_key, capability_key)
where r.role_key = c.role_key
  and r.retired_at is null
  and not exists (
    select 1 from public.forge_planner_role_capabilities rc
    where rc.owner_id = r.owner_id
      and rc.role_id = r.id
      and rc.capability_key = c.capability_key
  );

-- ---------------------------------------------------------------------------
-- 6. RLS + effective ACLs. Selective grants are claims until the
-- post-apply receipt proves them: every privilege NOT intended is
-- explicitly REVOKED (Supabase defaults grant ALL on new public tables
-- and EXECUTE to named roles). Reads: owner/co-owner boundary OR a
-- planner.planning_steps.read holder. No write policies anywhere — the
-- RPCs below are the only write path, and they re-check authorization
-- server-side on every call.
-- ---------------------------------------------------------------------------

alter table public.forge_work_planning_process_template enable row level security;
alter table public.forge_work_planning_process_template force row level security;
alter table public.forge_work_planning_process_instances enable row level security;
alter table public.forge_work_planning_process_instances force row level security;
alter table public.forge_work_planning_process_revisions enable row level security;
alter table public.forge_work_planning_process_revisions force row level security;

drop policy if exists forge_work_planning_process_template_select
  on public.forge_work_planning_process_template;
create policy forge_work_planning_process_template_select
  on public.forge_work_planning_process_template for select to authenticated
  using (true);

drop policy if exists forge_work_planning_process_instances_select
  on public.forge_work_planning_process_instances;
create policy forge_work_planning_process_instances_select
  on public.forge_work_planning_process_instances for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_planner_permission(owner_id, 'planner.planning_steps.read')
  );

drop policy if exists forge_work_planning_process_revisions_select
  on public.forge_work_planning_process_revisions;
create policy forge_work_planning_process_revisions_select
  on public.forge_work_planning_process_revisions for select to authenticated
  using (
    public.has_workspace_access(owner_id)
    or public.has_planner_permission(owner_id, 'planner.planning_steps.read')
  );

revoke all on table public.forge_work_planning_process_template from public, anon, service_role, authenticated;
grant select on table public.forge_work_planning_process_template to authenticated;
revoke all on table public.forge_work_planning_process_instances from public, anon, service_role, authenticated;
grant select on table public.forge_work_planning_process_instances to authenticated;
revoke all on table public.forge_work_planning_process_revisions from public, anon, service_role, authenticated;
grant select on table public.forge_work_planning_process_revisions to authenticated;

-- ---------------------------------------------------------------------------
-- 7. RPC: forge_work_planning_process_checklist — READ-ONLY.
--
-- Verifies the bound template version (exactly 22 rows, 22 distinct
-- step keys, credits sum 100, standard hours sum 40) and fails closed
-- (WPP10_TEMPLATE_INVALID) on any drift. Then verifies the 22
-- instance rows already exist for the package (created atomically
-- with the package row by the trigger in section 9, or by the
-- idempotent backfill in section 10) — exactly 22 rows, 22 distinct
-- step keys (WPP10_CHECKLIST_INCOMPLETE otherwise). A GET never
-- mutates: a missing/duplicated set is unavailable, never
-- auto-created. Returns the whole checklist (template + instances +
-- the package's complexity and bound template version + the caller's
-- effective update/review affordances + construction readiness) as
-- one jsonb object.
--
-- constructionReadiness is ALWAYS 'not_established' in Slice A: no
-- package-level release decision exists yet, and no release API is
-- invented here (F1). Planning percent never authorizes construction
-- or releases an IFC drawing; the UI shows the not-established
-- sentence whenever planning reaches 100%.
--
-- Percent complete is NOT computed here: the JS domain module
-- (src/domains/work-management/planningProcess.js) is the single source
-- of truth for earned value, shared by the UI and the tests.
--
-- Guard: owner/co-owner boundary OR a planner.planning_steps.read
-- holder — the admin-permissions design gates staff by
-- has_planner_permission, never by broadening has_workspace_access
-- (scope brief results/chatgpt/work-package-planner-admin-permissions-scope-2026-11-08.md:
-- "Every key must be backed by actual RLS/RPC enforcement before
-- assignable"). A staff reader with only .read can open the checklist;
-- a stranger gets WPP10_WORKSPACE_FORBIDDEN.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_planning_process_checklist(
  p_owner_id text,
  p_package_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_complexity text;
  v_template_version integer;
  v_can_update boolean;
  v_can_review boolean;
  v_is_owner boolean;
  v_count integer;
  v_keys integer;
  v_credit numeric;
  v_hours numeric;
  v_instances integer;
begin
  if not (public.has_workspace_access(p_owner_id)
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.read')) then
    raise exception 'WPP10_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP10_INVALID_ACTOR';
  end if;

  select planning_complexity, planning_template_version
    into v_complexity, v_template_version
    from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if v_complexity is null then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;

  -- F3: verify the bound template BEFORE instantiating. A template
  -- that cannot reach 100% (or has a missing/duplicated row) must fail
  -- closed, never mint a checklist that reports a misleading percent.
  select count(*), count(distinct step_key),
         coalesce(sum(credit_pct), 0), coalesce(sum(mhrs_standard), 0)
    into v_count, v_keys, v_credit, v_hours
    from public.forge_work_planning_process_template
    where version = v_template_version;
  if v_count <> 22 or v_keys <> 22 or v_credit <> 100 or v_hours <> 40 then
    raise exception 'WPP10_TEMPLATE_INVALID: template version % has % rows (% distinct keys), credits %, hours %',
      v_template_version, v_count, v_keys, v_credit, v_hours;
  end if;

  v_can_update := public.has_planner_permission(p_owner_id, 'planner.planning_steps.update');
  v_can_review := public.has_planner_permission(p_owner_id, 'planner.planning_steps.review');
  v_is_owner := public.has_workspace_access(p_owner_id);

  -- F1 (fix round 1): READ-ONLY. The 22 instance rows are created
  -- atomically with the package row (trigger, section 9) or by the
  -- idempotent backfill (section 10). A GET never mutates: a
  -- missing/duplicated set is unavailable, never auto-created.
  select count(*), count(distinct template_step_id) into v_instances, v_keys
    from public.forge_work_planning_process_instances
    where owner_id = p_owner_id and work_package_id = p_package_id;
  if v_instances <> 22 or v_keys <> 22 then
    raise exception 'WPP10_CHECKLIST_INCOMPLETE: package % has % planning instances (% distinct step keys), expected 22', p_package_id, v_instances, v_keys;
  end if;

  return jsonb_build_object(
    'packageId', p_package_id,
    'complexity', v_complexity,
    'templateVersion', v_template_version,
    'canUpdate', v_can_update,
    'canReview', v_can_review,
    'isOwner', v_is_owner,
    'constructionReadiness', jsonb_build_object(
      'status', 'not_established',
      'detail', 'No package-level release decision exists yet. Planning percent never authorizes construction or releases an IFC drawing.'
    ),
    'template', (
      select coalesce(jsonb_agg(row_to_json(t) order by t.sort_order), '[]'::jsonb)
      from (select version, step_key, step_number, sort_order, name, role, credit_pct, mhrs_standard, description, provenance
              from public.forge_work_planning_process_template
              where version = v_template_version) t
    ),
    'instances', (
      select coalesce(jsonb_agg(row_to_json(i) order by i.template_step_id), '[]'::jsonb)
      from (select id, work_package_id, template_version, template_step_id, status, evidence_link,
                   reviewed_by, reviewed_at, submitted_by, version, updated_by, updated_at
              from public.forge_work_planning_process_instances
              where owner_id = p_owner_id and work_package_id = p_package_id) i
    )
  );
end;
$$;

revoke all on function public.forge_work_planning_process_checklist(text, text) from public, anon, service_role;
grant execute on function public.forge_work_planning_process_checklist(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. RPC: forge_work_planning_process_set_status — the only write path.
--
-- One status change = one instance update + one append-only revision
-- row, same transaction. Rules enforced here (never trust the client):
--   - actor, workspace, package and permission are derived server-side
--     (auth.uid(), has_workspace_access, has_planner_permission);
--     browser-supplied updatedBy/reviewedBy/role/earned value are
--     ignored — the RPC takes no such parameters;
--   - status must be one of the PDF's five word statuses;
--   - TRANSITION/AUTHORITY MATRIX (fix round 1). In-Progress and
--     Complete require planner.planning_steps.update; N/A, Reviewed
--     and Needs Revision require planner.planning_steps.review. Either
--     gate also passes for the owner/co-owner (structural authority —
--     has_workspace_access). The gates are real for staff: a Planner
--     assignee can set Complete but not Reviewed; a Reviewer assignee
--     can set Reviewed, N/A or Needs Revision but not ordinary
--     statuses. Until the role policy is deployed (this migration),
--     owner/co-owner only — the gates above are what make the three
--     new capabilities assignable rather than decorative (admin scope
--     brief: every key must be backed by actual RPC enforcement);
--   - Reviewed only from a distinct prior submission (Complete or N/A,
--     submitted_by non-null and not the reviewer) with an existing
--     qualifying basis — an evidence link already on the row, an
--     attestation in the latest revision, or the N/A reason — and with
--     NO new evidence/attestation supplied in the same decision
--     (WPP10_REVIEW_EVIDENCE_SAME_REQUEST), except an owner/co-owner
--     reasoned override (recorded as is_override);
--   - a reviewer cannot review their own latest submission
--     (submitted_by): WPP10_SELF_REVIEW_FORBIDDEN. An owner/co-owner
--     may override with a nonempty reason — recorded as is_override;
--   - a Reviewed row may only go back through Needs Revision by
--     review authority (WPP10_REVIEWED_LOCKED); returning from Needs
--     Revision is two-step — resubmit Complete with fresh evidence,
--     then a different reviewer marks Reviewed (Reviewed directly
--     from Needs Revision is WPP10_TWO_STEP_REQUIRED);
--   - Complete requires an EFFECTIVE evidence reference (a link
--     supplied now, else the link already on the row — an explicit
--     clear is NOT evidence) or a bounded completion attestation
--     (<= 500 chars); returning to Complete from Needs Revision
--     requires FRESH evidence/attestation supplied in this request
--     (a stale stored link does not count);
--   - N/A requires the review capability, a nonempty reason
--     (<= 500 chars) and an authorized confirmation. Needs Revision
--     requires the review capability, a nonempty reason and reviewer
--     attribution (the revision's actor_id);
--   - a terminal package (cancelled / verified_closed) cannot change;
--   - Reviewed records the reviewer (auth.uid()) and the time; leaving
--     Reviewed clears both, so a row never claims Reviewed with no
--     reviewer (the table CHECK backs this too);
--   - optimistic concurrency is MANDATORY: p_expected_version must be
--     a positive integer (WPP10_EXPECTED_VERSION_REQUIRED); the
--     instance row is locked FOR UPDATE and the update is conditional
--     on the version — a stale version is rejected with
--     WPP10_STALE_VERSION (409); the row version increments on every
--     successful change;
--   - idempotency: p_request_id is MANDATORY, nonempty and <= 128
--     chars (WPP10_REQUEST_ID_REQUIRED / WPP10_INVALID_REQUEST_ID). A
--     request ID already recorded for this package x step with the
--     SAME canonical payload replays the current row without
--     re-applying (no second revision, no version bump); reuse with
--     a DIFFERENT payload is rejected with
--     WPP10_REQUEST_ID_CONFLICT. The canonical payload is the
--     caller's original raw inputs (status + evidence mode/link +
--     reason + attestation), stored as request_payload on the
--     revision row — an omitted evidence link is an explicit
--     'omitted' mode, distinct from a clear and from a supplied
--     link, so an intervening evidence change never turns an exact
--     retry into a conflict. Callers must use a fresh request ID
--     per logical change;
--   - evidence_link: null means unchanged, '' clears to null, anything
--     else must be <= 2000 chars with no control characters;
--   - the revision row carries before/after status, actor, reason,
--     evidence reference + md5 digest, attestation, override flag,
--     request ID and UTC time (recorded_at, timestamptz).
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_planning_process_set_status(
  p_owner_id text,
  p_package_id text,
  p_template_step_id text,
  p_status text,
  p_evidence_link text default null,
  p_reason text default null,
  p_attestation text default null,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_is_owner boolean;
  v_pkg_status text;
  v_inst public.forge_work_planning_process_instances%rowtype;
  v_old_status text;
  v_old_evidence text;
  v_evidence text;
  v_effective_evidence text;
  v_reason text;
  v_attestation text;
  v_request_id text;
  v_latest_attestation text;
  v_latest_reason text;
  v_latest_actor text;
  v_payload jsonb;
  v_prev_payload jsonb;
  v_is_override boolean := false;
  v_action text;
begin
  -- Entry guard: anyone who can see the package may reach the
  -- capability checks below. A reader with only .read must get the
  -- honest UPDATE_FORBIDDEN (403), not a WORKSPACE_FORBIDDEN (404
  -- "not found") for a package they can plainly see; a true stranger
  -- with no capability at all still gets WORKSPACE_FORBIDDEN, so
  -- existence is never leaked to them.
  if not (public.has_workspace_access(p_owner_id)
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.read')
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.update')
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.review')) then
    raise exception 'WPP10_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP10_INVALID_ACTOR';
  end if;
  v_is_owner := public.has_workspace_access(p_owner_id);

  select status into v_pkg_status
    from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id;
  if v_pkg_status is null then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg_status in ('cancelled', 'verified_closed') then
    raise exception 'WPP10_PACKAGE_TERMINAL';
  end if;

  if p_status is null or p_status not in ('N/A', 'In-Progress', 'Complete', 'Needs Revision', 'Reviewed') then
    raise exception 'WPP10_INVALID_STATUS';
  end if;

  -- F2 (fix round 1): optimistic concurrency is MANDATORY — a
  -- missing/zero/negative expected version is a 400, never an
  -- optional guard. A missing request ID is a 400; an over-long one
  -- is a 400. Neither is ever minted server-side here: a caller that
  -- cannot name its change cannot replay or de-duplicate it.
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'WPP10_EXPECTED_VERSION_REQUIRED';
  end if;
  v_request_id := nullif(btrim(coalesce(p_request_id, '')), '');
  if v_request_id is null then
    raise exception 'WPP10_REQUEST_ID_REQUIRED';
  end if;
  if char_length(v_request_id) > 128 then
    raise exception 'WPP10_INVALID_REQUEST_ID';
  end if;

  if p_evidence_link is not null then
    v_evidence := nullif(btrim(p_evidence_link), '');
    if v_evidence is not null
       and (char_length(v_evidence) > 2000 or v_evidence ~ '[[:cntrl:]]') then
      raise exception 'WPP10_INVALID_EVIDENCE_LINK';
    end if;
  end if;

  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  if v_reason is not null and char_length(v_reason) > 500 then
    raise exception 'WPP10_INVALID_REASON';
  end if;
  v_attestation := nullif(btrim(coalesce(p_attestation, '')), '');
  if v_attestation is not null and char_length(v_attestation) > 500 then
    raise exception 'WPP10_INVALID_ATTESTATION';
  end if;

  -- F3 (fix round 1): the transition/authority matrix. In-Progress
  -- and Complete need the update capability; N/A, Reviewed and Needs
  -- Revision need the review capability. Owner/co-owner pass every
  -- gate. A Reviewer assignee CAN record Needs Revision; an ordinary
  -- Planner must NOT.
  if p_status in ('N/A', 'Reviewed', 'Needs Revision') then
    if not (v_is_owner
            or public.has_planner_permission(p_owner_id, 'planner.planning_steps.review')) then
      if p_status = 'Reviewed' then
        raise exception 'WPP10_REVIEW_FORBIDDEN';
      end if;
      raise exception 'WPP10_REVIEW_CAPABILITY_REQUIRED';
    end if;
  else
    if not (v_is_owner
            or public.has_planner_permission(p_owner_id, 'planner.planning_steps.update')) then
      raise exception 'WPP10_UPDATE_FORBIDDEN';
    end if;
  end if;

  -- Lock the instance row for the rest of this transaction so two
  -- concurrent writers serialize here; the conditional UPDATE below
  -- is the second, atomic guard on the version.
  select * into v_inst
    from public.forge_work_planning_process_instances
    where owner_id = p_owner_id
      and work_package_id = p_package_id
      and template_step_id = p_template_step_id
    for update;
  if v_inst.id is null then
    raise exception 'WPP10_STEP_NOT_FOUND';
  end if;

  -- Capture the pre-update values BEFORE the UPDATE ... RETURNING
  -- below overwrites v_inst, or the revision row would record the new
  -- status as both old and new.
  v_old_status := v_inst.status;
  v_old_evidence := v_inst.evidence_link;

  -- F4 (fix round 1): ONE effective post-update evidence value.
  -- p_evidence_link null means "unchanged" (keep the stored link);
  -- '' clears it; anything else replaces. The effective value is
  -- validated BEFORE the UPDATE, so a clear can never be mistaken
  -- for evidence.
  v_effective_evidence := case when p_evidence_link is null then v_old_evidence else v_evidence end;

  -- Fix round 2 (P1-B): the canonical original payload — the
  -- caller's raw inputs as supplied, including an explicit
  -- representation of "evidence omitted". An omitted evidence link
  -- is a payload fact (mode 'omitted'), distinct from an explicit
  -- clear (mode 'cleared': '' normalizes to null) and from a
  -- supplied link (mode 'value'). The payload is built from the raw
  -- parameters, never re-derived from the row's current stored
  -- link: the effective evidence is a validation input, not the
  -- caller's intent. jsonb object comparison is order-insensitive,
  -- so the stored payload is a stable canonical record.
  v_payload := jsonb_build_object(
    'status', p_status,
    'evidence', case
      when p_evidence_link is null then jsonb_build_object('mode', 'omitted')
      when v_evidence is null then jsonb_build_object('mode', 'cleared')
      else jsonb_build_object('mode', 'value', 'link', v_evidence)
    end,
    'reason', v_reason,
    'attestation', v_attestation
  );

  -- Idempotency: a request ID already recorded for this package x
  -- step replays the current row without re-applying, but ONLY for
  -- the same canonical payload. Reuse with a different payload is
  -- a conflict — silently accepting it would lose the second
  -- change. Checked before the version gate (a replay's expected
  -- version is stale by definition) and before the transition rules
  -- (the original call already passed them). Because the comparison
  -- uses the stored ORIGINAL payload, an intervening evidence or
  -- status change never turns an exact retry into a conflict, and
  -- the replay response is the current row.
  select request_payload
    into v_prev_payload
    from public.forge_work_planning_process_revisions r
    where r.owner_id = p_owner_id
      and r.work_package_id = p_package_id
      and r.template_step_id = p_template_step_id
      and r.request_id = v_request_id;
  if v_prev_payload is not null then
    if v_prev_payload = v_payload then
      return row_to_json(v_inst)::jsonb;
    end if;
    raise exception 'WPP10_REQUEST_ID_CONFLICT';
  end if;
  -- A pre-fix revision row (no stored payload) with this request ID
  -- cannot prove the payload matches: fail closed — the caller
  -- must use a fresh request ID.
  perform 1
    from public.forge_work_planning_process_revisions r
    where r.owner_id = p_owner_id
      and r.work_package_id = p_package_id
      and r.template_step_id = p_template_step_id
      and r.request_id = v_request_id;
  if found then
    raise exception 'WPP10_REQUEST_ID_CONFLICT';
  end if;

  -- Optimistic concurrency: a stale expected version is a 409, never
  -- a silent overwrite of another writer's change.
  if p_expected_version <> v_inst.version then
    raise exception 'WPP10_STALE_VERSION: expected version %, current version %', p_expected_version, v_inst.version;
  end if;

  -- F3 (fix round 1): a Reviewed row may only go back through Needs
  -- Revision, by review authority. An ordinary updater cannot
  -- silently downgrade or rewrite it.
  if v_old_status = 'Reviewed' and p_status not in ('Reviewed', 'Needs Revision') then
    raise exception 'WPP10_REVIEWED_LOCKED';
  end if;

  -- F3: returning from Needs Revision is two-step — resubmit as
  -- Complete with fresh evidence, then a different reviewer marks
  -- Reviewed. Reviewed directly from Needs Revision is rejected.
  if p_status = 'Reviewed' and v_old_status = 'Needs Revision' then
    raise exception 'WPP10_TWO_STEP_REQUIRED';
  end if;

  -- F3: Reviewed only from a distinct prior submission. The row must
  -- have been submitted (Complete or N/A) by someone other than the
  -- reviewer, and there must be an existing qualifying basis: an
  -- evidence link already on the row, an attestation in the latest
  -- revision, or the N/A reason. No new evidence/attestation may be
  -- supplied in the same review decision — the review judges what is
  -- already there — except an owner/co-owner reasoned override.
  -- (An evidence-only change on an already-Reviewed row — same
  -- status — skips the basis checks: it is not a review decision.)
  if p_status = 'Reviewed' and v_old_status <> 'Reviewed' then
    if v_old_status not in ('Complete', 'N/A') then
      raise exception 'WPP10_REVIEW_BASIS_REQUIRED: only a submitted step (Complete or N/A) can be Reviewed';
    end if;
    if v_inst.submitted_by is null then
      raise exception 'WPP10_REVIEW_BASIS_REQUIRED: no prior submission to review';
    end if;
    select attestation, reason, actor_id
      into v_latest_attestation, v_latest_reason, v_latest_actor
      from public.forge_work_planning_process_revisions
      where owner_id = p_owner_id
        and work_package_id = p_package_id
        and template_step_id = p_template_step_id
      order by recorded_at desc, id desc
      limit 1;
    if v_old_status = 'Complete'
       and v_old_evidence is null
       and v_latest_attestation is null then
      raise exception 'WPP10_REVIEW_BASIS_REQUIRED: a Complete step needs evidence or an attestation already on the record';
    end if;
    if v_old_status = 'N/A' and v_latest_reason is null then
      raise exception 'WPP10_REVIEW_BASIS_REQUIRED: an N/A step needs the confirmation reason already on the record';
    end if;
    -- Self-review ban: the reviewer cannot review their own latest
    -- submission. An owner/co-owner may override, but only with a
    -- nonempty reason — recorded as an override in the event.
    if v_inst.submitted_by = v_actor then
      if not v_is_owner then
        raise exception 'WPP10_SELF_REVIEW_FORBIDDEN';
      end if;
      if v_reason is null then
        raise exception 'WPP10_REASON_REQUIRED: an owner override reviewing their own submission needs a reason';
      end if;
      v_is_override := true;
    end if;
    -- No new evidence/attestation in the same review decision,
    -- except an owner/co-owner reasoned override.
    if (p_evidence_link is not null or p_attestation is not null) then
      if not v_is_owner or v_reason is null then
        raise exception 'WPP10_REVIEW_EVIDENCE_SAME_REQUEST';
      end if;
      v_is_override := true;
    end if;
  end if;

  -- F4: Complete requires EFFECTIVE evidence (a link supplied now,
  -- else the link already on the row — an explicit clear is NOT
  -- evidence) or a bounded completion attestation. Returning to
  -- Complete from Needs Revision needs FRESH evidence/attestation
  -- supplied in this request (a stale stored link does not count).
  if p_status = 'Complete' then
    if v_old_status = 'Needs Revision' then
      if v_evidence is null and v_attestation is null then
        raise exception 'WPP10_FRESH_EVIDENCE_REQUIRED';
      end if;
    elsif v_effective_evidence is null and v_attestation is null then
      raise exception 'WPP10_EVIDENCE_REQUIRED';
    end if;
  end if;

  -- N/A and Needs Revision both need a nonempty reason — N/A must not
  -- be an effortless way to earn 100%, and a send-back must say why.
  if p_status in ('N/A', 'Needs Revision') and v_reason is null then
    raise exception 'WPP10_REASON_REQUIRED';
  end if;

  v_action := case when v_old_status = p_status then 'evidence_link_change' else 'status_change' end;

  -- Conditional UPDATE on the version: the atomic guard against a
  -- lost update. Zero affected rows means another writer moved the
  -- row since this call's expected version — a 409, never a silent
  -- overwrite. (The FOR UPDATE lock above serializes writers, so in
  -- practice this fires when the caller read a stale version.)
  update public.forge_work_planning_process_instances
    set status = p_status,
        -- v_effective_evidence is the ONE post-update evidence value
        -- (null means unchanged, '' clears to null, anything else
        -- replaces). Never re-derive it here.
        evidence_link = v_effective_evidence,
        reviewed_by = case when p_status = 'Reviewed' then v_actor else null end,
        reviewed_at = case when p_status = 'Reviewed' then now() else null end,
        submitted_by = v_actor,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = v_inst.id
      and version = p_expected_version
    returning * into v_inst;
  if v_inst is null then
    raise exception 'WPP10_STALE_VERSION: expected version %, current version has moved', p_expected_version;
  end if;

  insert into public.forge_work_planning_process_revisions
    (owner_id, id, instance_id, work_package_id, template_step_id, actor_id, action,
     old_status, new_status, reason, evidence_reference, evidence_digest, attestation,
     is_override, request_id, request_payload, old_values, new_values)
  values (
    p_owner_id,
    'forge_ppr_' || replace(gen_random_uuid()::text, '-', ''),
    v_inst.id,
    p_package_id,
    p_template_step_id,
    v_actor,
    v_action,
    v_old_status,
    p_status,
    v_reason,
    v_inst.evidence_link,
    case when v_inst.evidence_link is null then null else md5(v_inst.evidence_link) end,
    v_attestation,
    v_is_override,
    v_request_id,
    v_payload,
    jsonb_build_object('status', v_old_status, 'evidence_link', v_old_evidence),
    jsonb_build_object('status', p_status, 'evidence_link', v_inst.evidence_link)
  );

  return row_to_json(v_inst)::jsonb;
end;
$$;

revoke all on function public.forge_work_planning_process_set_status(text, text, text, text, text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_work_planning_process_set_status(text, text, text, text, text, text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Trigger: forge_work_packages AFTER INSERT — atomic checklist
--    creation (F1, fix round 1).
--
-- Package creation and its 22 checklist rows are ONE transaction:
-- the trigger fires on the package insert, validates the bound
-- template (22 rows / 22 distinct keys / credits 100 / hours 40) and
-- inserts the 22 instance rows (all In-Progress, submitted_by NULL —
-- creation is not a submission). If initialization fails, the trigger
-- raises and the package row rolls back with it — a package can never
-- exist without its checklist. The function is SECURITY DEFINER with
-- row_security off (instances/revisions have FORCE RLS + SELECT-only
-- grants), and the actor falls back to 'system' when auth.uid() is
-- null (service_role inserts). The checklist RPC is read-only and
-- never re-creates rows, so the trigger is the only creation path.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_planning_process_init_checklist()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_count integer;
  v_keys integer;
  v_credit numeric;
  v_hours numeric;
begin
  v_actor := coalesce(auth.uid()::text, 'system');

  -- Validate the bound template BEFORE instantiating: a template
  -- that cannot reach 100% must fail closed, never mint a checklist
  -- that reports a misleading percent.
  select count(*), count(distinct step_key),
         coalesce(sum(credit_pct), 0), coalesce(sum(mhrs_standard), 0)
    into v_count, v_keys, v_credit, v_hours
    from public.forge_work_planning_process_template
    where version = new.planning_template_version;
  if v_count <> 22 or v_keys <> 22 or v_credit <> 100 or v_hours <> 40 then
    raise exception 'WPP10_TEMPLATE_INVALID: template version % has % rows (% distinct keys), credits %, hours %',
      new.planning_template_version, v_count, v_keys, v_credit, v_hours;
  end if;

  insert into public.forge_work_planning_process_instances
    (owner_id, id, work_package_id, template_version, template_step_id, status, submitted_by, created_by, updated_by)
  select new.owner_id,
         'forge_ppi_' || replace(gen_random_uuid()::text, '-', ''),
         new.id,
         new.planning_template_version,
         t.step_key,
         'In-Progress',
         null,
         v_actor,
         v_actor
    from public.forge_work_planning_process_template t
    where t.version = new.planning_template_version;

  return new;
end;
$$;

drop trigger if exists forge_work_planning_process_init_checklist_trigger on public.forge_work_packages;
create trigger forge_work_planning_process_init_checklist_trigger
  after insert on public.forge_work_packages
  for each row
  execute function public.forge_work_planning_process_init_checklist();

-- ---------------------------------------------------------------------------
-- 10. Backfill: existing packages get their 22 checklist rows (F1).
--
-- Idempotent and owner/package/template-scoped: the NOT EXISTS guard
-- means a re-apply inserts nothing, and a package that already has
-- its rows (created by the trigger, or backfilled by a previous
-- apply) is untouched. Packages with no template version bound yet
-- are skipped — there is nothing to instantiate for them.
-- ---------------------------------------------------------------------------

insert into public.forge_work_planning_process_instances
  (owner_id, id, work_package_id, template_version, template_step_id, status, submitted_by, created_by, updated_by)
select p.owner_id,
       'forge_ppi_' || replace(gen_random_uuid()::text, '-', ''),
       p.id,
       p.planning_template_version,
       t.step_key,
       'In-Progress',
       null,
       'system',
       'system'
  from public.forge_work_packages p
  join public.forge_work_planning_process_template t
    on t.version = p.planning_template_version
  where p.planning_template_version is not null
    and not exists (
      select 1 from public.forge_work_planning_process_instances i
      where i.owner_id = p.owner_id
        and i.work_package_id = p.id
        and i.template_step_id = t.step_key
    );

-- ---------------------------------------------------------------------------
-- 11. RPC: forge_work_planning_process_set_complexity — the only
--     complexity write path (F5, fix round 1).
--
-- Complexity is no longer updated by a client-side revisions insert
-- (recordPlanningComplexityChange) or a best-effort generic package
-- PATCH: it changes here, in one transaction, with the
-- complexity_change event appended. Actor, workspace, package and
-- permission are derived server-side (auth.uid() +
-- has_workspace_access / has_planner_permission planner.packages.edit);
-- browser-supplied actor values are ignored. Optimistic concurrency
-- is mandatory (p_expected_version must be a positive integer; a
-- stale version is WPP10_STALE_VERSION, 409) and p_request_id is
-- mandatory, nonempty and <= 128 chars; reuse with a different
-- payload is WPP10_REQUEST_ID_CONFLICT. A complexity value equal to
-- the current one is a no-op (returns the package row, no revision).
-- A terminal package (cancelled / verified_closed) cannot change.
-- Complexity events have template_step_id NULL, so the revisions
-- unique index (which treats NULLs as distinct) cannot enforce
-- request-id idempotency for them — the RPC checks explicitly.
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_planning_process_set_complexity(
  p_owner_id text,
  p_package_id text,
  p_complexity text,
  p_expected_version integer default null,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_is_owner boolean;
  v_pkg public.forge_work_packages%rowtype;
  v_request_id text;
  v_old_complexity text;
  v_prev_complexity text;
begin
  -- Entry guard: a reader with only .read gets the honest
  -- COMPLEXITY_FORBIDDEN (403), not a WORKSPACE_FORBIDDEN (404)
  -- for a package they can plainly see; a true stranger still gets
  -- WORKSPACE_FORBIDDEN, so existence is never leaked to them.
  if not (public.has_workspace_access(p_owner_id)
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.read')
          or public.has_planner_permission(p_owner_id, 'planner.packages.edit')) then
    raise exception 'WPP10_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP10_INVALID_ACTOR';
  end if;
  v_is_owner := public.has_workspace_access(p_owner_id);

  if p_complexity is null or p_complexity not in ('low', 'standard', 'mid', 'high', 'h_high') then
    raise exception 'WPP10_INVALID_COMPLEXITY';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'WPP10_EXPECTED_VERSION_REQUIRED';
  end if;
  v_request_id := nullif(btrim(coalesce(p_request_id, '')), '');
  if v_request_id is null then
    raise exception 'WPP10_REQUEST_ID_REQUIRED';
  end if;
  if char_length(v_request_id) > 128 then
    raise exception 'WPP10_INVALID_REQUEST_ID';
  end if;

  if not (v_is_owner
          or public.has_planner_permission(p_owner_id, 'planner.packages.edit')) then
    raise exception 'WPP10_COMPLEXITY_FORBIDDEN';
  end if;

  select * into v_pkg
    from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
    for update;
  if v_pkg.id is null then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg.status in ('cancelled', 'verified_closed') then
    raise exception 'WPP10_PACKAGE_TERMINAL';
  end if;

  -- Explicit idempotency: complexity events have template_step_id
  -- NULL, so the revisions unique index cannot enforce request-id
  -- uniqueness for them. A replay with the same payload returns the
  -- current package row; reuse with a different payload is a
  -- conflict.
  select new_values ->> 'complexity'
    into v_prev_complexity
    from public.forge_work_planning_process_revisions r
    where r.owner_id = p_owner_id
      and r.work_package_id = p_package_id
      and r.template_step_id is null
      and r.action = 'complexity_change'
      and r.request_id = v_request_id;
  if v_prev_complexity is not null then
    if v_prev_complexity = p_complexity then
      return row_to_json(v_pkg)::jsonb;
    end if;
    raise exception 'WPP10_REQUEST_ID_CONFLICT';
  end if;

  v_old_complexity := v_pkg.planning_complexity;

  -- Conditional UPDATE on the version: a stale expected version is
  -- a 409, never a silent overwrite. Checked before the no-op return
  -- so a stale caller cannot claim success on a version they never
  -- read.
  if p_expected_version <> v_pkg.version then
    raise exception 'WPP10_STALE_VERSION: expected version %, current version %', p_expected_version, v_pkg.version;
  end if;

  -- A value equal to the current one is a no-op: return the package
  -- row, no revision, no version bump.
  if v_old_complexity = p_complexity then
    return row_to_json(v_pkg)::jsonb;
  end if;

  update public.forge_work_packages
    set planning_complexity = p_complexity,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now()
    where owner_id = p_owner_id and id = v_pkg.id
      and version = p_expected_version
    returning * into v_pkg;
  if v_pkg is null then
    raise exception 'WPP10_STALE_VERSION: expected version %, current version has moved', p_expected_version;
  end if;

  insert into public.forge_work_planning_process_revisions
    (owner_id, id, instance_id, work_package_id, template_step_id, actor_id, action,
     old_status, new_status, reason, evidence_reference, evidence_digest, attestation,
     is_override, request_id, old_values, new_values)
  values (
    p_owner_id,
    'forge_ppr_' || replace(gen_random_uuid()::text, '-', ''),
    null,
    p_package_id,
    null,
    v_actor,
    'complexity_change',
    null,
    null,
    null,
    null,
    null,
    null,
    false,
    v_request_id,
    jsonb_build_object('complexity', v_old_complexity),
    jsonb_build_object('complexity', p_complexity)
  );

  return row_to_json(v_pkg)::jsonb;
end;
$$;

revoke all on function public.forge_work_planning_process_set_complexity(text, text, text, integer, text) from public, anon, service_role;
grant execute on function public.forge_work_planning_process_set_complexity(text, text, text, integer, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. RPC: forge_work_planning_process_update_package — the single
--     transaction for a combined package save (fix round 2, P1-A).
--
-- The edit form sends planning complexity together with unrelated
-- package fields. Applying the complexity first through its own RPC
-- and the fields after through a generic UPDATE is TWO transactions:
-- a property/validation/version failure after the complexity commit
-- left complexity changed and the version advanced while the save
-- reported failure. This RPC is the one write path for a save that
-- carries a complexity change: it locks the package row, checks the
-- expected version, applies the field updates AND the complexity
-- change AND the complexity_change audit event in ONE transaction —
-- any failure rolls all of it back. A save with no complexity
-- change keeps the existing single generic UPDATE (already one
-- transaction); it never calls this RPC.
--
-- p_updates is the service-resolved, service-validated field payload
-- (EDITABLE_FIELDS only, planning_complexity stripped — complexity
-- travels only via p_complexity; status/code/percent_complete are
-- never accepted here). Only keys PRESENT in p_updates are touched;
-- an explicit JSON null clears the column. The RPC re-enforces the
-- server-side invariants a direct caller could bypass: the enum
-- lists for mode/package_type/priority/progress_basis, ISO date
-- shape, and the merged-candidate date-order and earned/planned
-- range rules (checked on the updated row before the event insert,
-- so a violation rolls the whole save back). percent_complete is
-- derived server-side from the merged row (same rules as
-- derivePercentComplete in the application domain), never taken from
-- the payload. The capability gate is the complexity gate
-- (owner/co-owner or planner.packages.edit) — the same authority
-- the standalone complexity RPC requires, so this RPC never widens
-- who may change complexity; plain edits by other callers keep the
-- RLS-gated generic path. A complexity value equal to the current
-- value writes no audit event (a no-op complexity with field
-- updates still applies the fields and bumps the version once).
-- ---------------------------------------------------------------------------

create or replace function public.forge_work_planning_process_update_package(
  p_owner_id text,
  p_package_id text,
  p_expected_version integer,
  p_request_id text,
  p_complexity text,
  p_updates jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  v_actor text;
  v_is_owner boolean;
  v_pkg public.forge_work_packages%rowtype;
  v_request_id text;
  v_old_complexity text;
  v_prev_complexity text;
  v_pct numeric;
begin
  if not (public.has_workspace_access(p_owner_id)
          or public.has_planner_permission(p_owner_id, 'planner.planning_steps.read')
          or public.has_planner_permission(p_owner_id, 'planner.packages.edit')) then
    raise exception 'WPP10_WORKSPACE_FORBIDDEN';
  end if;
  v_actor := auth.uid()::text;
  if v_actor is null or btrim(v_actor) = '' then
    raise exception 'WPP10_INVALID_ACTOR';
  end if;
  v_is_owner := public.has_workspace_access(p_owner_id);

  if p_complexity is not null
     and p_complexity not in ('low', 'standard', 'mid', 'high', 'h_high') then
    raise exception 'WPP10_INVALID_COMPLEXITY';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'WPP10_EXPECTED_VERSION_REQUIRED';
  end if;
  v_request_id := nullif(btrim(coalesce(p_request_id, '')), '');
  if v_request_id is null then
    raise exception 'WPP10_REQUEST_ID_REQUIRED';
  end if;
  if char_length(v_request_id) > 128 then
    raise exception 'WPP10_INVALID_REQUEST_ID';
  end if;

  if not (v_is_owner
          or public.has_planner_permission(p_owner_id, 'planner.packages.edit')) then
    raise exception 'WPP10_COMPLEXITY_FORBIDDEN';
  end if;

  -- Field-level enum/date-shape guards, before any write. The lists
  -- mirror the application domain (src/domains/work-management/
  -- workPackage.js: WP_MODES / WP_PACKAGE_TYPES / WP_PRIORITIES /
  -- WP_PROGRESS_BASES); the service validates the merged candidate
  -- first, this is the server-side backstop for direct callers.
  if p_updates is not null then
    if (p_updates ? 'mode') and (p_updates->>'mode') is not null
       and (p_updates->>'mode') not in ('industrial', 'commercial') then
      raise exception 'WPP10_INVALID_PACKAGE_UPDATE: mode must be industrial or commercial';
    end if;
    if (p_updates ? 'package_type') and (p_updates->>'package_type') is not null
       and (p_updates->>'package_type') not in ('remodel', 'rental_turn', 'maintenance_repair', 'new_construction_phase', 'engineering', 'industrial', 'capital_project', 'other') then
      raise exception 'WPP10_INVALID_PACKAGE_UPDATE: unknown package_type';
    end if;
    if (p_updates ? 'priority') and (p_updates->>'priority') is not null
       and (p_updates->>'priority') not in ('low', 'normal', 'high', 'critical') then
      raise exception 'WPP10_INVALID_PACKAGE_UPDATE: unknown priority';
    end if;
    if (p_updates ? 'progress_basis') and (p_updates->>'progress_basis') is not null
       and (p_updates->>'progress_basis') not in ('quantity', 'manhours', 'milestone_weights', 'manual') then
      raise exception 'WPP10_INVALID_PACKAGE_UPDATE: unknown progress_basis';
    end if;
    if (p_updates ? 'planned_start') and (p_updates->>'planned_start') is not null
       and (p_updates->>'planned_start') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'WPP10_INVALID_PACKAGE_UPDATE: planned_start must be YYYY-MM-DD';
    end if;
    if (p_updates ? 'planned_finish') and (p_updates->>'planned_finish') is not null
       and (p_updates->>'planned_finish') !~ '^\d{4}-\d{2}-\d{2}$' then
      raise exception 'WPP10_INVALID_PACKAGE_UPDATE: planned_finish must be YYYY-MM-DD';
    end if;
  end if;

  select * into v_pkg
    from public.forge_work_packages
    where owner_id = p_owner_id and id = p_package_id
    for update;
  if v_pkg.id is null then
    raise exception 'WPP10_PACKAGE_NOT_FOUND';
  end if;
  if v_pkg.status in ('cancelled', 'verified_closed') then
    raise exception 'WPP10_PACKAGE_TERMINAL';
  end if;

  -- Complexity idempotency (same rule as the standalone complexity
  -- RPC): a replay with the same complexity returns the current row;
  -- reuse with a different complexity is a conflict. Only applies
  -- when this save carries a complexity change.
  if p_complexity is not null then
    select new_values ->> 'complexity'
      into v_prev_complexity
      from public.forge_work_planning_process_revisions r
      where r.owner_id = p_owner_id
        and r.work_package_id = p_package_id
        and r.template_step_id is null
        and r.action = 'complexity_change'
        and r.request_id = v_request_id;
    if v_prev_complexity is not null then
      if v_prev_complexity = p_complexity then
        return row_to_json(v_pkg)::jsonb;
      end if;
      raise exception 'WPP10_REQUEST_ID_CONFLICT';
    end if;
  end if;

  v_old_complexity := v_pkg.planning_complexity;

  -- Conditional UPDATE on the version: the atomic guard. Zero rows
  -- means another writer moved the package since the caller's read
  -- — a 409, and (because the complexity event is inserted after
  -- this statement in the same transaction) nothing is left behind.
  update public.forge_work_packages
    set title = case when p_updates ? 'title' then (p_updates->>'title') else title end,
        description = case when p_updates ? 'description' then (p_updates->>'description') else description end,
        package_type = case when p_updates ? 'package_type' then (p_updates->>'package_type') else package_type end,
        priority = case when p_updates ? 'priority' then (p_updates->>'priority') else priority end,
        project_id = case when p_updates ? 'project_id' then (p_updates->>'project_id') else project_id end,
        property_id = case when p_updates ? 'property_id' then (p_updates->>'property_id') else property_id end,
        responsible_party = case when p_updates ? 'responsible_party' then (p_updates->'responsible_party')::jsonb else responsible_party end,
        planned_start = case when p_updates ? 'planned_start' then (p_updates->>'planned_start')::date else planned_start end,
        planned_finish = case when p_updates ? 'planned_finish' then (p_updates->>'planned_finish')::date else planned_finish end,
        asset_id = case when p_updates ? 'asset_id' then (p_updates->>'asset_id') else asset_id end,
        equipment_tag = case when p_updates ? 'equipment_tag' then (p_updates->>'equipment_tag') else equipment_tag end,
        unit = case when p_updates ? 'unit' then (p_updates->>'unit') else unit end,
        area = case when p_updates ? 'area' then (p_updates->>'area') else area end,
        system = case when p_updates ? 'system' then (p_updates->>'system') else system end,
        location_id = case when p_updates ? 'location_id' then (p_updates->>'location_id') else location_id end,
        work_order_ref = case when p_updates ? 'work_order_ref' then (p_updates->>'work_order_ref') else work_order_ref end,
        workscope_code = case when p_updates ? 'workscope_code' then (p_updates->>'workscope_code') else workscope_code end,
        mode = case when p_updates ? 'mode' then (p_updates->>'mode') else mode end,
        planned_qty = case when p_updates ? 'planned_qty' then (p_updates->>'planned_qty')::numeric else planned_qty end,
        planned_unit = case when p_updates ? 'planned_unit' then (p_updates->>'planned_unit') else planned_unit end,
        planned_manhours = case when p_updates ? 'planned_manhours' then (p_updates->>'planned_manhours')::numeric else planned_manhours end,
        earned_qty = case when p_updates ? 'earned_qty' then (p_updates->>'earned_qty')::numeric else earned_qty end,
        earned_manhours = case when p_updates ? 'earned_manhours' then (p_updates->>'earned_manhours')::numeric else earned_manhours end,
        actual_manhours = case when p_updates ? 'actual_manhours' then (p_updates->>'actual_manhours')::numeric else actual_manhours end,
        progress_basis = case when p_updates ? 'progress_basis' then (p_updates->>'progress_basis') else progress_basis end,
        progress_updated_by = case when p_updates ? 'progress_updated_by' then (p_updates->>'progress_updated_by') else progress_updated_by end,
        source_system = case when p_updates ? 'source_system' then (p_updates->>'source_system') else source_system end,
        source_record_id = case when p_updates ? 'source_record_id' then (p_updates->>'source_record_id') else source_record_id end,
        planning_complexity = case when p_complexity is null then planning_complexity else p_complexity end,
        version = version + 1,
        updated_by = v_actor,
        updated_at = now(),
        progress_updated_at = now()
    where owner_id = p_owner_id and id = v_pkg.id
      and version = p_expected_version
    returning * into v_pkg;
  if v_pkg is null then
    raise exception 'WPP10_STALE_VERSION: expected version %, current version has moved', p_expected_version;
  end if;

  -- Merged-candidate invariants, checked on the updated row BEFORE
  -- the audit event is inserted: a violation rolls the field updates
  -- AND the (not-yet-inserted) event back together. The service
  -- validates the merged candidate first; this is the server-side
  -- backstop for direct callers.
  if v_pkg.planned_start is not null and v_pkg.planned_finish is not null
     and v_pkg.planned_finish < v_pkg.planned_start then
    raise exception 'WPP10_INVALID_PACKAGE_UPDATE: planned_finish must be on or after planned_start';
  end if;
  if v_pkg.earned_qty is not null and v_pkg.planned_qty is not null
     and (v_pkg.earned_qty < 0 or v_pkg.earned_qty > v_pkg.planned_qty) then
    raise exception 'WPP10_INVALID_PACKAGE_UPDATE: earned_qty must be within 0..planned_qty';
  end if;
  if v_pkg.earned_manhours is not null and v_pkg.planned_manhours is not null
     and (v_pkg.earned_manhours < 0 or v_pkg.earned_manhours > v_pkg.planned_manhours) then
    raise exception 'WPP10_INVALID_PACKAGE_UPDATE: earned_manhours must be within 0..planned_manhours';
  end if;

  -- The complexity audit event, in the same transaction as the
  -- update above: no event without the change, no change without
  -- the event. A complexity equal to the current value writes no
  -- event (a no-op complexity with field updates still applies the
  -- fields and bumps the version once).
  if p_complexity is not null and v_old_complexity <> p_complexity then
    insert into public.forge_work_planning_process_revisions
      (owner_id, id, instance_id, work_package_id, template_step_id, actor_id, action,
       old_status, new_status, reason, evidence_reference, evidence_digest, attestation,
       is_override, request_id, old_values, new_values)
    values (
      p_owner_id,
      'forge_ppr_' || replace(gen_random_uuid()::text, '-', ''),
      null,
      p_package_id,
      null,
      v_actor,
      'complexity_change',
      null,
      null,
      null,
      null,
      null,
      null,
      false,
      v_request_id,
      jsonb_build_object('complexity', v_old_complexity),
      jsonb_build_object('complexity', p_complexity)
    );
  end if;

  -- percent_complete is derived server-side from the merged row
  -- (same rules as derivePercentComplete in the application domain):
  -- quantity/manhours bases divide earned by planned; milestone
  -- weights/manual keep the stored value, clamped 0..100; anything
  -- else is null (unknown, never zero-by-default).
  v_pct := case
    when v_pkg.progress_basis = 'quantity'
      and v_pkg.planned_qty is not null and v_pkg.planned_qty > 0
      and v_pkg.planned_unit is not null and v_pkg.earned_qty is not null
      then least(100, greatest(0, round((v_pkg.earned_qty / v_pkg.planned_qty * 100)::numeric, 1)))
    when v_pkg.progress_basis = 'manhours'
      and v_pkg.planned_manhours is not null and v_pkg.planned_manhours > 0
      and v_pkg.earned_manhours is not null
      then least(100, greatest(0, round((v_pkg.earned_manhours / v_pkg.planned_manhours * 100)::numeric, 1)))
    when v_pkg.progress_basis in ('milestone_weights', 'manual')
      and v_pkg.percent_complete is not null
      then least(100, greatest(0, round(v_pkg.percent_complete::numeric, 1)))
    else null
  end;
  if v_pct is distinct from v_pkg.percent_complete then
    update public.forge_work_packages
      set percent_complete = v_pct
      where owner_id = p_owner_id and id = v_pkg.id
      returning * into v_pkg;
  end if;

  return row_to_json(v_pkg)::jsonb;
end;
$$;

revoke all on function public.forge_work_planning_process_update_package(text, text, integer, text, text, jsonb) from public, anon, service_role;
grant execute on function public.forge_work_planning_process_update_package(text, text, integer, text, text, jsonb) to authenticated;
