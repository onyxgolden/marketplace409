// EMEM-001 regression probe: synchronous hang inside an ASYNC iterator's
// next() step. The async generator body busy-loops forever before its
// first await — that prefix runs synchronously within next(), on the
// calling thread. Runs in a CHILD PROCESS (spawned by the vitest suite)
// so a failure mode that blocked the event loop could never hang the
// test runner itself. recallAsync must return WATCHDOG_EXHAUSTED promptly
// via the V8-enforced preemptive boundary on the sync prefix — never
// ETIMEDOUT/SIGTERM from an external parent kill (a timer on the same
// blocked event loop cannot preempt it).
//
// Usage: node hangProbe.asyncNext.child.mjs
// Exit 0 + "ASYNC_NEXT_HANG_PROBE_PASS" on stdout when the probe passes.

import { recallAsync } from "../recall.mjs";
import { syntheticHost } from "../battery.mjs";

const store = {
  async *episodesInOrder() {
    while (true) {
      // busy loop before first await: synchronous within next()
    }
  },
};

const t0 = Date.now();
const out = await recallAsync(store, syntheticHost(), { taskId: "eng-task-001" }, { timeoutMs: 100 });
const elapsed = Date.now() - t0;
if (out.result === "REFUSED" && out.code === "WATCHDOG_EXHAUSTED" && out.results === undefined && elapsed < 2000) {
  console.log(`ASYNC_NEXT_HANG_PROBE_PASS elapsed=${elapsed}ms`);
  process.exit(0);
} else {
  console.log(`ASYNC_NEXT_HANG_PROBE_FAIL result=${out.result} code=${out.code} elapsed=${elapsed}ms`);
  process.exit(1);
}
