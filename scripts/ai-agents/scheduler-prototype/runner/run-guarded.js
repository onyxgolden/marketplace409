/**
 * run-guarded.js — external 5-second watchdog around the full run() path.
 *
 * S648A-006: run() executes in a worker thread (process boundary). If it
 * does not settle within 5000ms, the worker is terminated and a bounded
 * REFUSED envelope (complete:false, empty domain collections) is returned.
 * A cooperative timer on the blocked thread is insufficient — the watchdog
 * is external to the work.
 *
 * Usage: import { runGuarded, GUARD_TIMEOUT_MS } from "./runner/run-guarded.js";
 *   const result = await runGuarded(task, context); // always settles
 */

import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_TIMEOUT_MS = 5000;

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), "guarded-worker.js");

function timeoutEnvelope() {
  return {
    schema_version: "1",
    agent: "scheduler-agent",
    task_id: "unavailable",
    status: "REFUSED",
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false,
    source_refs: [],
    diagnostics: [
      {
        code: "EXECUTION_TIMEOUT",
        severity: "critical",
        source_ref: null,
        record_id: null,
        reason: `public task execution did not settle within ${GUARD_TIMEOUT_MS}ms; worker terminated, no partial output`,
      },
    ],
    quarantined_sources: [],
    routing_flags: [],
    report: {
      components: [],
      claimed_comparisons: [],
      anomalies: [],
      coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
      summary: null,
    },
  };
}

/**
 * Run the task under the external watchdog. Always settles: either with
 * the worker's result, a worker error envelope, or the timeout envelope.
 *
 * task/context must be structured-cloneable plain data. Descriptor-safe
 * admission (assertNoAccessors) rejects accessor properties on the real
 * path; hang probes construct malicious inputs inside the worker via
 * `factorySource` so the parent never touches them.
 */
export function runGuarded(task, context, timeoutMs = GUARD_TIMEOUT_MS, factorySource = null) {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        resolve(result);
      }
    };
    let worker;
    try {
      worker = factorySource
        ? new Worker(
            `import { parentPort } from "node:worker_threads";
             import { run } from ${JSON.stringify(new URL("../src/index.js", import.meta.url).href)};
             const factory = ${factorySource};
             const { task, context } = factory();
             try {
               parentPort.postMessage({ ok: true, result: run(task, context) });
             } catch (e) {
               parentPort.postMessage({ ok: false, error: { name: e?.name ?? "Error", code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 500) } });
             }`,
            { eval: true }
          )
        : new Worker(WORKER_PATH, { workerData: { task, context } });
    } catch (e) {
      finish(timeoutEnvelope());
      return;
    }
    const timer = setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        // already gone
      }
      finish(timeoutEnvelope());
    }, timeoutMs);
    // Do not keep the event loop alive for a hung worker after timeout.
    if (typeof timer.unref === "function") timer.unref();
    worker.on("message", (msg) => {
      if (msg && msg.ok) {
        finish(msg.result);
      } else {
        const err = (msg && msg.error) || {};
        finish({
          ...timeoutEnvelope(),
          diagnostics: [
            {
              code: "WORKER_ERROR",
              severity: "critical",
              source_ref: null,
              record_id: null,
              reason: `worker failed: ${err.name ?? "Error"}${err.code ? ` (${err.code})` : ""}: ${(err.message ?? "").slice(0, 200)}`,
            },
          ],
        });
      }
    });
    worker.on("error", () => finish(timeoutEnvelope()));
    worker.on("exit", (code) => {
      if (code !== 0) finish(timeoutEnvelope());
    });
  });
}
