/**
 * worker-entry.js — worker-thread entry for the hosted audit entrypoint.
 * Receives { text, opts }, runs the pure auditExport, posts the report.
 * Imports only the pure core: no fs, no network, no child processes.
 */

import { parentPort } from "node:worker_threads";
import { auditExport } from "./index.js";

function workerFailure(reason, limitations) {
  return {
    status: "REFUSED",
    complete: false,
    lane: null,
    machine_id: null,
    applicability: "configuration",
    synthetic: true,
    advisory_only: true,
    limitations,
    export_identity: null,
    findings: [],
    refused_reason: reason,
    refused_evidence: "$",
    digest: null,
  };
}

parentPort.on("message", (msg) => {
  let result;
  try {
    result = auditExport(msg.text, msg.opts);
  } catch (e) {
    result = workerFailure(
      "WORKER_ERROR",
      "Worker-level failure inside the audit: no domain findings were produced."
    );
  }
  parentPort.postMessage(result);
});
