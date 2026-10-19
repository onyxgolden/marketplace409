/**
 * run-guarded.js — external 5-second watchdog around the full run() path.
 *
 * S648A-006: run() executes in a worker thread (process boundary). If it
 * does not settle within 5000ms, the worker is terminated and a bounded
 * REFUSED envelope (complete:false, empty domain collections) is returned.
 * A cooperative timer on the blocked thread is insufficient — the watchdog
 * is external to the work.
 *
 * Hardening (third fix round):
 * - Descriptor-safe transport admission BEFORE worker creation: the
 *   structured-clone of workerData runs on the parent thread and would
 *   invoke request-supplied getters. assertDeepNoAccessors rejects them
 *   first; the parent never touches accessor code.
 * - Settlement state (timer) is initialized BEFORE any fallible
 *   construction; the constructor-error path can no longer hit a TDZ.
 * - Worker-construction and clone failures return a bounded named refusal
 *   (TRANSPORT_REFUSED), never a thrown ReferenceError.
 *
 * Usage: import { runGuarded, GUARD_TIMEOUT_MS } from "./runner/run-guarded.js";
 *   const result = await runGuarded(task, context); // always settles
 */

import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { assertDeepNoAccessors } from "../src/schemas.js";

export const GUARD_TIMEOUT_MS = 5000;

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), "guarded-worker.js");

function baseEnvelope() {
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
    diagnostics: [],
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

function timeoutEnvelope() {
  const e = baseEnvelope();
  e.diagnostics = [
    {
      code: "EXECUTION_TIMEOUT",
      severity: "critical",
      source_ref: null,
      record_id: null,
      reason: `public task execution did not settle within ${GUARD_TIMEOUT_MS}ms; worker terminated, no partial output`,
    },
  ];
  return e;
}

function transportEnvelope(code, reason) {
  const e = baseEnvelope();
  e.diagnostics = [
    {
      code,
      severity: "critical",
      source_ref: null,
      record_id: null,
      reason,
    },
  ];
  return e;
}

/**
 * Run the task under the external watchdog. Always settles: either with
 * the worker's result, a worker error envelope, a transport refusal, or
 * the timeout envelope.
 *
 * task/context must be plain data. Descriptor-safe admission rejects
 * accessor properties before the parent thread clones anything; hang
 * probes construct malicious inputs inside the worker via `factorySource`
 * so the parent never touches them.
 */
export function runGuarded(task, context, timeoutMs = GUARD_TIMEOUT_MS, factorySource = null) {
  return new Promise((resolve) => {
    let settled = false;
    // S648A-006: settlement state initialized BEFORE any fallible
    // construction. The old code declared `const timer` after the
    // try/catch, so a constructor failure hit the temporal dead zone.
    let timer = null;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(result);
      }
    };

    // S648A-006: descriptor-safe transport admission. structured-clone of
    // workerData executes on the PARENT thread; without this gate, an
    // enumerable getter (e.g. {get clock(){while(true){}}}) would run
    // before the watchdog timer exists. Rejected here as bounded refusal.
    if (!factorySource) {
      try {
        assertDeepNoAccessors(task, "transport.task");
        assertDeepNoAccessors(context, "transport.context");
      } catch (err) {
        finish(
          transportEnvelope(
            "TRANSPORT_REFUSED",
            `transport admission refused: ${String(err?.message ?? err).slice(0, 300)}`
          )
        );
        return;
      }
    }

    let worker = null;
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
    } catch (err) {
      // S648A-006: construction/clone failure is a bounded named refusal,
      // never a thrown TDZ ReferenceError.
      finish(
        transportEnvelope(
          "TRANSPORT_REFUSED",
          `worker transport failed: ${err?.name ?? "Error"}: ${String(err?.message ?? err).slice(0, 300)}`
        )
      );
      return;
    }

    timer = setTimeout(() => {
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
        const e = baseEnvelope();
        e.diagnostics = [
          {
            code: "WORKER_ERROR",
            severity: "critical",
            source_ref: null,
            record_id: null,
            reason: `worker failed: ${err.name ?? "Error"}${err.code ? ` (${err.code})` : ""}: ${(err.message ?? "").slice(0, 200)}`,
          },
        ];
        finish(e);
      }
    });
    worker.on("error", () => finish(timeoutEnvelope()));
    worker.on("exit", (code) => {
      if (code !== 0) finish(timeoutEnvelope());
    });
  });
}
