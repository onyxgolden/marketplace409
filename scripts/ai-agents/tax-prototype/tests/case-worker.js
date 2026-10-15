/**
 * case-worker.js — worker-thread entry for a single draft case.
 *
 * Host-side watchdog infrastructure: the battery runs each case in its
 * own worker so the host can interrupt stuck work. The `hang` flag is
 * worker-level injected hanging work for the watchdog regression — it is
 * handled here and never reaches the agent.
 */

import { parentPort, workerData } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const { root, task, context, hang } = workerData ?? {};

if (hang) {
  // Injected hanging work: spin forever, simulating a stuck case. The host
  // watchdog must terminate this worker and refuse the case.
  for (;;) {
    // intentionally empty: spin until the host watchdog terminates this worker
  }
}

try {
  const { run } = await import(pathToFileURL(join(root, "src", "index.js")).href);
  const result = run(task, context);
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  parentPort.postMessage({ ok: false, error: String((e && e.stack) || e) });
}
