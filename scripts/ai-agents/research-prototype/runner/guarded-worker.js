/**
 * guarded-worker.js — worker thread for run-guarded.js.
 *
 * S648A-006 (fourth fix round): receives the task and context as JSON
 * strings (inert serialized transport). Parsing, admission, and execution
 * all happen here under the parent's supervised watchdog timer. A
 * hanging Proxy can never reach this worker — the parent refuses
 * non-strings before worker creation.
 *
 * RA652-003 (fifth fix round): the worker-side failure envelope uses the
 * same bounded null-report contract as the parent: REFUSED,
 * complete:false, report:null.
 */

import { parentPort, workerData } from "node:worker_threads";
import { run } from "../src/index.js";

function failEnvelope(code, reason) {
  // RA652-003: bounded null-report refusal contract — report:null, never
  // an empty domain report object.
  return {
    schema_version: "1",
    agent: "research-agent",
    task_id: "unavailable",
    status: "REFUSED",
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false,
    source_refs: [],
    diagnostics: [{ code, severity: "critical", source_ref: null, record_id: null, reason }],
    quarantined_sources: [],
    routing_flags: [],
    report: null,
  };
}

try {
  const { taskJson, contextJson } = workerData ?? {};
  if (typeof taskJson !== "string" || typeof contextJson !== "string") {
    throw new Error("worker expected serialized JSON strings");
  }
  // JSON.parse on a string cannot execute user code. If the JSON is
  // malformed, this throws and the parent reports WORKER_ERROR bounded.
  const task = JSON.parse(taskJson);
  const context = JSON.parse(contextJson);
  const result = run(task, context);
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  // Distinguish malformed transport from run() failures.
  const isTransport = e instanceof SyntaxError;
  if (isTransport) {
    parentPort.postMessage({ ok: true, result: failEnvelope("TRANSPORT_REFUSED", `worker JSON parse failed: ${String(e.message).slice(0, 200)}`) });
  } else {
    parentPort.postMessage({
      ok: false,
      error: { name: e?.name ?? "Error", code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 500) },
    });
  }
}
