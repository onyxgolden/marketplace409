/**
 * watchdog.js — host worker watchdog for marketing cases.
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
    agent: "marketing",
    task_id: "mkt-watchdog-timeout",
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
      taxonomy_version: "1",
      campaigns: [],
      metrics: [],
      pooled: [],
      header_comparisons: [],
      duplicate_groups: [],
      exclusions: [],
      coverage: { campaigns: 0, events_seen: 0, events_used: 0, events_excluded: 0, aggregate_rows: 0 },
      unattached_drafts: [],
    },
  };
}
