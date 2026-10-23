import { Worker } from "node:worker_threads";
import {
  BudgetExceededError, EXECUTION_BOUNDARY_MS, PUBLICATION_BOUND_MS,
} from "../../../../src/application/ai-lab/rental-ops/budgets.js";
import { JobRefusal } from "../../../../src/application/ai-lab/rental-ops/jobContracts.js";

/**
 * ONE invocation deadline for the whole execution boundary.
 *
 * The brief's external hard five-second boundary covers adapter
 * response admission, normalization AND evaluation as a single
 * window: snapshot collection races the deadline's abort signal, and
 * the evaluator worker is granted only the time REMAINING when it
 * starts — never a fresh timer. On expiry, outstanding work is
 * cancelled or terminated: the adapter is signalled (and closed by
 * the runner), and a hung evaluator worker is terminated, so the run
 * settles inside the advertised boundary instead of drifting into a
 * second window.
 *
 * Publication is deliberately NOT part of this deadline. It is
 * bounded separately (publishBounded below) with its own named
 * failure semantics, so a slow store can never stretch the execution
 * boundary and a hung publisher can never hang the invocation.
 */
export function createInvocationDeadline(boundaryMs = EXECUTION_BOUNDARY_MS) {
  const controller = new AbortController();
  const started = performance.now();
  const timer = setTimeout(() => controller.abort(), boundaryMs);
  return {
    boundaryMs,
    signal: controller.signal,
    elapsedMs: () => performance.now() - started,
    remainingMs: () => Math.max(0, boundaryMs - (performance.now() - started)),
    expired: () => controller.signal.aborted,
    dispose: () => clearTimeout(timer),
  };
}

const EXECUTE_WORKER_URL = new URL("./executeWorker.js", import.meta.url);

/**
 * Run the fixed execution worker (admission + normalization +
 * evaluation) with only the deadline's remaining time. The worker
 * that has not answered when the shared deadline lands is
 * terminated — this is the preemptive boundary: the main thread's
 * event loop is free while the worker executes, so the timer fires
 * even against a synchronous runaway or a hung reader inside the
 * worker. `workerUrl` exists only for tests; the runner never passes
 * it, and no request, task or caller can reach it.
 *
 * Resolves with { snapshot, report, budgetUsed, adapterCalls,
 * adapterClosed }. A budget refusal inside the worker is
 * reconstituted as a BudgetExceededError so the runner's existing
 * refusal path handles it.
 */
export function runExecution({ adapterSpec, request, policies, budgetUsed, clockIso, deadline, workerUrl = EXECUTE_WORKER_URL }) {
  return new Promise((resolve, reject) => {
    const remaining = deadline.remainingMs();
    if (remaining <= 0) {
      reject(new JobRefusal("EXECUTION_TIMEOUT", "the single invocation deadline was spent before execution could start"));
      return;
    }
    let worker;
    try {
      worker = new Worker(workerUrl, {
        workerData: { adapterSpec, request, policies, budgetUsed, clockIso, deadlineMs: remaining },
      });
    } catch (err) {
      reject(new JobRefusal("EXECUTION_ERROR", `could not start the execution worker: ${String(err?.message ?? err)}`));
      return;
    }
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      settle(value);
    };
    const timer = setTimeout(() => finish(reject,
      new JobRefusal("EXECUTION_TIMEOUT", "the single invocation deadline was reached; the execution worker was terminated")), remaining);
    worker.once("message", (msg) => {
      if (msg?.ok) { finish(resolve, msg); return; }
      if (msg?.code === "BUDGET_EXCEEDED") {
        finish(reject, Object.assign(new BudgetExceededError(msg.kind, msg.limit), { workerMessage: msg.message }));
        return;
      }
      finish(reject, new JobRefusal(msg?.code ?? "EXECUTION_ERROR", msg?.message ?? "execution failed"));
    });
    worker.once("error", (err) => finish(reject, err));
  });
}

/**
 * Bound publication separately from the execution boundary. A
 * publish that does not settle inside PUBLICATION_BOUND_MS refuses
 * with PUBLICATION_TIMEOUT: the report was computed but NOT durably
 * published. The underlying write may or may not have landed —
 * publication is idempotent (same identity + same bytes is a no-op),
 * so replaying the same job is the safe way to settle the question.
 */
export async function publishBounded(publisher, item, snapshot, boundMs = PUBLICATION_BOUND_MS) {
  let timer;
  try {
    return await Promise.race([
      publisher.publish(item, snapshot),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new JobRefusal(
          "PUBLICATION_TIMEOUT",
          `publication did not settle within the ${boundMs}ms publication bound; the write may or may not have landed — replay the same job identity to settle it (publication is idempotent)`,
        )), boundMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
