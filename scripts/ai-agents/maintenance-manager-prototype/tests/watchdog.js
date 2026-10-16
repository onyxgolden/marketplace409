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
    agent: "maintenance-manager-agent",
    task_id: task && typeof task === "object" ? "mm-watchdog" : "mm-invalid-task",
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
      backlog: { total: 0, by_priority: { P1: 0, P2: 0, P3: 0 }, by_bin: { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0 } },
      overdue: { total: 0, unknown_due_count: 0, by_priority: { P1: 0, P2: 0, P3: 0 } },
      cancelled_count: 0,
      pm_compliance: { basis_state: "UNVERIFIABLE", denominator: null, numerator: null, ratio: null, display_percent: null, early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0, poisoning_occurrence_ids: [] },
      header_comparisons: [],
      integrity_findings: [],
      excluded_ids: { future_created: [], orphan_asset_work_orders: [], invalid_completion: [], orphan_asset_pm_occurrences: [] },
      coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
    },
  };
}
