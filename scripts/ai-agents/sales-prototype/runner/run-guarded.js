/**
 * run-guarded.js — external 5-second watchdog around the full run() path.
 *
 * S648A-006: run() executes in a worker thread (process boundary). If it
 * does not settle within 5000ms, the worker is terminated and a bounded
 * REFUSED envelope (complete:false, report:null) is returned. A
 * cooperative timer on the blocked thread is insufficient — the watchdog
 * is external to the work.
 *
 * S653-008 (fix round 2): there is NO caller-selectable worker path. The
 * production API runGuarded() always constructs the single fixed worker
 * (runner/guarded-worker.js, resolved from this module's own directory).
 * The old runGuardedWithWorker(taskJson, contextJson, timeoutMs,
 * workerPath) seam — which passed an arbitrary filesystem path straight
 * to `new Worker` and accepted any {ok:true,result} message — is REMOVED.
 * Hang coverage uses runGuardedWithTestWorker(), a CLOSED identity: the
 * caller names one of the manifest-pinned test workers ("hang"), and the
 * path is resolved internally. Unknown names refuse. Worker results are
 * shape-checked before acceptance; a malformed/forged result is contained
 * as WORKER_ERROR, never trusted.
 *
 * Usage: import { runGuarded, runGuardedWithTestWorker, GUARD_TIMEOUT_MS } from "./runner/run-guarded.js";
 *   const result = await runGuarded(JSON.stringify(task), JSON.stringify(context));
 */

import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_TIMEOUT_MS = 5000;
// S648A-006: transport byte cap. Serialized inputs exceeding this refuse
// before worker creation.
export const GUARD_MAX_TRANSPORT_BYTES = 262144;

const HERE = dirname(fileURLToPath(import.meta.url));
const PROTO_ROOT = join(HERE, "..");
const WORKER_PATH = join(HERE, "guarded-worker.js");
// S653-008 (fix round 2): closed test-worker identity. Keys are the only
// selectable values; paths resolve inside this package — never from the
// caller. Every listed file is manifest-pinned and trust-authenticated.
const TEST_WORKERS = {
  hang: join(PROTO_ROOT, "tests", "hang-worker.js"),
};

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
 *
 * S653-008 (fix round 2): the worker is ALWAYS the fixed production
 * worker. There is no path parameter.
 */
export function runGuarded(taskJson, contextJson, timeoutMs = GUARD_TIMEOUT_MS) {
  return runGuardedInternal(taskJson, contextJson, timeoutMs, WORKER_PATH);
}

/**
 * S653-008 (fix round 2): test-only seam with a CLOSED worker identity.
 * workerName must be a key of TEST_WORKERS ("hang"); the path is resolved
 * internally from this package. Arbitrary caller-supplied paths are not
 * accepted — the old runGuardedWithWorker(taskJson, contextJson,
 * timeoutMs, workerPath) export is removed.
 */
export function runGuardedWithTestWorker(taskJson, contextJson, timeoutMs, workerName) {
  const workerPath = TEST_WORKERS[workerName];
  if (!workerPath) {
    return Promise.resolve(
      transportEnvelope(
        "TRANSPORT_REFUSED",
        `unknown test worker '${String(workerName)}'; only the closed manifest-pinned test-worker identities are allowed`
      )
    );
  }
  return runGuardedInternal(taskJson, contextJson, timeoutMs, workerPath);
}

/**
 * The worker result must be a well-formed sales-agent envelope before it
 * is trusted. A forged or malformed {ok:true,result} is contained as
 * WORKER_ERROR, never passed through (S653-008 fix round 2).
 */
function isResultEnvelope(r) {
  return (
    r !== null &&
    typeof r === "object" &&
    r.schema_version === "1" &&
    r.agent === "sales-agent" &&
    typeof r.status === "string" &&
    typeof r.complete === "boolean" &&
    "report" in r &&
    Array.isArray(r.diagnostics)
  );
}

function runGuardedInternal(taskJson, contextJson, timeoutMs, workerPath) {
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
      if (msg && msg.ok === true && isResultEnvelope(msg.result)) {
        finish(msg.result);
      } else if (msg && msg.ok === true) {
        // S653-008 (fix round 2): the worker posted ok:true with a
        // malformed or forged result — contain it, never trust it.
        const e = baseEnvelope();
        e.diagnostics = [
          {
            code: "WORKER_ERROR",
            severity: "critical",
            source_ref: null,
            record_id: null,
            reason: "worker returned a malformed result envelope; contained, not trusted",
          },
        ];
        finish(e);
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
