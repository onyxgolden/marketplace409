/**
 * Fixed execution worker. The runner executes the ENTIRE execution
 * phase — adapter response admission, normalization (snapshot build)
 * and evaluation — inside this worker, under ONE invocation
 * deadline enforced preemptively by the main thread: while the
 * worker runs, the main thread's event loop stays free, so the
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
 */
import { parentPort, workerData } from "node:worker_threads";
import { Budget } from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { DATASETS, MM_DATASETS } from "../../../../src/application/ai-lab/rental-ops/fieldMappings.js";
import { JOB_KINDS, JobRefusal } from "../../../../src/application/ai-lab/rental-ops/jobContracts.js";
import { buildSnapshot } from "../../../../src/application/ai-lab/rental-ops/snapshotBuilder.js";
import { evaluatePropertyManagerSnapshot } from "../../../../src/application/ai-lab/rental-ops/propertyManagerJob.js";
import { evaluateMaintenanceManagerSnapshot } from "../../../../src/application/ai-lab/rental-ops/maintenanceManagerJob.js";
import { createSyntheticAdapter } from "./syntheticRepository.js";

function adapterFromSpec(spec) {
  if (!spec || spec.kind !== "synthetic") {
    throw new JobRefusal("ACTIVATION_REQUIRED", "this release installs only the synthetic adapter");
  }
  return createSyntheticAdapter({ datasets: spec.datasets, faults: spec.faults ?? {} });
}

/**
 * Evaluator dispatch (mirrors evaluateWorker.js). The runner
 * validated the job kind before the spawn; any other value refuses
 * closed rather than falling through to the wrong evaluator.
 */
function evaluatorFor(kind) {
  if (kind === JOB_KINDS.PM_DAILY_EXCEPTION_REVIEW) return evaluatePropertyManagerSnapshot;
  if (kind === JOB_KINDS.MM_BACKLOG_REVIEW) return evaluateMaintenanceManagerSnapshot;
  throw new JobRefusal("UNKNOWN_AGENT", `no evaluator for job kind '${String(kind)}'`);
}

try {
  // Continue the ONE invocation budget from the main thread's used
  // counters: admission charges made before the spawn are preserved,
  // and collection/evaluation charges accumulate into the same budget.
  const budget = new Budget();
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
  // P2a-2: the Maintenance Manager job collects its narrow dataset
  // list (work orders + unit/property linkage); the Property Manager
  // keeps the full list. The dataset list is job data selected here,
  // never caller-supplied.
  const datasets = workerData.request?.job_kind === JOB_KINDS.MM_BACKLOG_REVIEW ? MM_DATASETS : DATASETS;
  try {
    snapshot = await buildSnapshot({
      request: workerData.request, adapter, budget, clock, signal: controller.signal, datasets,
    });
  } finally {
    clearTimeout(abortTimer);
    adapterCalls = adapter.calls?.length ?? 0;
    try { if (typeof adapter.close === "function") adapter.close(); } catch { /* termination is the backstop */ }
    adapterClosed = adapter.closed === true;
  }
  const report = evaluatorFor(workerData.request?.job_kind)(snapshot, { policies: workerData.policies });
  parentPort.postMessage({
    ok: true, snapshot, report,
    budgetUsed: budget.used, adapterCalls, adapterClosed,
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
