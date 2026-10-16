// EMEM-001 regression probe: synchronous hang inside the store FACTORY.
// episodesInOrder() itself busy-loops forever (never returns an iterable).
// Runs in a CHILD PROCESS (spawned by the vitest suite) so a failure mode
// that blocked the event loop could never hang the test runner itself.
// recallAsync must return WATCHDOG_EXHAUSTED promptly via the V8-enforced
// preemptive boundary on the factory call — never ETIMEDOUT/SIGTERM from
// an external parent kill (a timer on the same blocked event loop cannot
// preempt it).
//
// Usage: node hangProbe.factory.child.mjs
// Exit 0 + "FACTORY_HANG_PROBE_PASS" on stdout when the probe passes.

import { recallAsync } from "../recall.mjs";
import { syntheticHost } from "../battery.mjs";

const store = {
  episodesInOrder() {
    while (true) {
      // busy loop: blocks the calling thread; V8 must interrupt it
    }
  },
};

const t0 = Date.now();
const out = await recallAsync(store, syntheticHost(), { taskId: "eng-task-001" }, { timeoutMs: 100 });
const elapsed = Date.now() - t0;
if (out.result === "REFUSED" && out.code === "WATCHDOG_EXHAUSTED" && out.results === undefined && elapsed < 2000) {
  console.log(`FACTORY_HANG_PROBE_PASS elapsed=${elapsed}ms`);
  process.exit(0);
} else {
  console.log(`FACTORY_HANG_PROBE_FAIL result=${out.result} code=${out.code} elapsed=${elapsed}ms`);
  process.exit(1);
}
