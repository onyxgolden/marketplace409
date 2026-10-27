/**
 * Fixed planning execution worker. The runner executes the ENTIRE
 * execution phase — adapter response admission, normalization
 * (snapshot build) and evaluation — inside this worker, under ONE
 * invocation deadline enforced preemptively by the main thread: while
 * the worker runs, the main thread's event loop stays free, so the
 * deadline timer ALWAYS fires — even against a synchronous runaway
 * inside the adapter or a hung reader — and the worker is
 * terminated. Cooperative cancellation (the abort signal + adapter
 * close) runs first where possible; termination is the backstop.
 *
 * The worker path is pinned by the host bootstrap's manifest; no
 * task, request or caller can supply a different one. Only DATA
 * crosses the boundary (structured clone): the admitted
 * primitive-only request, policies and adapter spec, the budget's
 * used counters and the clock instant. The adapter is reconstructed
 * inside the worker from the host-owned spec — this release installs
 * only the synthetic adapter; any other kind refuses
 * ACTIVATION_REQUIRED here, exactly as the runner would.
 *
 * The planning budget (depth 32, brief §11) is continued from the
 * main thread's used counters — admission charges made before the
 * spawn are preserved, and collection/evaluation charges accumulate
 * into the same budget.
 */
import { parentPort, workerData } from "node:worker_threads";
import { types } from "node:util";
import { PLANNING_BUDGET_LIMITS } from "./planningBudget.js";
import { Budget, BudgetExceededError, ControlDataError } from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { canonicalDigest } from "../../../../src/application/ai-lab/rental-ops/canonical.js";
import { CONTROLS_DATASETS, FIELD_MAPPING_VERSION, PLANNING_DATASETS, utcCivilDate } from "../../../../src/application/ai-lab/planning/fieldMappings.js";
import { JOB_KINDS, JobRefusal, requireControlsScope, requireManagerScope, requireSchedulerScope } from "../../../../src/application/ai-lab/planning/jobContracts.js";
import { buildSnapshot } from "../../../../src/application/ai-lab/planning/snapshotBuilder.js";
import { evaluateSchedulerSnapshot } from "../../../../src/application/ai-lab/planning/schedulerAssessment.js";
import { evaluateControlsSnapshot } from "../../../../src/application/ai-lab/planning/controlsEvidenceAssessment.js";
import { evaluateManagerComposition, validateProjectMapping } from "../../../../src/application/ai-lab/planning/managerComposition.js";
import { createSyntheticAdapter } from "./syntheticRepository.js";

function adapterFromSpec(spec) {
  if (!spec || spec.kind !== "synthetic") {
    throw new JobRefusal("ACTIVATION_REQUIRED", "this release installs only the synthetic adapter");
  }
  return createSyntheticAdapter({
    datasets: spec.datasets,
    faults: spec.faults ?? {},
    authorizedGlobalCalendarRefs: spec.authorized_global_calendar_refs ?? [],
  });
}

/**
 * Job-kind dispatch (scope check + datasets + evaluator). The
 * runner validated the job kind before the spawn; dispatch is by
 * kind, never by scope contents — a Scheduler kind with a
 * work-management scope refuses SCOPE_TYPE_MISMATCH at the scope
 * gate, never falls through to the controls evaluator, and vice
 * versa. The Project Manager kind is a two-leg composition (below),
 * never a single-dataset dispatch.
 */
function jobDispatch(kind) {
  if (kind === JOB_KINDS.SCHEDULER_PLANNING_REVIEW) {
    return { scopeCheck: requireSchedulerScope, datasets: PLANNING_DATASETS, evaluator: evaluateSchedulerSnapshot };
  }
  if (kind === JOB_KINDS.CONTROLS_EVIDENCE_REVIEW) {
    return { scopeCheck: requireControlsScope, datasets: CONTROLS_DATASETS, evaluator: evaluateControlsSnapshot };
  }
  throw new JobRefusal("UNKNOWN_AGENT", `no evaluator for job kind '${String(kind)}'`);
}

/**
 * Measure one evaluator report as a candidate, with the same
 * caps and refusal semantics as Budget.measureCandidate — except
 * aliasing: the walk is ANCESTOR-scoped, not global. Evaluator
 * reports are DAGs by construction (the Controls evaluator shares
 * one finding's evidence array across its integrity, checklist
 * and question rows); a global-seen walk misclassifies that
 * legitimate sharing as "cyclic structure" and refuses every leg
 * report that carries a finding. True cycles still refuse (an
 * ancestor repeats), as do proxies, accessors and non-plain
 * objects. Host/request/spec control objects keep the strict
 * global-seen measureCandidate on the main thread — only
 * in-process evaluator reports use this helper.
 */
function measureReportCandidate(budget, value, what) {
  budget.chargeCandidate();
  const ancestors = new Set();
  let maxDepth = 0;
  const walk = (v, depth) => {
    if (depth > maxDepth) maxDepth = depth;
    if (depth > PLANNING_BUDGET_LIMITS.depth) throw new BudgetExceededError("depth", PLANNING_BUDGET_LIMITS.depth);
    if (v === null || typeof v !== "object") return;
    if (types.isProxy(v)) throw new ControlDataError(`${what}: proxy`);
    if (ancestors.has(v)) throw new ControlDataError(`${what}: cyclic structure`);
    ancestors.add(v);
    const proto = Object.getPrototypeOf(v);
    if (!Array.isArray(v) && proto !== Object.prototype && proto !== null) {
      throw new ControlDataError(`${what}: non-plain object`);
    }
    for (const key of Reflect.ownKeys(v)) {
      const desc = Object.getOwnPropertyDescriptor(v, key);
      if (!desc) continue;
      if ("get" in desc || "set" in desc) throw new ControlDataError(`${what}: accessor property ${String(key)}`);
      walk(desc.value, depth + 1);
    }
    ancestors.delete(v);
  };
  walk(value, 1);
  let text;
  try { text = JSON.stringify(value); } catch { throw new ControlDataError(`${what}: unserializable`); }
  if (typeof text !== "string") throw new ControlDataError(`${what}: unserializable`);
  budget.chargeInputBytes(Buffer.byteLength(text, "utf8"));
}

/**
 * Project Manager two-leg composition (P2b-3). One adapter, one
 * deadline, one budget: the Scheduler leg is collected under the
 * request's scheduling-project scope, the Controls leg under the
 * work-management-project scope the host mapping binds to it, and
 * the composition binds both envelopes to their snapshots by
 * recomputed digest before carrying any finding. The pin snapshot
 * is digested exactly like a leg snapshot — canonicalDigest over
 * {envelope, records} — so the preview child's read-back check
 * recomputes it the same way.
 */
async function runManagerJob({ request, spec, adapter, budget, clock, signal }) {
  requireManagerScope(request);
  const mapping = validateProjectMapping(spec?.project_mapping, request.project_scope_ref.id);
  const authorizedGlobalRefs = new Set(spec?.authorized_global_calendar_refs ?? []);
  const schedulerSnapshot = await buildSnapshot({
    request, adapter, budget, clock, signal,
    datasets: PLANNING_DATASETS, authorizedGlobalRefs,
  });
  const controlsRequest = {
    ...request,
    project_scope_ref: { type: "work-management-project", id: mapping.work_management_project_ref },
    snapshot_request_id: `${request.snapshot_request_id}-controls`,
  };
  const controlsSnapshot = await buildSnapshot({
    request: controlsRequest, adapter, budget, clock, signal,
    datasets: CONTROLS_DATASETS, authorizedGlobalRefs,
  });
  const schedulerReport = evaluateSchedulerSnapshot(schedulerSnapshot, {});
  const controlsReport = evaluateControlsSnapshot(controlsSnapshot);
  // Charge BEFORE reading: the composition consults the envelopes
  // and the mapping, so all three are measured as candidates before
  // the evaluator touches a field (brief §11). Reports use the
  // DAG-tolerant helper above; the mapping is a small plain
  // host object and keeps the strict measureCandidate.
  measureReportCandidate(budget, schedulerReport, "schedulerReport");
  measureReportCandidate(budget, controlsReport, "controlsReport");
  budget.measureCandidate(mapping, "projectMapping");
  const pinEnvelope = {
    schema_version: "planning-composition-snapshot@1",
    snapshot_request_id: request.snapshot_request_id,
    owner_ref: request.owner_ref,
    project_scope_ref: request.project_scope_ref,
    source_system: schedulerSnapshot.source_system ?? "unknown",
    source_revision: null,
    scheduler_snapshot_digest: schedulerSnapshot.digest,
    controls_snapshot_digest: controlsSnapshot.digest,
    scheduler_source_revision: schedulerSnapshot.source_revision ?? null,
    controls_source_revision: controlsSnapshot.source_revision ?? null,
    mapping: { ...mapping },
    collection: {
      started_at: schedulerSnapshot.collection?.started_at < controlsSnapshot.collection?.started_at
        ? schedulerSnapshot.collection.started_at : controlsSnapshot.collection?.started_at,
      finished_at: schedulerSnapshot.collection?.finished_at > controlsSnapshot.collection?.finished_at
        ? schedulerSnapshot.collection.finished_at : controlsSnapshot.collection?.finished_at,
    },
    as_of: request.as_of,
    review_date: utcCivilDate(request.as_of),
    as_of_timezone: "UTC",
    mapping_version: FIELD_MAPPING_VERSION,
    datasets: { ...(schedulerSnapshot.datasets ?? {}), ...(controlsSnapshot.datasets ?? {}) },
    consistency: (schedulerSnapshot.consistency === "PARTIAL" || controlsSnapshot.consistency === "PARTIAL") ? "PARTIAL" : "CONSISTENT",
    coverage_gaps: [...(schedulerSnapshot.coverage_gaps ?? []), ...(controlsSnapshot.coverage_gaps ?? [])],
    stale: Boolean(schedulerSnapshot.stale || controlsSnapshot.stale),
    conflicts: [...(schedulerSnapshot.conflicts ?? []), ...(controlsSnapshot.conflicts ?? [])],
    collection_errors: [...(schedulerSnapshot.collection_errors ?? []), ...(controlsSnapshot.collection_errors ?? [])],
  };
  // The pin snapshot's records are the FLAT merge of the two legs'
  // dataset maps — not a {scheduler, controls} nesting. The private
  // store's evidence verifier (serve.mjs verifyEvidenceEligibility)
  // binds each evidence span to an admitted record via
  // records[dataset], so a nested shape leaves every span unbound
  // (proved by the P2b-3 HTTP proof: BL-A1 409 EVIDENCE_UNVERIFIED
  // on the nested shape). The legs' datasets are disjoint by
  // construction (PLANNING_DATASETS vs CONTROLS_DATASETS); any
  // collision refuses fail-closed rather than silently shadowing a
  // leg's records.
  const pinRecords = {};
  for (const [leg, legRecords] of [["scheduler", schedulerSnapshot.records], ["controls", controlsSnapshot.records]]) {
    for (const [dataset, rows] of Object.entries(legRecords ?? {})) {
      if (Object.prototype.hasOwnProperty.call(pinRecords, dataset)) {
        throw new ControlDataError(`pin snapshot dataset collision: ${dataset} present in both legs (leg ${leg})`);
      }
      pinRecords[dataset] = rows;
    }
  }
  const pinDigest = canonicalDigest({ envelope: pinEnvelope, records: pinRecords });
  const report = evaluateManagerComposition({
    schedulerReport, controlsReport, schedulerSnapshot, controlsSnapshot,
    mapping, request, composition_snapshot_digest: pinDigest,
  });
  const pinEvidence = { ...(schedulerSnapshot.evidence ?? {}), ...(controlsSnapshot.evidence ?? {}) };
  const snapshot = { ...pinEnvelope, digest: pinDigest, records: pinRecords, evidence: pinEvidence };
  return { snapshot, report };
}

try {
  const budget = new Budget(PLANNING_BUDGET_LIMITS);
  if (workerData.budgetUsed && typeof workerData.budgetUsed === "object") {
    for (const key of Object.keys(budget.used)) {
      if (typeof workerData.budgetUsed[key] === "number") budget.used[key] = workerData.budgetUsed[key];
    }
  }
  const adapter = adapterFromSpec(workerData.adapterSpec);
  const clock = { nowIso: () => workerData.clockIso };
  const controller = new AbortController();
  const abortTimer = setTimeout(() => controller.abort(), Math.max(0, workerData.deadlineMs));
  let snapshot;
  let report;
  let adapterCalls = 0;
  let adapterClosed = false;
  try {
    if (workerData.request?.job_kind === JOB_KINDS.PM_PLAN_HEALTH_REVIEW) {
      // Two-leg composition: the scope gate runs before any
      // adapter is opened, and both legs are collected under the
      // one deadline/budget before the adapter closes.
      const composed = await runManagerJob({
        request: workerData.request, spec: workerData.adapterSpec,
        adapter, budget, clock, signal: controller.signal,
      });
      snapshot = composed.snapshot;
      report = composed.report;
    } else {
      // Dispatch by kind: the scope gate runs before any adapter
      // is opened, and only the job's own dataset list is
      // collected — a Controls run never touches a scheduling
      // dataset, and a Scheduler run never touches a controls
      // dataset.
      const dispatch = jobDispatch(workerData.request?.job_kind);
      dispatch.scopeCheck(workerData.request);
      snapshot = await buildSnapshot({
        request: workerData.request, adapter, budget, clock, signal: controller.signal,
        datasets: dispatch.datasets,
        authorizedGlobalRefs: new Set(workerData.adapterSpec?.authorized_global_calendar_refs ?? []),
      });
      report = dispatch.evaluator(snapshot, {});
    }
  } finally {
    clearTimeout(abortTimer);
    adapterCalls = adapter.calls?.length ?? 0;
    try { if (typeof adapter.close === "function") adapter.close(); } catch { /* termination is the backstop */ }
    adapterClosed = adapter.closed === true;
  }
  parentPort.postMessage({
    ok: true, snapshot, report,
    budgetUsed: budget.used, adapterCalls, adapterClosed,
    adapterDatasets: [...new Set((adapter.calls ?? []).map((c) => c.dataset))],
  });
} catch (err) {
  parentPort.postMessage({
    ok: false,
    code: err?.code ?? "EXECUTION_ERROR",
    kind: err?.kind,
    limit: err?.limit,
    message: String(err?.message ?? err),
  });
}
