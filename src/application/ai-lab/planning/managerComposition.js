/**
 * P2b-3 Project Manager plan-health composition (pure, deterministic).
 *
 * This is a drafting/composition job, NOT a second schedule engine.
 * It composes two predecessor assessment envelopes — the P2b-1
 * Scheduler report and the P2b-2 Project Controls report — for the
 * SAME registered project mapping, plus the current scoped
 * snapshots those envelopes were evaluated from. It computes no
 * schedule math, moves no date, and invents no clock: milestone
 * feasibility references the Scheduler's applicable analysis
 * verbatim, and the elapsed-hour clock of the old PM prototype is
 * explicitly NOT used (its invented clock is incompatible with the
 * Scheduler's civil-day analysis).
 *
 * Binding rules (brief §9, fail-closed):
 * - The host resolves and authenticates report references. The
 *   composition binds each envelope to its snapshot by recomputing
 *   the snapshot digest over {envelope, records}; a digest that
 *   does not recompute, a scope/owner/as_of mismatch, or a missing
 *   or malformed version withholds that leg's findings and all
 *   combined conclusions (conclusion WITHHELD). Unmatched inputs
 *   are LISTED in predecessor_evidence, never silently dropped.
 * - Malformed versions are named distinctly from missing ones
 *   (P677-006 lesson): PREDECESSOR_VERSION_MALFORMED vs
 *   PREDECESSOR_VERSION_MISSING. A version of the wrong value is
 *   PREDECESSOR_VERSION_MISMATCH.
 * - Identity types are distinct (brief §4): a scheduling-project
 *   id is never equated with a work-management-project id even when
 *   the strings match. Only the host-supplied project mapping binds
 *   them; a missing mapping refuses the job outright
 *   (PROJECT_MAPPING_REQUIRED) because the controls leg cannot even
 *   be scoped without it.
 * - Row-level block↔package relationships are NOT_MODELED in this
 *   slice: no authoritative explicit row mapping is registered, so
 *   the relationships section states RELATIONSHIP_NOT_ESTABLISHED
 *   and asserts no join. Any row-level map smuggled into the
 *   mapping object refuses as BAD_MAPPING (closed contract).
 * - Findings are carried separated by source, never averaged away.
 *   A carried row's evidence must use `record_ref` keys (the
 *   P677-007A defect class); a row failing the key-shape check is
 *   withheld and named in a gap, never published with a broken
 *   citation. Span RESOLUTION is labeled, not used to withhold:
 *   evidence_state is BOUND when every citation resolves to an
 *   admitted span, PARTIAL when some do not (the misses are named
 *   in unresolved_evidence), and UNAVAILABLE when the row names
 *   no evidence at all. Withholding on span misses would hide
 *   material findings whose evidence legitimately cites a subject
 *   rather than a row — the Scheduler's INSPECT_CYCLE row cites
 *   its component id in the dependencies dataset, which is not an
 *   admitted span but is not a fictitious row either; the
 *   digest-verified envelope already authenticates the leg's rows,
 *   so the composition carries faithfully and labels resolution
 *   instead of second-guessing the leg and dropping the cycle.
 *   A row with EMPTY evidence is carried with UNAVAILABLE — an
 *   absence finding's absence is itself the finding, and hiding it
 *   would hide a material gap.
 * - Completion is counts of source-defined terminal states over
 *   the authoritative admitted population (controls packages),
 *   with exact numerator/denominator. Terminal = complete +
 *   verified_closed; cancelled is counted separately, never as
 *   complete. Unknown statuses force qualified coverage. No status
 *   is inferred from a percentage, no missing package supplies a
 *   denominator, and scheduler block percents are never averaged
 *   into package completion (unrelated measures). The population
 *   is authoritative only when the controls snapshot's package
 *   dataset is complete and usable with no expected-count
 *   conflict; otherwise the denominator is WITHHELD and observed
 *   counts are labeled as a subset, never an accounted population.
 *   A verified empty population (expected 0, received 0) is
 *   ACCOUNTED 0 of 0 — distinct from an unknown population. The
 *   section carries a bounded source-linked basis (one contributor
 *   per admitted package, citing its package span) and minted
 *   completion questions carry the package's actual status/claim
 *   with its available span evidence.
 * - Every sourced 100% / terminal-status claim carries its
 *   completion question and the unverified-physical-progress
 *   label: a claim is a reported claim, never independently
 *   observed physical completion. A completion-bearing claim
 *   without its question is withheld from the agenda as complete
 *   — the composition mints the question instead of publishing
 *   the claim bare.
 * - The review agenda assigns NO person: responsible_role is the
 *   literal label "project reviewer" on every row, and no row
 *   carries an executable patch, task, or approval payload.
 * - Resource overallocation/leveling is NOT_MODELED; all financial
 *   measures are NOT_MODELED under FINANCIAL_SCOPE_EXCLUDED.
 *
 * Status: always DRAFT. execution_authorized is always false.
 * Accepting this summary creates no work package, enrolls nobody,
 * assigns no work, clears no source gate, and changes no
 * date/status/baseline.
 *
 * Row identity: "pm-" + SHA-256 hex of the canonical tuple
 * [agent, scope type, scope id, section, kind, dataset, record,
 * discriminator] — a digest over the complete tuple, never a raw
 * concatenation (P670-005A lesson). Carried rows mint fresh pm-
 * ids and keep their source row id as source_row_id, so a decision
 * on a composition row addresses the composition, never the leg.
 */

import { canonicalDigest, canonicalJson, sha256Hex } from "../rental-ops/canonical.js";
import { JobRefusal } from "./jobContracts.js";
import { EVALUATOR_VERSION } from "./schedulerAssessment.js";
import { CONTROLS_EVALUATOR_VERSION, PACKAGE_STATUSES } from "./controlsEvidenceAssessment.js";
import { FIELD_MAPPING_VERSION } from "./fieldMappings.js";
import { utcCivilDate } from "./fieldMappings.js";

export const MANAGER_EVALUATOR_VERSION = "planning-manager-evaluator@1";
export const MANAGER_WINDOW = "planning-review-snapshot";
export const MANAGER_SCHEMA = "planning-manager-report@1";

export const TERMINAL_PACKAGE_STATUSES = Object.freeze(["complete", "verified_closed"]);

const FINANCIAL_MEASURES = Object.freeze([
  "planned_value", "earned_value", "actual_cost", "cpi", "spi",
  "monetary_variance", "eac", "etc", "contingency",
]);

export function managerRowId(tuple) {
  return `pm-${sha256Hex(canonicalJson(tuple))}`;
}

function rowIdFor({ agent, scope, section, kind, dataset, record, discriminator = "" }) {
  return managerRowId([agent, scope.type, scope.id, section, kind, dataset, record, discriminator]);
}

function isNonEmptyString(v) {
  return typeof v === "string" && v.length > 0;
}

function isPositiveInteger(v) {
  return Number.isInteger(v) && v >= 1;
}

/**
 * Validate the host-supplied project mapping (closed shape).
 * Missing mapping refuses PROJECT_MAPPING_REQUIRED; any malformed
 * field, any row-level map, or a scheduling side that is not the
 * requested scope refuses BAD_MAPPING.
 */
export function validateProjectMapping(mapping, scopeId) {
  if (mapping === undefined || mapping === null) {
    throw new JobRefusal("PROJECT_MAPPING_REQUIRED", "no registered project mapping: the composition cannot bind a scheduling project to a work-management project without one");
  }
  if (typeof mapping !== "object" || Array.isArray(mapping)) {
    throw new JobRefusal("BAD_MAPPING", "project mapping must be an object");
  }
  const allowed = new Set(["scheduling_project_ref", "work_management_project_ref", "mapping_version"]);
  for (const key of Object.keys(mapping)) {
    if (!allowed.has(key)) {
      throw new JobRefusal("BAD_MAPPING", `project mapping carries unknown field '${key}' — the mapping contract is closed; row-level maps are not registered in this slice`);
    }
  }
  if (!isNonEmptyString(mapping.scheduling_project_ref)) {
    throw new JobRefusal("BAD_MAPPING", "project mapping scheduling_project_ref must be a non-empty string");
  }
  if (!isNonEmptyString(mapping.work_management_project_ref)) {
    throw new JobRefusal("BAD_MAPPING", "project mapping work_management_project_ref must be a non-empty string");
  }
  if (!isNonEmptyString(mapping.mapping_version)) {
    throw new JobRefusal("BAD_MAPPING", "project mapping mapping_version must be a non-empty string");
  }
  if (mapping.scheduling_project_ref !== scopeId) {
    throw new JobRefusal("BAD_MAPPING", "project mapping scheduling side does not match the requested scheduling-project scope");
  }
  return {
    scheduling_project_ref: mapping.scheduling_project_ref,
    work_management_project_ref: mapping.work_management_project_ref,
    mapping_version: mapping.mapping_version,
  };
}

/** Split a snapshot into {envelope, records} exactly as the snapshot builder digests it. */
function snapshotEnvelopeAndRecords(snapshot) {
  const { digest, records, evidence, ...envelope } = snapshot;
  return { envelope, records };
}

function recomputedSnapshotDigest(snapshot) {
  const { envelope, records } = snapshotEnvelopeAndRecords(snapshot);
  return canonicalDigest({ envelope, records });
}

/**
 * Bind one predecessor envelope to its snapshot. Returns
 * { bound, gaps, identity } where gaps is a list of { code, detail }
 * and identity carries the fields the report's predecessor_evidence
 * row needs. A leg with ANY gap is unbound: none of its findings
 * are carried and combined conclusions are withheld.
 */
function bindLeg({ agent, expectedSchema, expectedJobKind, expectedScope, report, snapshot, request }) {
  const gaps = [];
  const identity = {
    agent, schema_version: null, job_version: null, snapshot_digest: null,
    digest_verified: false, as_of_match: false, scope_match: false, owner_match: false,
  };
  const gap = (code, detail) => gaps.push({ code, detail });
  if (!report || typeof report !== "object" || Array.isArray(report)) {
    gap("PREDECESSOR_MALFORMED", `${agent} envelope is not an object`);
    return { bound: false, gaps, identity };
  }
  if (report.agent !== agent) gap("PREDECESSOR_AGENT_MISMATCH", `${agent} envelope carries agent '${String(report.agent)}'`);
  if (report.job_kind !== expectedJobKind) gap("PREDECESSOR_JOB_MISMATCH", `${agent} envelope carries job_kind '${String(report.job_kind)}'`);
  if (report.schema_version === undefined || report.schema_version === null) {
    gap("PREDECESSOR_VERSION_MISSING", `${agent} envelope is missing schema_version`);
  } else if (typeof report.schema_version !== "string") {
    gap("PREDECESSOR_VERSION_MALFORMED", `${agent} envelope schema_version is not a string`);
  } else if (report.schema_version !== expectedSchema) {
    gap("PREDECESSOR_VERSION_MISMATCH", `${agent} envelope schema_version '${report.schema_version}' !== expected '${expectedSchema}'`);
  } else {
    identity.schema_version = report.schema_version;
  }
  if (report.job_version === undefined || report.job_version === null) {
    gap("PREDECESSOR_VERSION_MISSING", `${agent} envelope is missing job_version`);
  } else if (!isPositiveInteger(report.job_version)) {
    gap("PREDECESSOR_VERSION_MALFORMED", `${agent} envelope job_version '${String(report.job_version)}' is not a positive integer`);
  } else if (report.job_version !== 1) {
    gap("PREDECESSOR_VERSION_MISMATCH", `${agent} envelope job_version ${report.job_version} !== expected 1`);
  } else {
    identity.job_version = report.job_version;
  }
  if (report.owner_ref !== request.owner_ref) {
    gap("PREDECESSOR_OWNER_MISMATCH", `${agent} envelope owner '${String(report.owner_ref)}' !== requested owner '${String(request.owner_ref)}'`);
  } else {
    identity.owner_match = true;
  }
  const scope = report.project_scope_ref ?? {};
  if (scope.type !== expectedScope.type || scope.id !== expectedScope.id) {
    gap("PREDECESSOR_SCOPE_MISMATCH", `${agent} envelope scope '${String(scope.type)}:${String(scope.id)}' !== expected '${expectedScope.type}:${expectedScope.id}'`);
  } else {
    identity.scope_match = true;
  }
  if (report.as_of !== request.as_of) {
    gap("PREDECESSOR_STALE", `${agent} envelope as_of '${String(report.as_of)}' !== requested as_of '${String(request.as_of)}'`);
  } else {
    identity.as_of_match = true;
  }
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    gap("PREDECESSOR_SNAPSHOT_MISSING", `${agent} predecessor snapshot is missing`);
    return { bound: false, gaps, identity };
  }
  const snapScope = snapshot.project_scope_ref ?? {};
  if (snapScope.type !== expectedScope.type || snapScope.id !== expectedScope.id) {
    gap("PREDECESSOR_SCOPE_MISMATCH", `${agent} snapshot scope '${String(snapScope.type)}:${String(snapScope.id)}' !== expected '${expectedScope.type}:${expectedScope.id}'`);
  }
  if (snapshot.as_of !== request.as_of) {
    gap("PREDECESSOR_STALE", `${agent} snapshot as_of '${String(snapshot.as_of)}' !== requested as_of '${String(request.as_of)}'`);
  }
  if (snapshot.owner_ref !== request.owner_ref) {
    gap("PREDECESSOR_OWNER_MISMATCH", `${agent} snapshot owner '${String(snapshot.owner_ref)}' !== requested owner '${String(request.owner_ref)}'`);
  }
  if (typeof snapshot.digest !== "string") {
    gap("PREDECESSOR_DIGEST_MISSING", `${agent} snapshot carries no digest`);
  } else {
    identity.snapshot_digest = snapshot.digest;
    let recomputed;
    try {
      recomputed = recomputedSnapshotDigest(snapshot);
    } catch {
      gap("PREDECESSOR_DIGEST_MISMATCH", `${agent} snapshot digest cannot be recomputed over its admitted bytes`);
      return { bound: false, gaps, identity };
    }
    if (recomputed !== snapshot.digest) {
      gap("PREDECESSOR_DIGEST_MISMATCH", `${agent} snapshot digest does not recompute over its admitted bytes`);
    } else if (report.snapshot_digest !== undefined && report.snapshot_digest !== null && report.snapshot_digest !== snapshot.digest) {
      gap("PREDECESSOR_DIGEST_MISMATCH", `${agent} envelope snapshot_digest does not match its snapshot digest`);
    } else {
      identity.digest_verified = true;
    }
  }
  return { bound: gaps.length === 0, gaps, identity };
}

/** Evidence-span keys admitted by a leg snapshot: "dataset:record_ref". */
function admittedSpanKeys(snapshot) {
  const keys = new Set();
  for (const [dataset, refs] of Object.entries(snapshot.evidence ?? {})) {
    if (!refs || typeof refs !== "object") continue;
    for (const ref of Object.keys(refs)) keys.add(`${dataset}:${ref}`);
  }
  return keys;
}

/**
 * Carry one leg row into the composition. Returns { row } or
 * { withheld, gap } — only a STRUCTURALLY broken row is withheld
 * (evidence not an array, or an entry missing a record_ref key —
 * the P677-007A class). Span resolution is labeled on the carried
 * row (BOUND / PARTIAL + unresolved_evidence / UNAVAILABLE), never
 * a withholding rule: see the module header for why the cycle row
 * must carry.
 */
function carryRow({ agent, scope, section, sourceSection, sourceRow, snapshotSpanKeys }) {
  const evidence = sourceRow.evidence;
  if (evidence !== undefined && evidence !== null && !Array.isArray(evidence)) {
    return { withheld: true, gap: { code: "EVIDENCE_MALFORMED", detail: `${agent} ${sourceSection} row '${String(sourceRow.row_id)}' evidence is not an array` } };
  }
  const refs = Array.isArray(evidence) ? evidence : [];
  for (const ev of refs) {
    if (!ev || typeof ev !== "object" || typeof ev.dataset !== "string" || typeof ev.record_ref !== "string") {
      return { withheld: true, gap: { code: "EVIDENCE_KEY_MISMATCH", detail: `${agent} ${sourceSection} row '${String(sourceRow.row_id)}' evidence entry lacks a record_ref key (evidence contract: record_ref, never bare record)` } };
    }
  }
  const unresolved = refs
    .filter((ev) => !snapshotSpanKeys.has(`${ev.dataset}:${ev.record_ref}`))
    .map((ev) => `${ev.dataset}:${ev.record_ref}`);
  const row = {
    row_id: rowIdFor({
      agent: "project-manager", scope, section, kind: sourceRow.kind ?? "carried",
      dataset: sourceRow.dataset ?? "", record: sourceRow.record_ref ?? sourceRow.row_id ?? "",
      discriminator: sourceRow.row_id ?? "",
    }),
    source: agent,
    source_section: sourceSection,
    source_row_id: sourceRow.row_id ?? null,
    kind: sourceRow.kind ?? null,
    dataset: sourceRow.dataset ?? null,
    record_ref: sourceRow.record_ref ?? null,
    detail: sourceRow.detail ?? sourceRow.question ?? sourceRow.action ?? "",
    evidence: refs.map((ev) => ({ dataset: ev.dataset, record_ref: ev.record_ref })),
    evidence_state: refs.length === 0 ? "UNAVAILABLE" : (unresolved.length === 0 ? "BOUND" : "PARTIAL"),
  };
  if (unresolved.length > 0) row.unresolved_evidence = unresolved;
  // Preserve the source row's own payload fields the agenda needs.
  if (sourceRow.question !== undefined) row.question = sourceRow.question;
  if (sourceRow.action !== undefined) row.source_action = sourceRow.action;
  if (sourceRow.bucket !== undefined) row.bucket = sourceRow.bucket;
  if (sourceRow.declared_start !== undefined) row.declared_start = sourceRow.declared_start;
  if (sourceRow.declared_state !== undefined) row.declared_state = sourceRow.declared_state;
  if (sourceRow.declared_percent_complete !== undefined) row.declared_percent_complete = sourceRow.declared_percent_complete;
  if (sourceRow.computed_start !== undefined) row.computed_start = sourceRow.computed_start;
  if (sourceRow.computed_component !== undefined) row.computed_component = sourceRow.computed_component;
  if (sourceRow.computed_conclusion !== undefined) row.computed_conclusion = sourceRow.computed_conclusion;
  if (sourceRow.disagreement !== undefined) row.disagreement = sourceRow.disagreement;
  if (sourceRow.block_ref !== undefined) row.block_ref = sourceRow.block_ref;
  if (sourceRow.task_code !== undefined) row.task_code = sourceRow.task_code;
  // P678-001: a carried Scheduler component row keeps its analysis
  // outcome verbatim — conclusion, reason, qualifications — so a
  // failed component analysis is visible as a finding with its
  // source reason, never silently dropped. A NOT_MODELED component
  // gets a factual detail line (the source row carries no detail):
  // the agenda renders this row, so the failure reaches the human.
  if (sourceRow.component_id !== undefined) row.component_id = sourceRow.component_id;
  if (sourceRow.conclusion !== undefined) row.conclusion = sourceRow.conclusion;
  if (sourceRow.prototype_status !== undefined) row.prototype_status = sourceRow.prototype_status;
  if (sourceRow.prototype_reason !== undefined) row.prototype_reason = sourceRow.prototype_reason;
  if (sourceRow.prototype_detail !== undefined) row.prototype_detail = sourceRow.prototype_detail;
  if (sourceRow.qualifications !== undefined) row.qualifications = sourceRow.qualifications;
  if (sourceRow.withheld !== undefined) row.withheld = sourceRow.withheld;
  if (sourceSection === "components" && sourceRow.conclusion === "NOT_MODELED") {
    const reason = sourceRow.prototype_reason ?? null;
    const extra = typeof sourceRow.prototype_detail === "string" && sourceRow.prototype_detail.length > 0
      ? ` — ${sourceRow.prototype_detail}` : "";
    row.detail = `Scheduler component ${sourceRow.component_id} analysis did not complete: ${sourceRow.conclusion}`
      + `${reason ? ` (${reason})` : ""}${extra}. Combined conclusions cannot treat this component as modeled; resolve the predecessor analysis failure first.`;
  }
  return { row };
}

function carrySection({ agent, scope, section, sourceSection, sourceRows, snapshotSpanKeys }) {
  const rows = [];
  const gaps = [];
  for (const sourceRow of sourceRows ?? []) {
    const carried = carryRow({ agent, scope, section, sourceSection, sourceRow, snapshotSpanKeys });
    if (carried.row) rows.push(carried.row);
    else gaps.push(carried.gap);
  }
  return { rows, gaps };
}

export function evaluateManagerComposition({
  schedulerReport, controlsReport, schedulerSnapshot, controlsSnapshot,
  mapping, request, composition_snapshot_digest = null,
}) {
  if (!request || typeof request !== "object") {
    throw new JobRefusal("BAD_COMPOSITION_INPUT", "manager composition requires a request object");
  }
  if (!isNonEmptyString(request.as_of) || !isNonEmptyString(request.owner_ref)
    || !request.project_scope_ref || typeof request.project_scope_ref !== "object") {
    throw new JobRefusal("BAD_COMPOSITION_INPUT", "manager composition requires as_of, owner_ref and project_scope_ref on the request");
  }
  const scope = request.project_scope_ref;
  const boundMapping = validateProjectMapping(mapping, scope.id);
  const agent = "project-manager";
  const reviewDate = utcCivilDate(request.as_of);

  const schedulerScope = { type: "scheduling-project", id: scope.id };
  const controlsScope = { type: "work-management-project", id: boundMapping.work_management_project_ref };

  const schedulerBind = bindLeg({
    agent: "scheduler", expectedSchema: "planning-scheduler-report@1",
    expectedJobKind: "scheduler-planning-review", expectedScope: schedulerScope,
    report: schedulerReport, snapshot: schedulerSnapshot, request,
  });
  const controlsBind = bindLeg({
    agent: "project-controls", expectedSchema: "planning-controls-report@1",
    expectedJobKind: "project-controls-evidence-review", expectedScope: controlsScope,
    report: controlsReport, snapshot: controlsSnapshot, request,
  });

  const gaps = [...schedulerBind.gaps, ...controlsBind.gaps];
  const diagnostics = [];
  for (const d of schedulerReport?.diagnostics ?? []) diagnostics.push({ source: "scheduler", ...d });
  for (const d of controlsReport?.diagnostics ?? []) diagnostics.push({ source: "project-controls", ...d });

  // --- carried findings, separated by source ---
  let schedulerFindings = [];
  let controlsFindings = [];
  let milestoneRows = [];
  if (schedulerBind.bound) {
    const spanKeys = admittedSpanKeys(schedulerSnapshot);
    const integrity = carrySection({
      agent: "scheduler", scope, section: "findings_scheduler", sourceSection: "integrity",
      sourceRows: schedulerReport.sections?.integrity?.rows, snapshotSpanKeys: spanKeys,
    });
    const reviews = carrySection({
      agent: "scheduler", scope, section: "findings_scheduler", sourceSection: "review_list",
      sourceRows: schedulerReport.sections?.review_list?.rows, snapshotSpanKeys: spanKeys,
    });
    // P678-001: a Scheduler component whose analysis did not
    // complete (NOT_MODELED) is a finding, not an absence. Carrying
    // only the failed class keeps healthy/qualified components out
    // of the findings list; their qualifications already surface via
    // lookahead disagreements and review rows. The carried row is
    // normalized to a schedule_projects citation of the component
    // (the source row carries no dataset/record_ref of its own).
    // No schedule math is recomputed here and the Scheduler is not
    // changed: the leg's own conclusion and reason are carried.
    const failedComponents = carrySection({
      agent: "scheduler", scope, section: "findings_scheduler", sourceSection: "components",
      sourceRows: (schedulerReport.sections?.components?.rows ?? [])
        .filter((r) => r.conclusion === "NOT_MODELED")
        .map((r) => ({ ...r, kind: "component", dataset: "schedule_projects", record_ref: r.component_id })),
      snapshotSpanKeys: spanKeys,
    });
    schedulerFindings = [...integrity.rows, ...reviews.rows, ...failedComponents.rows];
    gaps.push(...integrity.gaps, ...reviews.gaps, ...failedComponents.gaps);
    const milestones = carrySection({
      agent: "scheduler", scope, section: "milestones", sourceSection: "lookahead",
      sourceRows: schedulerReport.sections?.lookahead?.rows, snapshotSpanKeys: spanKeys,
    });
    milestoneRows = milestones.rows;
    gaps.push(...milestones.gaps);
  }
  if (controlsBind.bound) {
    const spanKeys = admittedSpanKeys(controlsSnapshot);
    const integrity = carrySection({
      agent: "project-controls", scope, section: "findings_controls", sourceSection: "integrity",
      sourceRows: controlsReport.sections?.integrity?.rows, snapshotSpanKeys: spanKeys,
    });
    const checklist = carrySection({
      agent: "project-controls", scope, section: "findings_controls", sourceSection: "checklist",
      sourceRows: controlsReport.sections?.checklist?.rows, snapshotSpanKeys: spanKeys,
    });
    const questions = carrySection({
      agent: "project-controls", scope, section: "findings_controls", sourceSection: "questions",
      sourceRows: controlsReport.sections?.questions?.rows, snapshotSpanKeys: spanKeys,
    });
    controlsFindings = [...integrity.rows, ...checklist.rows, ...questions.rows];
    gaps.push(...integrity.gaps, ...checklist.gaps, ...questions.gaps);
  }
  for (const g of gaps) diagnostics.push({ source: "composition", code: g.code, reason: g.detail });

  // --- completion accounting (controls leg only; scheduler block percents never averaged in) ---
  // P678-003: completion is qualified by the CONTROLS package
  // population's own coverage — the controls snapshot's
  // forge_work_packages dataset facts (expected/received/complete/
  // usable) plus an expected-count conflict gap. Nothing else
  // gates it: overall snapshot consistency, baseline/snapshot
  // dataset failures, and unrelated baseline gaps do not erase a
  // demonstrably complete package population (the unrelated-
  // baseline-failure control). When the population is not
  // authoritative the denominator is WITHHELD (admitted/terminal/
  // cancelled null) while observed subset counts are kept and
  // explicitly labeled — a verified empty population (expected 0,
  // received 0, complete, usable) is ACCOUNTED 0 of 0, which is
  // distinct from an unknown population.
  // P678-004: the section carries a bounded source-linked basis
  // (one contributor per admitted package, citing its package span)
  // so the evidence consumer can verify every operand; minted
  // completion questions carry the package's actual status/claim
  // and its available span evidence, never an invented claim.
  const packagePopulation = (snapshot) => {
    const facts = snapshot?.datasets?.forge_work_packages ?? null;
    const conflict = (snapshot?.coverage_gaps ?? [])
      .some((g) => g.dataset === "forge_work_packages" && g.code === "EXPECTED_COUNT_CONFLICT");
    const authoritative = facts !== null && facts.complete === true && facts.usable === true && !conflict;
    let reason;
    if (facts === null) reason = "no package coverage facts in the controls snapshot";
    else if (conflict) reason = "package expected count conflict across pages";
    else if (facts.complete !== true) reason = "package coverage incomplete (expected count unattested or unmet)";
    else if (facts.usable !== true) reason = "package coverage complete but unusable (invalid projected fields)";
    else reason = "package population complete and usable";
    return {
      authoritative,
      expected: facts?.expected ?? null,
      received: facts?.received ?? null,
      complete: facts?.complete ?? false,
      usable: facts?.usable ?? false,
      conflict,
      reason,
    };
  };
  let completion;
  const mintedCompletionQuestions = [];
  if (!controlsBind.bound) {
    const population = {
      authoritative: false, expected: null, received: null,
      complete: false, usable: false, conflict: false,
      reason: "controls predecessor envelope is unbound",
    };
    completion = {
      state: "WITHHELD",
      reason: "controls predecessor envelope is unbound; completion cannot be accounted from an untrusted envelope",
      population,
      admitted_packages: null, terminal_count: null, cancelled_count: null,
      counts_by_status: {}, observed_packages: 0, observed_terminal_count: 0,
      unknown_statuses: [],
      terminal_statuses: [...TERMINAL_PACKAGE_STATUSES],
      progress_label: "unverified-physical-progress",
      basis: { population, contributors: [] },
    };
  } else {
    const pkgRows = controlsReport.sections?.packages?.rows ?? [];
    const population = packagePopulation(controlsSnapshot);
    const controlsSpanKeys = admittedSpanKeys(controlsSnapshot);
    const countsByStatus = {};
    const unknownStatuses = [];
    let terminalCount = 0;
    let cancelledCount = 0;
    for (const p of pkgRows) {
      const status = p.status ?? null;
      if (status !== null && PACKAGE_STATUSES.includes(status)) {
        countsByStatus[status] = (countsByStatus[status] ?? 0) + 1;
        if (TERMINAL_PACKAGE_STATUSES.includes(status)) terminalCount += 1;
        if (status === "cancelled") cancelledCount += 1;
      } else {
        unknownStatuses.push(p.package_ref ?? p.row_id ?? "unknown");
      }
    }
    const basisContributors = pkgRows.map((p) => {
      const ref = p.package_ref ?? null;
      const key = `forge_work_packages:${ref}`;
      const bound = ref !== null && controlsSpanKeys.has(key);
      const contributor = {
        package_ref: ref,
        status: p.status ?? null,
        percent_complete_claim: p.percent_complete_claim ?? null,
        evidence: bound ? [{ dataset: "forge_work_packages", record_ref: ref }] : [],
        evidence_state: bound ? "BOUND" : "PARTIAL",
      };
      if (!bound) contributor.unresolved_evidence = [key];
      return contributor;
    });
    // Completion questions: every 100% claim / terminal-status
    // package must carry one. The controls leg asks them; if a
    // claim arrives without its question, mint it here rather
    // than publishing the claim bare — with the package's ACTUAL
    // status/claim and its available span evidence. A terminal
    // status at 55% (or with no percent) is never worded as a
    // "100% progress claim": that claim was never made.
    const carriedQuestions = controlsFindings.filter((r) => r.source_section === "questions");
    for (const p of pkgRows) {
      const claim100 = p.percent_complete_claim === 100;
      const terminal = TERMINAL_PACKAGE_STATUSES.includes(p.status ?? "");
      if (!claim100 && !terminal) continue;
      const snapshotRefs = new Set((p.snapshots ?? []).map((s) => s.snapshot_ref));
      const hasQuestion = carriedQuestions.some((q) =>
        (q.record_ref === p.package_ref || snapshotRefs.has(q.record_ref))
        && typeof q.question === "string"
        && (q.question.includes("100% progress claim") || q.question.includes("terminal status")));
      if (hasQuestion) continue;
      const ref = p.package_ref ?? null;
      const key = `forge_work_packages:${ref}`;
      const bound = ref !== null && controlsSpanKeys.has(key);
      const clarification = claim100
        ? "Is the 100% progress claim supported by observed physical completion evidence? A sourced 100% is a reported claim, never independently observed completion."
        : `Package ${ref} reports terminal status '${p.status}' with declared progress ${p.percent_complete_claim === null || p.percent_complete_claim === undefined ? "not stated" : `${p.percent_complete_claim}%`}. Is the terminal status supported by observed physical completion evidence? A terminal status is a reported claim, never independently observed completion.`;
      const minted = {
        row_id: rowIdFor({
          agent, scope, section: "agenda", kind: "COMPLETION_QUESTION",
          dataset: "forge_work_packages", record: p.package_ref ?? "", discriminator: "minted",
        }),
        source: "composition",
        source_section: "completion",
        source_row_id: null,
        kind: "COMPLETION_QUESTION",
        dataset: "forge_work_packages",
        record_ref: ref,
        requested_clarification: clarification,
        responsible_role: "project reviewer",
        evidence: bound ? [{ dataset: "forge_work_packages", record_ref: ref }] : [],
        evidence_state: bound ? "BOUND" : "PARTIAL",
        progress_label: "unverified-physical-progress",
      };
      if (!bound) minted.unresolved_evidence = [key];
      mintedCompletionQuestions.push(minted);
    }
    completion = {
      state: !population.authoritative ? "WITHHELD" : (unknownStatuses.length > 0 ? "QUALIFIED" : "ACCOUNTED"),
      population,
      admitted_packages: population.authoritative ? pkgRows.length : null,
      terminal_count: population.authoritative ? terminalCount : null,
      cancelled_count: population.authoritative ? cancelledCount : null,
      counts_by_status: countsByStatus,
      observed_packages: pkgRows.length,
      observed_terminal_count: terminalCount,
      unknown_statuses: unknownStatuses,
      terminal_statuses: [...TERMINAL_PACKAGE_STATUSES],
      progress_label: "unverified-physical-progress",
      basis: { population, contributors: basisContributors },
      note: population.authoritative
        ? "Counts are source-defined terminal statuses over the admitted package population. Cancelled packages are counted separately, never as complete. Package percent_complete values are claims, never observed physical completion, and scheduler block percents are a different population that is never averaged into this accounting."
        : `Package population is not authoritative (${population.reason}): the denominator is withheld. Counts by status and the basis below are observed-subset counts only, explicitly labeled, never an accounted population.`,
    };
  }

  // --- relationships: no row-level mapping registered ---
  const schedulerBlocksAdmitted = schedulerReport?.sections?.inventory?.blocks_total ?? null;
  const controlsPackagesAdmitted = controlsReport?.sections?.packages?.rows?.length ?? null;
  const relationships = {
    state: "RELATIONSHIP_NOT_ESTABLISHED",
    scope: "NOT_MODELED",
    note: "No authoritative explicit block-to-package mapping is registered in this slice, so no package is asserted orphaned and no block is asserted unmapped: without a mapping, an unjoined row is unmodeled, not missing. The project-level mapping binds the two scopes; it is not a row mapping.",
    scheduler_blocks_admitted: schedulerBlocksAdmitted,
    controls_packages_admitted: controlsPackagesAdmitted,
    rows: [],
  };

  // --- review agenda: carried items + minted questions + gap questions ---
  const agendaRows = [];
  const pushAgenda = (carried) => {
    const agendaRow = {
      row_id: rowIdFor({
        agent, scope, section: "agenda", kind: carried.kind ?? "carried",
        dataset: carried.dataset ?? "", record: carried.record_ref ?? "", discriminator: carried.source_row_id ?? "",
      }),
      source: carried.source,
      source_section: carried.source_section,
      source_row_id: carried.source_row_id,
      kind: carried.kind,
      dataset: carried.dataset,
      record_ref: carried.record_ref,
      requested_clarification: carried.question
        ?? (carried.source_action ? `${carried.source_action}: ${carried.detail}` : carried.detail),
      responsible_role: "project reviewer",
      evidence: carried.evidence ?? [],
      evidence_state: carried.evidence_state ?? "BOUND",
    };
    // P678-002: the agenda copy of a PARTIAL row must name the same
    // unresolved citations as the finding, or the evidence gate
    // would demand a span for a subject reference that is not an
    // admitted record (and the cycle positive would refuse).
    if (carried.unresolved_evidence !== undefined) agendaRow.unresolved_evidence = carried.unresolved_evidence;
    agendaRows.push(agendaRow);
  };
  for (const row of schedulerFindings) {
    if (row.source_section === "review_list" || row.source_section === "components") pushAgenda(row);
  }
  for (const row of controlsFindings) {
    if (row.source_section === "checklist" || row.source_section === "questions") pushAgenda(row);
  }
  agendaRows.push(...mintedCompletionQuestions);
  for (const g of gaps) {
    if (g.code.startsWith("PREDECESSOR_")) {
      agendaRows.push({
        row_id: rowIdFor({ agent, scope, section: "agenda", kind: g.code, dataset: "", record: "", discriminator: g.code }),
        source: "composition",
        source_section: "predecessor_evidence",
        source_row_id: null,
        kind: g.code,
        dataset: null,
        record_ref: null,
        requested_clarification: `Resolve the predecessor evidence gap before any combined conclusion is drawn: ${g.detail}`,
        responsible_role: "project reviewer",
        evidence: [],
        evidence_state: "UNAVAILABLE",
      });
    }
  }

  // --- predecessor evidence rows ---
  const predecessorRows = [];
  for (const [bind, legAgent] of [[schedulerBind, "scheduler"], [controlsBind, "project-controls"]]) {
    const id = bind.identity;
    predecessorRows.push({
      row_id: rowIdFor({ agent, scope, section: "predecessor_evidence", kind: legAgent, dataset: "", record: legAgent }),
      agent: legAgent,
      schema_version: id.schema_version,
      job_version: id.job_version,
      snapshot_digest: id.snapshot_digest,
      digest_verified: id.digest_verified,
      as_of_match: id.as_of_match,
      scope_match: id.scope_match,
      owner_match: id.owner_match,
      status: bind.bound ? "BOUND" : "WITHHELD",
      gaps: bind.gaps.map((g) => g.code),
      evidence: [],
      evidence_state: "UNAVAILABLE",
    });
  }
  predecessorRows.push({
    row_id: rowIdFor({ agent, scope, section: "predecessor_evidence", kind: "project-mapping", dataset: "", record: boundMapping.mapping_version }),
    agent: "composition",
    mapping_version: boundMapping.mapping_version,
    scheduling_project_ref: boundMapping.scheduling_project_ref,
    work_management_project_ref: boundMapping.work_management_project_ref,
    status: "BOUND",
    gaps: [],
    evidence: [],
    evidence_state: "UNAVAILABLE",
  });

  // --- conclusion ---
  const anyLegUnbound = !schedulerBind.bound || !controlsBind.bound;
  const anyPartial = schedulerSnapshot?.consistency === "PARTIAL" || controlsSnapshot?.consistency === "PARTIAL";
  const anyFinding = schedulerFindings.length > 0 || controlsFindings.length > 0
    || agendaRows.length > 0 || gaps.length > 0;
  const conclusion = anyLegUnbound ? "WITHHELD" : (anyFinding || anyPartial ? "QUALIFIED" : "READY");

  const financial = { scope: "FINANCIAL_SCOPE_EXCLUDED" };
  for (const m of FINANCIAL_MEASURES) financial[m] = "NOT_MODELED";

  const report = {
    schema_version: MANAGER_SCHEMA,
    agent,
    job_kind: "project-manager-plan-health-review",
    job_version: 1,
    owner_ref: request.owner_ref,
    project_scope_ref: { type: scope.type, id: scope.id },
    window: { name: MANAGER_WINDOW },
    as_of: request.as_of,
    as_of_date: reviewDate,
    as_of_timezone: "UTC",
    review_date: reviewDate,
    status: "DRAFT",
    conclusion,
    snapshot_digest: composition_snapshot_digest,
    snapshot_consistency: (schedulerSnapshot?.consistency === "PARTIAL" || controlsSnapshot?.consistency === "PARTIAL") ? "PARTIAL" : "CONSISTENT",
    mapping: { ...boundMapping },
    versions: {
      scheduler_evaluator_version: EVALUATOR_VERSION,
      controls_evaluator_version: CONTROLS_EVALUATOR_VERSION,
      manager_evaluator_version: MANAGER_EVALUATOR_VERSION,
      field_mapping_version: FIELD_MAPPING_VERSION,
    },
    sections: {
      inventory: {
        scheduler_blocks_total: schedulerBlocksAdmitted,
        scheduler_components_total: schedulerReport?.sections?.components?.rows?.length ?? null,
        scheduler_lookahead_total: schedulerReport?.sections?.lookahead?.rows?.length ?? null,
        controls_packages_total: controlsReport?.sections?.packages?.rows?.length ?? null,
        controls_baselines_total: controlsReport?.sections?.inventory?.baselines_total ?? null,
        controls_snapshots_total: controlsReport?.sections?.inventory?.snapshots_total ?? null,
        evidence: [],
      },
      findings_scheduler: { rows: schedulerFindings },
      findings_controls: { rows: controlsFindings },
      completion,
      relationships,
      milestones: {
        rows: milestoneRows,
        note: "Milestone feasibility references the Scheduler's applicable analysis (declared values beside computed advisory dates, disagreements flagged) — never recomputed here, and never converted through the elapsed-hour clock of the old PM prototype, whose invented clock is incompatible with the Scheduler's civil-day analysis.",
      },
      agenda: { rows: agendaRows },
      predecessor_evidence: { rows: predecessorRows },
      financial,
      resources: {
        scope: "NOT_MODELED",
        overallocation: "NOT_MODELED",
        leveling: "NOT_MODELED",
        note: "Resource overallocation and leveling remain NOT_MODELED in this lane.",
      },
      not_modeled: {
        modules: [
          "financial measures (PV/EV/AC/CPI/SPI/EAC, contingency, costs, hours)",
          "resource capacity, labor availability, assignments, overallocation and leveling",
          "block-to-package row relationships (no authoritative explicit mapping registered)",
          "schedule math (owned by the Scheduler envelope; cited, never recomputed)",
          "the elapsed-hour PM prototype clock (incompatible invented clock; never used)",
          "live CPM engine outputs stored on schedule_blocks (recomputed by the Scheduler, never read)",
          "cross-project inference (no mapping registered)",
          "work-package creation, enrollment, assignment, gate clearance, and date/status/baseline changes (accepting this summary does none of these)",
        ],
      },
    },
    diagnostics,
    execution_authorized: false,
  };
  return report;
}
