/**
 * host.js — host entrypoint with a REAL worker watchdog.
 * Original code. Dependency: node:worker_threads only.
 *
 * The pure core (index.js and friends) never spawns anything and keeps its
 * no-tool capability. This host layer runs the actual audit inside a worker
 * thread and terminates that worker on a hard deadline: a cooperative
 * Date.now clock is not claimed to enforce anything here — exceeding the
 * deadline destroys the worker and returns a bounded WATCHDOG_EXCEEDED
 * refusal with no domain findings.
 *
 * auditExportHosted(input, opts, host) -> Promise<report>
 *   input: JSON text (preferred) or a plain object. Objects are normalized
 *          to text through the bounded admission contract in the parent so
 *          structured cloning can never invoke a getter.
 *   opts:  { asOfMs, pins } — pins are admitted and cloned in the parent.
 *   host:  { timeoutMs = 5000, spawnWorker } — injectable for tests.
 */

import { Worker } from "node:worker_threads";
import { admitBytes, admitDocument, BudgetExceeded, CandidateBudget, SchemaError } from "./budget.js";
import { canonicalJson } from "./canonical.js";

const WORKER_URL = new URL("./worker-entry.js", import.meta.url);

function defaultSpawnWorker() {
  return new Worker(WORKER_URL);
}

function baseRefusal(reason, limitations) {
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

/**
 * Normalize input to JSON text without ever invoking a getter: strings
 * pass the byte cap; objects go through the bounded charge-before-inspect
 * admission copy first.
 */
function normalizeInputToText(input) {
  if (typeof input === "string") {
    admitBytes(input);
    return input;
  }
  if (input !== null && typeof input === "object") {
    const copy = admitDocument(input, new CandidateBudget(), { label: "host-admission" });
    return canonicalJson(copy);
  }
  const e = new SchemaError("not_object", "input must be JSON text or an object");
  throw e;
}

function normalizePins(pins) {
  if (pins === null || pins === undefined) return {};
  if (typeof pins !== "object") return {};
  return admitDocument(pins, new CandidateBudget(), { label: "host-pins" });
}

function mapHostAdmissionError(e) {
  if (e instanceof BudgetExceeded) return "BUDGET_EXCEEDED";
  if (e instanceof SchemaError && e.code === "accessor") return "ACCESSOR_REJECTED";
  return "INVALID_INPUT";
}

export async function auditExportHosted(input, opts = {}, host = {}) {
  const timeoutMs = host.timeoutMs ?? 5000;
  const spawnWorker = host.spawnWorker ?? defaultSpawnWorker;

  let text;
  let pins;
  try {
    text = normalizeInputToText(input);
    pins = normalizePins(opts.pins);
  } catch (e) {
    return baseRefusal(
      mapHostAdmissionError(e),
      "Host admission refused the input before the worker started; no domain findings were produced."
    );
  }

  const workerOpts = {
    asOfMs: Number.isFinite(opts.asOfMs) ? opts.asOfMs : Date.now(),
    pins,
  };

  let worker;
  try {
    worker = spawnWorker();
  } catch (e) {
    return baseRefusal("WORKER_ERROR", "Host could not start the audit worker; no domain findings were produced.");
  }

  try {
    const outcome = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ __timeout: true }), timeoutMs);
      worker.once("message", (msg) => {
        clearTimeout(timer);
        resolve({ result: msg });
      });
      worker.once("error", () => {
        clearTimeout(timer);
        resolve({ __workerError: true });
      });
      try {
        worker.postMessage({ text, opts: workerOpts });
      } catch (e) {
        clearTimeout(timer);
        resolve({ __workerError: true });
      }
    });

    if (outcome.__timeout) {
      return baseRefusal(
        "WATCHDOG_EXCEEDED",
        "Hard worker watchdog: the audit exceeded its deadline, the worker was terminated, and no domain findings were produced."
      );
    }
    if (outcome.__workerError) {
      return baseRefusal("WORKER_ERROR", "Audit worker errored; no domain findings were produced.");
    }
    const r = outcome.result;
    if (r && typeof r === "object" && typeof r.status === "string") return r;
    return baseRefusal("WORKER_ERROR", "Audit worker returned a malformed result; no domain findings were produced.");
  } finally {
    try {
      await worker.terminate();
    } catch (e) {
      // Termination is best-effort; the refusal above already stands.
    }
  }
}
