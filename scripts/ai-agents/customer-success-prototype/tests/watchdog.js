/**
 * watchdog.js — host worker watchdog for review cases.
 *
 * runCaseWithWatchdog runs one (task, context) case in a worker thread and
 * interrupts it at the timeout. A timeout yields { timeout: true }; the
 * caller converts that into the named fail-closed WATCHDOG_TIMEOUT refusal.
 * Normal completion yields { ok: true, result } or { ok: false, error }.
 */

import { Worker } from "node:worker_threads";

export function runCaseWithWatchdog(root, task, context, { timeoutMs = 5000, hang = false } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate().catch(() => {});
      resolve(value);
    };
    const worker = new Worker(new URL("./case-worker.js", import.meta.url), {
      workerData: { root, task, context, hang },
    });
    const timer = setTimeout(() => {
      done({ timeout: true });
    }, timeoutMs);
    worker.once("message", (msg) => done(msg));
    worker.once("error", (e) => done({ ok: false, error: String((e && e.stack) || e) }));
    worker.once("exit", (code) => {
      if (code !== 0) done({ ok: false, error: `worker exited with code ${code}` });
    });
  });
}

/** Named fail-closed refusal produced when the watchdog fires. */
export function watchdogRefusal(task, timeoutMs) {
  return {
    schema_version: "1",
    agent: "customer-success-agent",
    task_id: task && typeof task === "object" ? "cs-watchdog" : "cs-invalid-task",
    status: "REFUSED",
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete: false,
    source_refs: [],
    diagnostics: [
      {
        code: "WATCHDOG_TIMEOUT",
        severity: "critical",
        source_ref: null,
        record_id: null,
        reason: `host watchdog: case exceeded ${timeoutMs}ms with no result; worker terminated; no partial output accepted`,
      },
    ],
    quarantined_sources: [],
    routing_flags: [],
    report: {
      population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
      ticket_results: [],
      metrics: {
        response_time: { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable", pending_count: 0, excluded_count: 0, total_population: 0 },
        resolution_time: { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable", pending_count: 0, excluded_count: 0, total_population: 0 },
        sla_compliance: { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable", pending_count: 0, excluded_count: 0, total_population: 0 },
        csat_mean: { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable" },
        csat_positive_share: { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable" },
      },
      header_comparisons: [],
      pending_ids: [],
      excluded_ids: [],
      coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0, pending_count: 0 },
    },
  };
}
