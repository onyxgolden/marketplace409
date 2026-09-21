/**
 * FIFO serializer for designer saves.
 *
 * A lost-update race exists when two saves overlap: save A (rev 5) starts,
 * an edit bumps the document to rev 6, save B (rev 6) starts, B completes,
 * then A completes and persists stale rev 5 over rev 6. The revision-guarded
 * MARK_SAVED protects the UI's dirty flag, but it cannot un-write the stale
 * row in the database.
 *
 * `createSaveScheduler()` returns a `schedule(task)` function. Tasks run
 * strictly one at a time in call order: a task scheduled while another is
 * in flight does not start until the in-flight task settles. Tasks are
 * expected to snapshot the document when they *start*, so a queued save
 * always persists the freshest revision. The chain survives task failures,
 * so one failed save never wedges later ones.
 */
export function createSaveScheduler() {
  let tail = Promise.resolve();
  return function schedule(task) {
    const run = tail.then(task, task);
    // Keep the chain alive even if a task rejects; the caller still observes
    // its own task's outcome through the returned promise.
    tail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
}
