/**
 * guarded-worker.js — worker thread for run-guarded.js.
 *
 * Receives the task and context as JSON strings (inert serialized
 * transport). Parsing, admission, and execution all happen here under
 * the parent's supervised watchdog timer. A hanging Proxy can never
 * reach this worker — the parent refuses non-strings before worker
 * creation. The worker-side failure envelope uses the bounded
 * null-report contract: REFUSED, complete:false, report:null.
 */

import { parentPort, workerData } from "node:worker_threads";
import { run, AGENT_ID } from "../src/index.js";

function failEnvelope(code, reason) {
  return {
    schema_version: "1",
    agent: AGENT_ID,
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
  const task = JSON.parse(taskJson);
  const context = JSON.parse(contextJson);
  const result = run(task, context);
  parentPort.postMessage({ ok: true, result });
} catch (e) {
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
