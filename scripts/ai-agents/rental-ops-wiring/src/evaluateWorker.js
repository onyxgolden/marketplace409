/**
 * Fixed evaluator worker. The runner runs evaluation inside this
 * worker so the hard five-second execution boundary can actually
 * terminate a runaway evaluation (a synchronous loop in-process could
 * never be raced). The worker path is pinned by the host bootstrap's
 * manifest; no task, request or caller can supply a different one.
 */
import { parentPort, workerData } from "node:worker_threads";
import { evaluatePropertyManagerSnapshot } from "../../../../src/application/ai-lab/rental-ops/propertyManagerJob.js";

try {
  const report = evaluatePropertyManagerSnapshot(workerData.snapshot, { policies: workerData.policies });
  parentPort.postMessage({ ok: true, report });
} catch (err) {
  parentPort.postMessage({ ok: false, code: err?.code ?? "EVALUATOR_ERROR", message: String(err?.message ?? err) });
}
