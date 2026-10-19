/**
 * timeout-probe-host.js — TEST-ONLY host for watchdog timeout probes
 * (RA652-001). This module is outside the production API: production
 * code (runner/run-guarded.js) never imports it and cannot reach it.
 *
 * The fixture worker is selected by a CLOSED ENUM: the only accepted
 * key is "hang-fixture", mapped to the fixed pinned file
 * runner/timeout-hang-worker.js. There is no executable input — no
 * factory string, no eval, no caller-supplied worker path. Unknown keys
 * refuse bounded without spawning anything.
 *
 * Each probe settles bounded: either the fixture worker posts (it never
 * does), the external timer fires and terminates it ({timeout:true}), or
 * worker construction fails ({error}).
 */

import { Worker } from "node:worker_threads";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Closed enum: the complete set of selectable fixture workers.
const FIXTURE_WORKERS = Object.freeze({
  "hang-fixture": join(ROOT, "runner", "timeout-hang-worker.js"),
});

export function fixtureWorkerKinds() {
  return Object.keys(FIXTURE_WORKERS);
}

export function runFixtureWorker(kind, timeoutMs) {
  const workerPath = FIXTURE_WORKERS[kind];
  if (typeof workerPath !== "string") {
    // Closed-enum rejection: bounded, no worker spawned, no code run.
    return Promise.resolve({
      settled: true,
      refused: true,
      reason: `unknown fixture worker kind '${String(kind).slice(0, 64)}'; closed enum is [${Object.keys(FIXTURE_WORKERS).join(", ")}]`,
    });
  }
  return new Promise((resolve) => {
    let settled = false;
    let timer = null;
    const finish = (v) => {
      if (!settled) {
        settled = true;
        if (timer !== null) clearTimeout(timer);
        resolve({ settled: true, ...v });
      }
    };
    let worker = null;
    try {
      worker = new Worker(workerPath);
    } catch (err) {
      finish({ error: `worker construction failed: ${String(err?.message ?? err).slice(0, 200)}` });
      return;
    }
    timer = setTimeout(() => {
      try {
        worker.terminate();
      } catch {
        // already gone
      }
      finish({ timeout: true });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    worker.on("message", (msg) => finish({ message: msg }));
    worker.on("error", () => finish({ timeout: true }));
    worker.on("exit", (code) => {
      if (code !== 0) finish({ timeout: true });
    });
  });
}
