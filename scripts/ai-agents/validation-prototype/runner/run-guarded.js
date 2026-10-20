/**
 * run-guarded.js — external 5-second watchdog around the full run() path.
 *
 * The parent thread accepts ONLY JSON strings (typeof check is
 * non-executing — safe against any Proxy trap; a Proxy refuses with
 * TRANSPORT_REFUSED before reflective inspection). Byte-bounded
 * (256KiB task + 256KiB context, plus the aggregate 256KiB cap).
 * Strings are inert: workerData cloning cannot execute code. The
 * worker parses, admits, and executes under the supervised timer.
 * JSON-only launcher: no executable task factory, no eval, no
 * request-code execution on either thread.
 *
 * Usage: import { runGuarded, GUARD_TIMEOUT_MS } from "./runner/run-guarded.js";
 *   const result = await runGuarded(JSON.stringify(task), JSON.stringify(context));
 */

import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const GUARD_TIMEOUT_MS = 5000;
export const GUARD_MAX_TRANSPORT_BYTES = 262144;

const WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), "guarded-worker.js");

// The bounded null-report refusal contract, identical to
// src/index.js refused(): REFUSED, complete:false, report:null.
function baseEnvelope() {
  return {
    schema_version: "1",
    agent: "validation-agent",
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

export function runGuarded(taskJson, contextJson, timeoutMs = GUARD_TIMEOUT_MS) {
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (result) => {
      if (!settled) {
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve(result);
      }
    };

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
    const workerDataPayload = { taskJson, contextJson };

    let worker = null;
    try {
      worker = new Worker(WORKER_PATH, { workerData: workerDataPayload });
    } catch (err) {
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
