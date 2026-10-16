// EMEM-001 regression probe: synchronous hang inside the store iterator.
// Runs in a CHILD PROCESS (spawned by the vitest suite) so a failure mode
// that blocked the event loop could never hang the test runner itself.
// The probe store busy-loops 5200ms inside episodesInOrder(); recallAsync
// must return WATCHDOG_EXHAUSTED (never a late RECALLED) and exit promptly.
//
// Usage: node hangProbe.child.mjs
// Exit 0 + "HANG_PROBE_PASS" on stdout when the probe passes.

import { recallAsync } from "../recall.mjs";
import { syntheticHost } from "../battery.mjs";

const start = Date.now();
const store = {
  *episodesInOrder() {
    while (Date.now() - start < 5200) {
      // busy loop: blocks the calling thread while it runs
    }
  },
};

const t0 = Date.now();
const out = await recallAsync(store, syntheticHost(), { taskId: "eng-task-001" }, { timeoutMs: 5000 });
const elapsed = Date.now() - t0;
if (out.result === "REFUSED" && out.code === "WATCHDOG_EXHAUSTED" && out.results === undefined) {
  console.log(`HANG_PROBE_PASS elapsed=${elapsed}ms`);
  process.exit(0);
} else {
  console.log(`HANG_PROBE_FAIL result=${out.result} code=${out.code} elapsed=${elapsed}ms`);
  process.exit(1);
}
