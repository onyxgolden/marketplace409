/**
 * Fixed evaluator worker. The runner runs evaluation inside this
 * worker so the hard five-second execution boundary can actually
 * terminate a runaway evaluation (a synchronous loop in-process could
 * never be raced). The worker path is pinned by the host bootstrap's
 * manifest; no task, request or caller can supply a different one.
 */
import { parentPort, workerData } from "node:worker_threads";
import { JOB_KINDS, JobRefusal } from "../../../../src/application/ai-lab/rental-ops/jobContracts.js";
import { evaluatePropertyManagerSnapshot } from "../../../../src/application/ai-lab/rental-ops/propertyManagerJob.js";
import { evaluateMaintenanceManagerSnapshot } from "../../../../src/application/ai-lab/rental-ops/maintenanceManagerJob.js";

/**
 * Evaluator dispatch. The runner validated the job kind before the
 * spawn, so the kind is one of the two registered descriptors; any
 * other value refuses closed rather than falling through to the
 * wrong evaluator.
 */
function evaluatorFor(kind) {
  if (kind === JOB_KINDS.PM_DAILY_EXCEPTION_REVIEW) return evaluatePropertyManagerSnapshot;
  if (kind === JOB_KINDS.MM_BACKLOG_REVIEW) return evaluateMaintenanceManagerSnapshot;
  throw new JobRefusal("UNKNOWN_AGENT", `no evaluator for job kind '${String(kind)}'`);
}

try {
  const evaluate = evaluatorFor(workerData.request?.job_kind);
  const report = evaluate(workerData.snapshot, { policies: workerData.policies });
  parentPort.postMessage({ ok: true, report });
} catch (err) {
  parentPort.postMessage({ ok: false, code: err?.code ?? "EVALUATOR_ERROR", message: String(err?.message ?? err) });
}
