/**
 * guarded-worker.js — worker thread for run-guarded.js.
 * Executes run(task, context) and posts the result. If the task hangs
 * (e.g., a hanging getter in admission), this worker blocks and the
 * parent's watchdog terminates it.
 */

import { parentPort, workerData } from 'node:worker_threads';
import { run } from '../src/index.js';

try {
  const result = run(workerData.task, workerData.context);
  parentPort.postMessage({ ok: true, result });
} catch (e) {
  parentPort.postMessage({
    ok: false,
    error: { name: e?.name ?? 'Error', code: e?.code ?? null, message: String(e?.message ?? e).slice(0, 500) },
  });
}
