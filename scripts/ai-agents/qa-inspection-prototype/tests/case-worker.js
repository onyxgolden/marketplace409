/**
 * case-worker.js — host-side worker for one battery case (QAI-005 watchdog).
 *
 * Runs the pure prototype in a worker thread so the host can terminate a
 * stuck or excessively expensive case from the process boundary. The worker
 * performs the repeat run itself and reports byte-identity.
 *
 * workerData: { moduleRoot, task, fixtures, clock }
 * posts: { result, deterministic } or throws.
 */
import { workerData, parentPort } from "node:worker_threads";
import { pathToFileURL } from "node:url";
import { join } from "node:path";

const { moduleRoot, task, fixtures, clock } = workerData;
const mod = await import(pathToFileURL(join(moduleRoot, "src", "index.js")).href);

const freshContext = () => ({
  clock,
  resolver: new mod.FixtureResolver(fixtures),
  recordToolCall: () => {},
});

const r1 = mod.run(task, freshContext());
const r2 = mod.run(task, freshContext());
parentPort.postMessage({
  result: r1,
  deterministic: mod.canonicalJson(r1) === mod.canonicalJson(r2),
});
