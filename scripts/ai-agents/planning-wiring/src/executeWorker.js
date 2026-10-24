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
import { PLANNING_BUDGET_LIMITS } from "./planningBudget.js";
import { Budget } from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { CONTROLS_DATASETS, PLANNING_DATASETS } from "../../../../src/application/ai-lab/planning/fieldMappings.js";
import { JOB_KINDS, JobRefusal, requireControlsScope, requireSchedulerScope } from "../../../../src/application/ai-lab/planning/jobContracts.js";
import { buildSnapshot } from "../../../../src/application/ai-lab/planning/snapshotBuilder.js";
import { evaluateSchedulerSnapshot } from "../../../../src/application/ai-lab/planning/schedulerAssessment.js";
import { evaluateControlsSnapshot } from "../../../../src/application/ai-lab/planning/controlsEvidenceAssessment.js";
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
 * versa. The Project Manager kind still refuses with the
 * sequencing gate (JOB_NOT_BUILT_IN_SLICE — the P2a-1 precedent
 * for P2a-2), never falls through to the wrong evaluator.
 */
function jobDispatch(kind) {
  if (kind === JOB_KINDS.SCHEDULER_PLANNING_REVIEW) {
    return { scopeCheck: requireSchedulerScope, datasets: PLANNING_DATASETS, evaluator: evaluateSchedulerSnapshot };
  }
  if (kind === JOB_KINDS.CONTROLS_EVIDENCE_REVIEW) {
    return { scopeCheck: requireControlsScope, datasets: CONTROLS_DATASETS, evaluator: evaluateControlsSnapshot };
  }
  if (kind === JOB_KINDS.PM_PLAN_HEALTH_REVIEW) {
    throw new JobRefusal("JOB_NOT_BUILT_IN_SLICE", `job kind '${kind}' is not built in P2b-2; its slice has not landed`);
  }
  throw new JobRefusal("UNKNOWN_AGENT", `no evaluator for job kind '${String(kind)}'`);
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
  let adapterCalls = 0;
  let adapterClosed = false;
  // Dispatch by kind: the scope gate runs before any adapter is
  // opened, and only the job's own dataset list is collected —
  // a Controls run never touches a scheduling dataset, and a
  // Scheduler run never touches a controls dataset.
  const dispatch = jobDispatch(workerData.request?.job_kind);
  dispatch.scopeCheck(workerData.request);
  try {
    snapshot = await buildSnapshot({
      request: workerData.request, adapter, budget, clock, signal: controller.signal,
      datasets: dispatch.datasets,
      authorizedGlobalRefs: new Set(workerData.adapterSpec?.authorized_global_calendar_refs ?? []),
    });
  } finally {
    clearTimeout(abortTimer);
    adapterCalls = adapter.calls?.length ?? 0;
    try { if (typeof adapter.close === "function") adapter.close(); } catch { /* termination is the backstop */ }
    adapterClosed = adapter.closed === true;
  }
  const report = dispatch.evaluator(snapshot, {});
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
