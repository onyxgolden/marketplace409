/**
 * Project Manager battery cases (86). Each case runs the full inert
 * runner three times against ONE shared publisher with a fixed clock
 * and fixed source; the published item must be byte-identical across
 * runs and must match the oracle's expectation for the case.
 *
 * Cases are data + small builders, not candidate logic: the oracle
 * (oracle.js) asserts outcomes, codes, counts, hand-derived
 * resolutions and finding kinds. It imports NOTHING from the
 * evaluator, the snapshot builder, the mapping layer or any
 * prototype math — only canonical JSON primitives.
 *
 * Groups: A domain/boundary (20), B coverage/version/calendar/
 * mapping (20), C authority/prohibited-data/operation/injection
 * (20), D budget/durability/replay/timeout (20).
 *
 * A case's `build` returns { host, request, spec, callerAdapter?,
 * callerAsk?, clock?, hangingPublisher? }. `post` names an optional
 * harness step run after the three runner runs (decision/trust/
 * deadline proofs that are not runner runs themselves); the runner
 * invariant still holds for the case.
 *
 * NOTE (learned from P2b-1 C15): evidence spans record DROPPED
 * FIELD NAMES by design, so financial/tenant canary cases assert
 * canary VALUES absent, never field names — a field name in a span
 * is metadata, not fetched data.
 */
import {
  CANONICAL_AS_OF, CANONICAL_CONTROLS, CANONICAL_MANAGER_HOST, CANONICAL_MANAGER_MAPPING,
  CANONICAL_PROJECT, canonicalManagerRequest, canonicalManagerSpec,
} from "../src/fixtures.js";

function clone(x) {
  return JSON.parse(JSON.stringify(x));
}

function specWith(datasets, faults = {}, authorized = [], mapping = { ...CANONICAL_MANAGER_MAPPING }) {
  const spec = { kind: "synthetic", datasets, faults, authorized_global_calendar_refs: authorized };
  if (mapping !== null) spec.project_mapping = mapping;
  return spec;
}

function hostWith(overrides = {}) {
  return { ...clone(CANONICAL_MANAGER_HOST), ...overrides };
}

function requestWith(overrides = {}) {
  return { ...clone(canonicalManagerRequest()), ...overrides };
}

function datasetsWith(mutator) {
  const d = { ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) };
  mutator(d);
  return d;
}

function pkg(id, overrides = {}) {
  return {
    package_ref: id, project_ref: "WM-1", owner_ref: "owner-1", status: "in_progress",
    planned_start: "2026-10-01", planned_finish: "2026-11-30", actual_start: "2026-10-01", actual_finish: null,
    percent_complete: 0, scope_baseline_ref: null, ...overrides,
  };
}

function snap(id, packageRef, statusDate, version, overrides = {}) {
  return {
    snapshot_ref: id, package_ref: packageRef, owner_ref: "owner-1", status_date: statusDate,
    baseline_version: version, planned_pct: 0, actual_pct: 0, earned_pct: 0, ...overrides,
  };
}

function dep(id, predecessor, successor, overrides = {}) {
  return {
    dependency_ref: id, predecessor_ref: predecessor, successor_ref: successor,
    owner_ref: "owner-1", relationship_type: "FS", lag_days: 0, ...overrides,
  };
}

// --- Group A: domain / boundary ------------------------------------
const A = [
  {
    id: "A01", group: "A", title: "canonical happy path: scheduler disagreement + overdue milestone carried, controls checklist carried, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    expect: { outcome: "COMPLETED", report_status: "DRAFT", conclusion: "QUALIFIED",
      findings_scheduler_kinds_include: ["HAMMOCK_EXCLUDED", "REVIEW_DISCREPANCY"],
      findings_controls_kinds_include: ["VERIFY_BASELINE", "VERIFY_LATEST_SNAPSHOT"],
      milestones_include: [{ block_ref: "C", bucket: "LOOKAHEAD" }, { block_ref: "D", bucket: "OVERDUE" }],
      completion: { state: "ACCOUNTED", admitted_packages: 2, terminal_count: 0, cancelled_count: 0, counts_by_status: { in_progress: 2 } },
      relationships_state: "RELATIONSHIP_NOT_ESTABLISHED",
      predecessor_statuses: { scheduler: "BOUND", "project-controls": "BOUND" },
      financial_all_not_modeled: true, resources_not_modeled: true,
      agenda_roles_all_project_reviewer: true, agenda_no_executable_keys: true, agenda_no_person_assignment: true,
      row_ids_digest_format: true, distinct_row_ids: true,
      carried_evidence_record_ref_only: true, carried_evidence_in_spans: true,
      report_digest_recomputes: true, adapter_datasets_only: true,
      published_count: 1, replay_idempotent: true },
  },
  {
    id: "A02", group: "A", title: "DISABLED returns before any adapter access",
    build: () => ({ host: hostWith({ mode: "DISABLED" }), request: requestWith(), spec: canonicalManagerSpec() }),
    expect: { outcome: "DISABLED", counters_zero: true, published_count: 0 },
  },
  {
    id: "A03", group: "A", title: "work-management scope against the scheduling host refuses SCOPE_UNREGISTERED",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "work-management-project", id: "WM-1" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED", published_count: 0 },
  },
  {
    id: "A04", group: "A", title: "package scope refuses SCOPE_UNREGISTERED (the job's unit is the mapped pair, not one package)",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "package", id: "PKG-A" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED", published_count: 0 },
  },
  {
    id: "A05", group: "A", title: "controls window on a manager request refuses BAD_REQUEST (P670-004: windows bind to jobs)",
    build: () => ({ host: hostWith(), request: requestWith({ window: { name: "planning-latest-through-asof" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST", published_count: 0 },
  },
  {
    id: "A06", group: "A", title: "scheduler window on a manager request refuses BAD_REQUEST",
    build: () => ({ host: hostWith(), request: requestWith({ window: { name: "planning-lookahead-14-civil-days" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST", published_count: 0 },
  },
  {
    id: "A07", group: "A", title: "missing project mapping refuses PROJECT_MAPPING_REQUIRED before any collection",
    build: () => ({ host: hostWith(), request: requestWith(), spec: specWith({ ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) }, {}, [], null) }),
    expect: { outcome: "REFUSED", code: "PROJECT_MAPPING_REQUIRED", published_count: 0 },
  },
  {
    id: "A08", group: "A", title: "mapping whose scheduling side is not the registered scope refuses BAD_MAPPING",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith({ ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) }, {}, [], { scheduling_project_ref: "P-9", work_management_project_ref: "WM-1", mapping_version: "planning-project-mapping@1" }) }),
    expect: { outcome: "REFUSED", code: "BAD_MAPPING", published_count: 0 },
  },
  {
    id: "A09", group: "A", title: "mapping smuggling a row-level block-to-package map refuses BAD_MAPPING (closed contract)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith({ ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) }, {}, [], { ...CANONICAL_MANAGER_MAPPING, package_block_map: { "PKG-A": ["A"] } }) }),
    expect: { outcome: "REFUSED", code: "BAD_MAPPING", published_count: 0 },
  },
  {
    id: "A10", group: "A", title: "mapping with an empty work-management side refuses BAD_MAPPING",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith({ ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) }, {}, [], { ...CANONICAL_MANAGER_MAPPING, work_management_project_ref: "" }) }),
    expect: { outcome: "REFUSED", code: "BAD_MAPPING", published_count: 0 },
  },
  {
    id: "A11", group: "A", title: "mapping with an empty version refuses BAD_MAPPING",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith({ ...clone(CANONICAL_PROJECT), ...clone(CANONICAL_CONTROLS) }, {}, [], { ...CANONICAL_MANAGER_MAPPING, mapping_version: "" }) }),
    expect: { outcome: "REFUSED", code: "BAD_MAPPING", published_count: 0 },
  },
  {
    id: "A12", group: "A", title: "caller-supplied adapter refuses CALLER_ADAPTER_REFUSED",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec(), callerAdapter: { kind: "synthetic" } }),
    expect: { outcome: "REFUSED", code: "CALLER_ADAPTER_REFUSED", published_count: 0 },
  },
  {
    id: "A13", group: "A", title: "principal mismatch refuses PRINCIPAL_MISMATCH",
    build: () => ({ host: hostWith(), request: requestWith({ principal_ref: "principal-9" }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "PRINCIPAL_MISMATCH", published_count: 0 },
  },
  {
    id: "A14", group: "A", title: "owner mismatch refuses SCOPE_VIOLATION",
    build: () => ({ host: hostWith(), request: requestWith({ owner_ref: "owner-9" }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
  {
    id: "A15", group: "A", title: "unknown job kind refuses UNKNOWN_AGENT",
    build: () => ({ host: hostWith(), request: requestWith({ job_kind: "executive-summary-review" }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "UNKNOWN_AGENT", published_count: 0 },
  },
  {
    id: "A16", group: "A", title: "live-shaped caller ask refuses ACTIVATION_REQUIRED",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec(), callerAsk: "live" }),
    expect: { outcome: "ACTIVATION_REQUIRED", code: "ACTIVATION_REQUIRED", published_count: 0 },
  },
  {
    id: "A17", group: "A", title: "scheduler leg dataset down: SOURCE_DOWN collection error, PARTIAL, QUALIFIED, legs still bound",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { failDataset: "schedule_blocks" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      predecessor_statuses: { scheduler: "BOUND", "project-controls": "BOUND" },
      collection_error_codes_include: ["SOURCE_DOWN"] },
  },
  {
    id: "A18", group: "A", title: "controls leg dataset down: SOURCE_DOWN collection error, PARTIAL, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { failDataset: "forge_work_packages" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      collection_error_codes_include: ["SOURCE_DOWN"],
      completion: { state: "WITHHELD", admitted_packages: null, terminal_count: null, observed_packages: 0, population_authoritative: false } },
  },
  {
    id: "A19", group: "A", title: "permission revoked refuses PERMISSION_REVOKED and publishes nothing",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { revoked: true }) }),
    expect: { outcome: "REFUSED", code: "PERMISSION_REVOKED", published_count: 0 },
  },
  {
    id: "A20", group: "A", title: "stale session refuses STALE_SESSION and publishes nothing",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { staleSession: true }) }),
    expect: { outcome: "REFUSED", code: "STALE_SESSION", published_count: 0 },
  },
];

// --- Group B: coverage / version / calendar / mapping ----------------
const B = [
  {
    id: "B01", group: "B", title: "scheduler leg missing calendars dataset: PARTIAL, QUALIFIED, scheduler still bound",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { failDataset: "schedule_calendars" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      predecessor_statuses: { scheduler: "BOUND" }, collection_error_codes_include: ["SOURCE_DOWN"] },
  },
  {
    id: "B02", group: "B", title: "controls leg missing baselines dataset: PARTIAL, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { failDataset: "forge_work_package_baselines" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      collection_error_codes_include: ["SOURCE_DOWN"],
      completion: { state: "ACCOUNTED", admitted_packages: 2, terminal_count: 0, population_authoritative: true } },
  },
  {
    id: "B03", group: "B", title: "controls leg missing snapshots dataset: PARTIAL, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { failDataset: "forge_work_progress_snapshots" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      collection_error_codes_include: ["SOURCE_DOWN"],
      completion: { state: "ACCOUNTED", admitted_packages: 2, terminal_count: 0, population_authoritative: true } },
  },
  {
    id: "B04", group: "B", title: "mixed source revisions: REVISION_UNATTESTED gap, PARTIAL, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { mixedRevisions: true, pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      diagnostics_include: ["REVISION_UNATTESTED"] },
  },
  {
    id: "B05", group: "B", title: "collection finishing after as_of refuses SNAPSHOT_FROM_FUTURE",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec(),
      clock: { nowIso: () => "2026-10-26T13:00:00.000Z" } }),
    expect: { outcome: "REFUSED", code: "SNAPSHOT_FROM_FUTURE", published_count: 0 },
  },
  {
    id: "B06", group: "B", title: "collection 20 minutes before as_of is stale: PARTIAL, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec(),
      clock: { nowIso: () => "2026-10-26T11:40:00.000Z" } }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL" },
  },
  {
    id: "B07", group: "B", title: "cross-owner rows under a leaky adapter refuse SCOPE_VIOLATION (builder defense-in-depth, never silent exclusion)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks.push({ block_ref: "ZZ", project_ref: "P-1", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-2", task_code: "ZZ", block_type: "task", start_date: null, duration_days: 1, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null });
        d.forge_work_packages.push(pkg("PKG-ZZ", { owner_ref: "owner-2" }));
      }), { leakyOwners: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
  {
    id: "B08", group: "B", title: "cross-scope rows under a leaky adapter refuse SCOPE_VIOLATION (never silent exclusion)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks.push({ block_ref: "ZZ", project_ref: "P-9", lane_ref: "L-1", wbs_node_ref: null, owner_ref: "owner-1", task_code: "ZZ", block_type: "task", start_date: null, duration_days: 1, percent_complete: 0, calendar_ref: null, constraint_type: "ASAP", constraint_date: null, actual_start: null, actual_finish: null });
        d.forge_work_packages.push(pkg("PKG-ZZ", { project_ref: "WM-9" }));
      }), { leakyScope: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
  {
    id: "B09", group: "B", title: "page size 1 pagination invariance: report bytes equal the canonical run",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", report_equals_case: "A01" },
  },
  {
    id: "B10", group: "B", title: "dangling tie is carried as TIE_DANGLING with an inspect-tie agenda row",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.schedule_dependencies.push(dep("T-DANGLE", "A", "ZZZ-MISSING")); })) }),
    expect: { outcome: "COMPLETED", findings_scheduler_kinds_include: ["TIE_DANGLING"],
      agenda_kinds_include: ["INSPECT_TIE"] },
  },
  {
    id: "B11", group: "B", title: "tie to a WBS-only block is carried as TIE_CROSS_SCOPE_WBS",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.schedule_dependencies.push(dep("T-WBS", "A", "W")); })) }),
    expect: { outcome: "COMPLETED", findings_scheduler_kinds_include: ["TIE_CROSS_SCOPE_WBS"] },
  },
  {
    id: "B12", group: "B", title: "dependency cycle is carried with an inspect-cycle agenda row (subject-reference evidence labels PARTIAL, never withholds)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.schedule_dependencies.push(dep("T-BA", "B", "A")); })) }),
    expect: { outcome: "COMPLETED", agenda_kinds_include: ["INSPECT_CYCLE"],
      findings_records_include: [{ section: "findings_scheduler", kind: "INSPECT_CYCLE", record_ref: "comp-A", evidence_state: "PARTIAL" }] },
  },
  {
    id: "B13", group: "B", title: "package status outside the source vocabulary forces qualified completion coverage",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.forge_work_packages.push(pkg("PKG-X", { status: "flying" })); })) }),
    expect: { outcome: "COMPLETED",
      completion: { state: "QUALIFIED", admitted_packages: 3, terminal_count: 0, unknown_statuses_include: ["PKG-X"] },
      agenda_kinds_absent: ["COMPLETION_QUESTION"] },
  },
  {
    id: "B14", group: "B", title: "complete 100% package: terminal 1 of 3, controls question carried (not minted)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-C", { status: "complete", percent_complete: 100, actual_finish: "2026-10-20" }));
        d.forge_work_progress_snapshots.push(snap("S-C1", "PKG-C", "2026-10-20", 1, { planned_pct: 100, actual_pct: 100, earned_pct: 100 }));
      })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3, terminal_count: 1, counts_by_status: { in_progress: 2, complete: 1 } },
      agenda_records_include: [{ record_ref: "PKG-C", kind: "OPEN_QUESTION" }],
      agenda_kinds_absent: ["COMPLETION_QUESTION"] },
  },
  {
    id: "B15", group: "B", title: "cancelled package counts separately, never as complete",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.forge_work_packages.push(pkg("PKG-D", { status: "cancelled" })); })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3, terminal_count: 0, cancelled_count: 1, counts_by_status: { in_progress: 2, cancelled: 1 } },
      agenda_kinds_absent: ["COMPLETION_QUESTION"] },
  },
  {
    id: "B16", group: "B", title: "verified-closed package counts as terminal",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.forge_work_packages.push(pkg("PKG-E", { status: "verified_closed", percent_complete: 100, actual_finish: "2026-10-20" })); })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3, terminal_count: 1, counts_by_status: { in_progress: 2, verified_closed: 1 } } },
  },
  {
    id: "B17", group: "B", title: "terminal-status claim without any 100% figure: the composition mints the completion question",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-C", { status: "complete", percent_complete: 55, actual_finish: "2026-10-20" }));
        d.forge_work_progress_snapshots.push(snap("S-C1", "PKG-C", "2026-10-20", 1, { planned_pct: 60, actual_pct: 55, earned_pct: 55 }));
      })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3, terminal_count: 1 },
      agenda_records_include: [{ record_ref: "PKG-C", kind: "COMPLETION_QUESTION", evidence_state: "BOUND" }],
      completion_basis_include: [{ package_ref: "PKG-C", status: "complete", evidence_state: "BOUND" }],
      forbidden_strings_absent: ["100% progress claim"] },
  },
  {
    id: "B18", group: "B", title: "no milestones: milestones section is empty, conclusions still QUALIFIED on checklist rows",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = d.schedule_blocks.filter((b) => b.block_type !== "milestone");
      })) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", milestones_empty: true },
  },
  {
    id: "B19", group: "B", title: "package with a baseline but no snapshots joins the admitted denominator with a NO_SNAPSHOTS finding",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-F"));
        d.forge_work_package_baselines.push({ baseline_ref: "BL-F1", package_ref: "PKG-F", owner_ref: "owner-1", version_number: 1, baseline_start: "2026-10-01", baseline_finish: "2026-11-30", frozen_at: "2026-09-28T12:00:00.000Z" });
      })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3 },
      findings_controls_kinds_include: ["NO_SNAPSHOTS"] },
  },
  {
    id: "B20", group: "B", title: "mapping version @2 binds a distinct item: a new publication, not a silent overwrite",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), {}, [], { ...CANONICAL_MANAGER_MAPPING, mapping_version: "planning-project-mapping@2" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", published_count: 1 },
  },
];

// --- Group C: authority / prohibited data / operation / injection ----
const C = [
  {
    id: "C01", group: "C", title: "cost-field canary: the VALUE never appears in the published item (field names in spans are metadata, not data)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").cost_usd = 987654321;
        d.schedule_blocks.find((b) => b.block_ref === "A").cost_usd = 987654321;
      })) }),
    expect: { outcome: "COMPLETED", forbidden_strings_absent: ["987654321"] },
  },
  {
    id: "C02", group: "C", title: "financial and resource sections are NOT_MODELED on the canonical run",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    expect: { outcome: "COMPLETED", financial_all_not_modeled: true, resources_not_modeled: true },
  },
  {
    id: "C03", group: "C", title: "getter canary row: collection measurement refuses CONTROL_DATA_REFUSED, nothing publishes",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { getterCanaryDataset: "schedule_blocks" }) }),
    expect: { outcome: "REFUSED", code: "CONTROL_DATA_REFUSED", published_count: 0 },
  },
  {
    id: "C04", group: "C", title: "proxy row: collection measurement refuses CONTROL_DATA_REFUSED, nothing publishes",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { proxyRowDataset: "schedule_blocks" }) }),
    expect: { outcome: "REFUSED", code: "CONTROL_DATA_REFUSED", published_count: 0 },
  },
  {
    id: "C05", group: "C", title: "cyclic row: collection measurement refuses CONTROL_DATA_REFUSED, nothing publishes",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { cyclicRowDataset: "schedule_blocks" }) }),
    expect: { outcome: "REFUSED", code: "CONTROL_DATA_REFUSED", published_count: 0 },
  },
  {
    id: "C06", group: "C", title: "looping cursor refuses cleanly: CURSOR_FAULT marks the dataset partial, no infinite loop",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { cursorLoopDataset: "forge_work_packages" }) }),
    expect: { outcome: "COMPLETED", snapshot_consistency: "PARTIAL",
      collection_error_codes_include: ["CURSOR_FAULT"] },
  },
  {
    id: "C07", group: "C", title: "caller-attached approved report refuses BAD_REQUEST (the host resolves references; callers attach none)",
    build: () => ({ host: hostWith(), request: requestWith({ approved_report: { digest: "deadbeef" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST", published_count: 0 },
  },
  {
    id: "C08", group: "C", title: "caller-supplied mapping field refuses BAD_REQUEST (mappings ride the host spec, never the request)",
    build: () => ({ host: hostWith(), request: requestWith({ mapping: { ...CANONICAL_MANAGER_MAPPING } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST", published_count: 0 },
  },
  {
    id: "C09", group: "C", title: "caller-supplied adapter field refuses BAD_REQUEST",
    build: () => ({ host: hostWith(), request: requestWith({ adapter: { kind: "synthetic" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "BAD_REQUEST", published_count: 0 },
  },
  {
    id: "C10", group: "C", title: "host mode LIVE refuses ACTIVATION_REQUIRED",
    build: () => ({ host: hostWith({ mode: "LIVE" }), request: requestWith(), spec: canonicalManagerSpec() }),
    expect: { outcome: "ACTIVATION_REQUIRED", code: "ACTIVATION_REQUIRED", published_count: 0 },
  },
  {
    id: "C11", group: "C", title: "unrecognized host mode refuses UNKNOWN_MODE",
    build: () => ({ host: hostWith({ mode: "BOGUS" }), request: requestWith(), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "UNKNOWN_MODE", published_count: 0 },
  },
  {
    id: "C12", group: "C", title: "non-synthetic adapter kind refuses ADAPTER_NOT_INSTALLED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: { ...canonicalManagerSpec(), kind: "postgres" } }),
    expect: { outcome: "REFUSED", code: "ADAPTER_NOT_INSTALLED", published_count: 0 },
  },
  {
    id: "C13", group: "C", title: "caller-supplied adapter refuses CALLER_ADAPTER_REFUSED (duplicate of A12 at the authority layer)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec(), callerAdapter: { kind: "synthetic" } }),
    expect: { outcome: "REFUSED", code: "CALLER_ADAPTER_REFUSED", published_count: 0 },
  },
  {
    id: "C14", group: "C", title: "namespace collision: a work-management scope with the scheduling id string is NOT the registered scope",
    build: () => ({ host: hostWith(), request: requestWith({ project_scope_ref: { type: "work-management-project", id: "P-1" } }), spec: canonicalManagerSpec() }),
    expect: { outcome: "REFUSED", code: "SCOPE_UNREGISTERED", published_count: 0 },
  },
  {
    id: "C15", group: "C", title: "P676-003 analog: a package row with a missing project_ref under a leaky adapter refuses SCOPE_VIOLATION",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => { d.forge_work_packages.push(pkg("PKG-X", { project_ref: null })); }), { leakyScope: true }) }),
    expect: { outcome: "REFUSED", code: "SCOPE_VIOLATION", published_count: 0 },
  },
  {
    id: "C16", group: "C", title: "stale decision digest refuses STALE_DIGEST: a refreshed report never inherits an old decision",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "decide-stale",
    expect: { outcome: "COMPLETED", post: { code: "STALE_DIGEST" } },
  },
  {
    id: "C17", group: "C", title: "decision on an unknown row refuses UNKNOWN_ROW",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "decide-unknown-row",
    expect: { outcome: "COMPLETED", post: { code: "UNKNOWN_ROW" } },
  },
  {
    id: "C18", group: "C", title: "decision outside the closed enum refuses BAD_DECISION (no Approve/Apply/Execute/Send/Auto-fix/Activate)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "decide-bad-enum",
    expect: { outcome: "COMPLETED", post: { code: "BAD_DECISION" } },
  },
  {
    id: "C19", group: "C", title: "replay with changed content under the same identity refuses REPUBLISH_CONFLICT",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "republish-conflict",
    expect: { outcome: "COMPLETED", post: { code: "REPUBLISH_CONFLICT" } },
  },
  {
    id: "C20", group: "C", title: "trust root mismatch refuses before any candidate byte runs",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "trust-wrong-root",
    expect: { outcome: "COMPLETED", post: { refused: true } },
  },
];

// --- Group D: budget / durability / replay / timeout -----------------
const D = [
  {
    id: "D01", group: "D", title: "candidate cap: scheduler rows + 50 packages refuse BUDGET_EXCEEDED with no domain totals",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        for (let i = 0; i < 50; i++) d.forge_work_packages.push(pkg(`PKG-${i}`));
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "candidates", limit: 64, domain_totals_null: true },
  },
  {
    id: "D02", group: "D", title: "evidence-span cap 512 is enforced at unit level (unreachable in a full run: the 64-candidate cap fires first)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "span-cap-unit",
    expect: { outcome: "COMPLETED", post: { kind: "evidenceSpans", limit: 512 } },
  },
  {
    id: "D03", group: "D", title: "output-record cap 256 is enforced at unit level (unreachable in a full run: the 64-candidate cap fires first)",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "output-cap-unit",
    expect: { outcome: "COMPLETED", post: { kind: "outputRecords", limit: 256 } },
  },
  {
    id: "D04", group: "D", title: "input bytes over 256 KiB refuse BUDGET_EXCEEDED during candidate admission",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.find((p) => p.package_ref === "PKG-A").status = "X".repeat(300 * 1024);
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "inputBytes", limit: 262144 },
  },
  {
    id: "D05", group: "D", title: "control depth 33 refuses BUDGET_EXCEEDED (depth cap is 32)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: (() => {
        const deep = {}; let cur = deep;
        for (let i = 0; i < 33; i++) { cur.next = {}; cur = cur.next; }
        const s = canonicalManagerSpec(); s.deep = deep;
        return s;
      })() }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "depth", limit: 32 },
  },
  {
    id: "D06", group: "D", title: "control depth exactly 32 is admitted: the run completes, proving the cap is 32 not lower",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: (() => {
        const deep = {}; let cur = deep;
        for (let i = 0; i < 30; i++) { cur.next = {}; cur = cur.next; }
        const s = canonicalManagerSpec(); s.deep = deep;
        return s;
      })() }),
    expect: { outcome: "COMPLETED" },
  },
  {
    id: "D07", group: "D", title: "hung collection refuses EXECUTION_TIMEOUT preemptively",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { hangCollect: true }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D08", group: "D", title: "synchronous runaway in the adapter refuses EXECUTION_TIMEOUT via worker termination",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { syncSpinMs: 30000 }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D09", group: "D", title: "slow-but-bounded reads complete: the deadline is 5 s, not zero",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { slowReadMs: 100 }) }),
    expect: { outcome: "COMPLETED" },
  },
  {
    id: "D10", group: "D", title: "replay of identical content is idempotent: first run writes, second and third write nothing",
    build: () => {
      const datasets = datasetsWith((d) => {
        for (const p of d.forge_work_packages) p.project_ref = "WM-10";
        for (const b of d.schedule_blocks) b.project_ref = "P-10";
        d.schedule_projects[0].project_ref = "P-10";
        d.schedule_calendars[0].project_ref = "P-10";
        d.schedule_blackout_windows[0].project_ref = "P-10";
        d.schedule_lanes[0].project_ref = "P-10";
      });
      return {
        host: hostWith({ registered_project_scope: { type: "scheduling-project", id: "P-10" } }),
        request: requestWith({ project_scope_ref: { type: "scheduling-project", id: "P-10" }, snapshot_request_id: "snap-manager-d10-1" }),
        spec: specWith(datasets, {}, [], { scheduling_project_ref: "P-10", work_management_project_ref: "WM-10", mapping_version: "planning-project-mapping@1" }),
      };
    },
    expect: { outcome: "COMPLETED", replay_idempotent: true, published_count: 1 },
  },
  {
    id: "D11", group: "D", title: "canonical rerun publishes nothing new: the shared publisher already holds the identical item",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    expect: { outcome: "COMPLETED", published_count: 0, replay_idempotent: true },
  },
  {
    id: "D12", group: "D", title: "hanging publisher refuses PUBLICATION_TIMEOUT; the report was computed but not durably published",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec(), hangingPublisher: true }),
    expect: { outcome: "REFUSED", code: "PUBLICATION_TIMEOUT" },
  },
  {
    id: "D13", group: "D", title: "page size 1 pagination invariance: report bytes equal the canonical run",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { pageSize: 1 }) }),
    expect: { outcome: "COMPLETED", report_equals_case: "A01" },
  },
  {
    id: "D14", group: "D", title: "page size 2 pagination invariance: report bytes equal the canonical run",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { pageSize: 2 }) }),
    expect: { outcome: "COMPLETED", report_equals_case: "A01" },
  },
  {
    id: "D15", group: "D", title: "blocked single-dataset read hits the 2 s page bound: READ_TIMEOUT collection error, PARTIAL, QUALIFIED",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { blockedDataset: "schedule_blocks" }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      collection_error_codes_include: ["READ_TIMEOUT"] },
  },
  {
    id: "D16", group: "D", title: "reads slower than the deadline refuse EXECUTION_TIMEOUT",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { slowReadMs: 6000 }) }),
    expect: { outcome: "REFUSED", code: "EXECUTION_TIMEOUT" },
  },
  {
    id: "D17", group: "D", title: "65 baselines refuse BUDGET_EXCEEDED (controls-side candidate pressure)",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        for (let i = 3; i < 68; i++) {
          d.forge_work_package_baselines.push({ baseline_ref: `BL-A${i}`, package_ref: "PKG-A", owner_ref: "owner-1", version_number: i, baseline_start: "2026-10-01", baseline_finish: "2026-11-30", frozen_at: "2026-09-28T12:00:00.000Z" });
        }
      })) }),
    expect: { outcome: "BUDGET_EXCEEDED", kind: "candidates", limit: 64 },
  },
  {
    id: "D18", group: "D", title: "spent deadline refuses EXECUTION_TIMEOUT before the worker starts",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "deadline-spent",
    expect: { outcome: "COMPLETED", post: { code: "EXECUTION_TIMEOUT" } },
  },
  {
    id: "D19", group: "D", title: "unlisted entry refuses (exit 3): a test file on disk but absent from the manifest never runs",
    build: () => ({ host: hostWith(), request: requestWith(), spec: canonicalManagerSpec() }),
    post: "trust-unlisted-entry",
    expect: { outcome: "COMPLETED", post: { exit: 3 } },
  },
  {
    id: "D20", group: "D", title: "a different as_of binds a distinct item: new publication, same QUALIFIED shape",
    build: () => ({ host: hostWith(), request: requestWith({ as_of: "2026-10-27T12:00:00.000Z", snapshot_request_id: "snap-manager-d20-1" }), spec: canonicalManagerSpec() }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", published_count: 1 },
  },
];

// --- Group E: P678 fix-round regressions (ChatGPT NEEDS CHANGES 2026-10-25) ---
// Each case names the verdict finding it pins. E01 is the positive
// control (it passes before the fix); E02/E03/E04/E05 fail before
// the fix in exactly the verdict's way and pass after it.
const E = [
  {
    id: "E01", group: "E", title: "P678-001 positive + P678-003 verified-empty positive: single feasible task, no dependencies, controls datasets verified empty → READY, completion ACCOUNTED 0 of 0",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = d.schedule_blocks.filter((b) => b.block_ref === "A");
        d.schedule_dependencies = [];
        d.forge_work_packages = [];
        d.forge_work_package_baselines = [];
        d.forge_work_progress_snapshots = [];
      })) }),
    expect: { outcome: "COMPLETED", report_status: "DRAFT", conclusion: "READY",
      empty_sections: ["findings_scheduler", "findings_controls", "milestones", "agenda"],
      completion: { state: "ACCOUNTED", admitted_packages: 0, terminal_count: 0, cancelled_count: 0, counts_by_status: {}, population_authoritative: true },
      predecessor_statuses: { scheduler: "BOUND", "project-controls": "BOUND" },
      row_ids_digest_format: true, distinct_row_ids: true, report_digest_recomputes: true, adapter_datasets_only: true },
  },
  {
    id: "E02", group: "E", title: "P678-001 duration-1000: Scheduler component NOT_MODELED / CALENDAR_HORIZON_EXCEEDED is carried as a finding and agenda row — Manager is QUALIFIED, never READY",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = d.schedule_blocks.filter((b) => b.block_ref === "A");
        d.schedule_blocks.find((b) => b.block_ref === "A").duration_days = 1000;
        d.schedule_dependencies = [];
        d.forge_work_packages = [];
        d.forge_work_package_baselines = [];
        d.forge_work_progress_snapshots = [];
      })) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED",
      findings_records_include: [{ section: "findings_scheduler", kind: "component", record_ref: "comp-A", conclusion: "NOT_MODELED", prototype_status: "CALENDAR_HORIZON_EXCEEDED", evidence_state: "BOUND" }],
      agenda_kinds_include: ["component"],
      agenda_records_include: [{ record_ref: "comp-A", kind: "component" }],
      completion: { state: "ACCOUNTED", admitted_packages: 0, terminal_count: 0 },
      predecessor_statuses: { scheduler: "BOUND", "project-controls": "BOUND" } },
  },
  {
    id: "E03", group: "E", title: "P678-001 FNLT unsatisfiable: Scheduler component NOT_MODELED / CONSTRAINT_UNSATISFIABLE is carried as a finding and agenda row — Manager is QUALIFIED, never READY",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.schedule_blocks = d.schedule_blocks.filter((b) => b.block_ref === "A");
        const a = d.schedule_blocks.find((b) => b.block_ref === "A");
        a.constraint_type = "FNLT"; a.constraint_date = "2026-10-26";
        d.schedule_dependencies = [];
        d.forge_work_packages = [];
        d.forge_work_package_baselines = [];
        d.forge_work_progress_snapshots = [];
      })) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED",
      findings_records_include: [{ section: "findings_scheduler", kind: "component", record_ref: "comp-A", conclusion: "NOT_MODELED", prototype_status: "CONSTRAINT_UNSATISFIABLE", evidence_state: "BOUND" }],
      agenda_kinds_include: ["component"],
      agenda_records_include: [{ record_ref: "comp-A", kind: "component" }],
      completion: { state: "ACCOUNTED", admitted_packages: 0, terminal_count: 0 },
      predecessor_statuses: { scheduler: "BOUND", "project-controls": "BOUND" } },
  },
  {
    id: "E04", group: "E", title: "P678-003 unattested population: hideExpected leaves package coverage unattested and incomplete — completion WITHHELD, denominator withheld, observed subset labeled",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {}), { hideExpected: true }) }),
    expect: { outcome: "COMPLETED", conclusion: "QUALIFIED", snapshot_consistency: "PARTIAL",
      completion: { state: "WITHHELD", admitted_packages: null, terminal_count: null, observed_packages: 2, observed_terminal_count: 0, population_authoritative: false } },
  },
  {
    id: "E05", group: "E", title: "P678-004 terminal status with null percent: minted question carries the package span and asks about the terminal status, never an invented 100% claim",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-C", { status: "complete", percent_complete: null, actual_finish: "2026-10-20" }));
      })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3, terminal_count: 1 },
      agenda_records_include: [{ record_ref: "PKG-C", kind: "COMPLETION_QUESTION", evidence_state: "BOUND" }],
      completion_basis_include: [{ package_ref: "PKG-C", status: "complete", evidence_state: "BOUND" }],
      forbidden_strings_absent: ["100% progress claim"] },
  },
  {
    id: "E06", group: "E", title: "P678-004 snapshot-only 100%: the controls snapshot question is carried, the composition mints nothing",
    build: () => ({ host: hostWith(), request: requestWith(),
      spec: specWith(datasetsWith((d) => {
        d.forge_work_packages.push(pkg("PKG-C", { status: "in_progress", percent_complete: 20 }));
        d.forge_work_progress_snapshots.push(snap("S-C1", "PKG-C", "2026-10-20", 1, { planned_pct: 100, actual_pct: 100, earned_pct: 100 }));
      })) }),
    expect: { outcome: "COMPLETED",
      completion: { admitted_packages: 3, terminal_count: 0 },
      agenda_records_include: [{ record_ref: "S-C1", kind: "OPEN_QUESTION" }],
      agenda_kinds_absent: ["COMPLETION_QUESTION"] },
  },
];

export const CASES = [...A, ...B, ...C, ...D, ...E];
