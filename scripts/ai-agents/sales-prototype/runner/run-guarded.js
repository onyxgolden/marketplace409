/**
 * run-guarded.js — external 5-second watchdog around the full run() path.
 *
 * S648A-006: run() executes in a worker thread (process boundary). If it
 * does not settle within 5000ms, the worker is terminated and a bounded
 * REFUSED envelope (complete:false, report:null) is returned. A
 * cooperative timer on the blocked thread is insufficient — the watchdog
 * is external to the work.
 *
 * S653-008: the executable factorySource/eval path is REMOVED. The
 * production API accepts ONLY JSON strings (typeof check is non-executing
 * and cannot trigger Proxy traps). Byte-bounded (256KiB per side,
 * 256KiB aggregate). Strings are inert: workerData cloning cannot execute
 * code. Hang tests use fixed, manifest-authenticated test workers via
 * runGuardedWithWorker (see tests/hang-worker.js), never eval.
 *
 * Usage: import { runGuarded, runGuardedWithWorker, GUARD_TIMEOUT_MS } from "./runner/run-guarded.js";
 *   const result = await runGuarded(JSON.stringify(task), JSON.stringify(context));
 */

import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_TIMEOUT_MS = 5000;
// S648A-006: transport byte cap. Serialized inputs exceeding this refuse
// before worker creation.
export const GUARD_MAX_TRANSPORT_BYTES = 262144;

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), "guarded-worker.js");

/**
 * S653-008: every refusal envelope carries report:null per the refusal
 * contract — never a Research-shaped {claims, coverage} artifact.
 */
function baseEnvelope() {
  return {
    schema_version: "1",
    agent: "sales-agent",
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
    report: null,
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
 * taskJson/contextJson must be JSON strings — a bounded inert serialized
 * transport. The typeof check is the non-executing admission primitive:
 * it cannot trigger Proxy traps, unlike Object.getOwnPropertyNames /
 * getOwnPropertyDescriptor. Non-strings (including Proxies) refuse with
 * TRANSPORT_REFUSED before any reflective inspection.
 */
export function runGuarded(taskJson, contextJson, timeoutMs = GUARD_TIMEOUT_MS) {
  return runGuardedWithWorker(taskJson, contextJson, timeoutMs, WORKER_PATH);
}

/**
 * Test seam: identical to runGuarded but the worker script path is fixed
 * by the caller. Hang tests pass a manifest-authenticated worker that
 * never settles (tests/hang-worker.js). No eval, no factories.
 */
export function runGuardedWithWorker(taskJson, contextJson, timeoutMs, workerPath) {
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

    // Inert serialized transport admission. This typeof check is the
    // non-executing admission primitive — it cannot trigger Proxy traps.
    // Non-strings (including Proxies) refuse here, before any reflection.
    if (typeof taskJson !== "string" || typeof contextJson !== "string") {
      finish(
        transportEnvelope(
          "TRANSPORT_REFUSED",
          "guarded transport requires serialized JSON strings; non-string (possibly Proxy) input refused before reflective inspection"
        )
      );
      return;
    }
    if (
      Buffer.byteLength(taskJson, "utf8") > GUARD_MAX_TRANSPORT_BYTES ||
      Buffer.byteLength(contextJson, "utf8") > GUARD_MAX_TRANSPORT_BYTES
    ) {
      finish(
        transportEnvelope(
          "TRANSPORT_REFUSED",
          `serialized transport exceeds ${GUARD_MAX_TRANSPORT_BYTES} bytes; refusing before worker creation`
        )
      );
      return;
    }
    // S648-006 (fifth fix round): aggregate input byte budget. The
    // individual caps above do not imply an invocation-wide cap — a
    // 200KiB task + 200KiB context would pass both but exceed the
    // 256KiB aggregate budget. Enforce the combined total here.
    if (
      Buffer.byteLength(taskJson, "utf8") +
        Buffer.byteLength(contextJson, "utf8") >
      GUARD_MAX_TRANSPORT_BYTES
    ) {
      finish(
        transportEnvelope(
          "TRANSPORT_REFUSED",
          `aggregate serialized input exceeds ${GUARD_MAX_TRANSPORT_BYTES} bytes; refusing before worker creation`
        )
      );
      return;
    }
    // Strings are inert: structured-clone of workerData cannot execute
    // code. Parsing and admission happen inside the supervised worker.
    const workerDataPayload = { taskJson, contextJson };

    let worker = null;
    try {
      worker = new Worker(workerPath, { workerData: workerDataPayload });
    } catch (err) {
      // Construction/clone failure is a bounded named refusal, never a
      // thrown TDZ ReferenceError.
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
