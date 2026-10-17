// EMEM-001b regression probe: synchronous hang AFTER an await inside an
// async iterator's next() step. The async generator suspends at the await,
// then resumes into a busy loop — the continuation runs on the driving
// thread, so no timer on that thread can ever fire. recallAsync must drain
// async stores in a worker thread: the busy loop blocks the WORKER, the
// caller's own timer fires, the worker is TERMINATED, and
// WATCHDOG_EXHAUSTED is returned — never ETIMEDOUT/SIGTERM from an
// external parent kill, and never a late successful result.
//
// Runs in a CHILD PROCESS (spawned by the vitest suite) so a regression
// here could never hang the test runner itself.
//
// Usage: node hangProbe.asyncNextAfterAwait.child.mjs
// Exit 0 + "ASYNC_NEXT_AFTER_AWAIT_HANG_PROBE_PASS" on stdout when the probe passes.

import { recallAsync } from "../recall.mjs";
import { syntheticHost } from "../battery.mjs";

const store = {
  async *episodesInOrder() {
    await Promise.resolve();
    while (true) {
      // busy loop AFTER the await: resumes on the driving thread
    }
  },
};

const t0 = Date.now();
const out = await recallAsync(store, syntheticHost(), { taskId: "eng-task-001" }, { timeoutMs: 100 });
const elapsed = Date.now() - t0;
if (out.result === "REFUSED" && out.code === "WATCHDOG_EXHAUSTED" && out.results === undefined && elapsed < 2000) {
  console.log(`ASYNC_NEXT_AFTER_AWAIT_HANG_PROBE_PASS elapsed=${elapsed}ms`);
  process.exit(0);
} else {
  console.log(`ASYNC_NEXT_AFTER_AWAIT_HANG_PROBE_FAIL result=${out.result} code=${out.code} elapsed=${elapsed}ms`);
  process.exit(1);
}
