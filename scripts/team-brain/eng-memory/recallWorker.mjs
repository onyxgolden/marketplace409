// Team Brain eng-memory slice 1 — worker-thread drain for recallAsync.
//
// This module runs ONLY inside a node:worker_threads worker spawned by
// recallAsync's drainAsyncInWorker (recall.mjs). It exists for one
// reason: an asynchronous store's post-await continuations resume on the
// thread that drives the iterator. Driving an async iterator on the
// caller's thread means a busy loop after an await blocks the caller's
// event loop forever — no timer on that thread can fire. Driving it HERE
// means only THIS thread blocks; the caller's thread stays free, its
// timer fires, and the caller terminates this worker.
//
// Protocol (parentPort):
//   in (workerData): { fnSource } — source text of the store's
//     episodesInOrder factory, reconstructed below by eval. The factory
//     must be self-contained (no closure over caller state); otherwise
//     reconstruction fails and the parent refuses with
//     STORE_BOUNDARY_REFUSED (fail closed).
//   out { t: "consultCandidate", seq } — the worker has a raw candidate
//     and asks the parent to charge it before the worker keeps it.
//   in  { t: "consultReply", seq, ok } — parent's charge decision; ok=false
//     means the aggregate budget is exhausted.
//   out { t: "drained", episodes, budgetExhausted? } — raw drained
//     episodes (structured-cloned plain data; the parent inspects them).
//   out { t: "drainError", code?, threw?, message? } — reconstruction
//     failure (code STORE_BOUNDARY_REFUSED) or a factory/iteration error.
//
// The worker never inspects episode fields and never touches host config:
// all authorization and read-permission checks run on the parent thread
// after the drain.

import { parentPort, workerData } from "node:worker_threads";

/** Reconstruct the store factory from its source text. Returns the function or null. */
function reconstructFactory(fnSource) {
  if (typeof fnSource !== "string" || fnSource.length === 0 || fnSource.length > 1_000_000) return null;
  // Method-shorthand form: "async *episodesInOrder() { ... }"
  try {
    const holder = eval(`({${fnSource}})`);
    if (holder && typeof holder.episodesInOrder === "function") return holder.episodesInOrder;
  } catch {
    // Fall through to the expression form.
  }
  // Function-expression form: "async function* () { ... }" / "() => ..." / "async () => ..."
  try {
    const fn = eval(`(${fnSource})`);
    if (typeof fn === "function") return fn;
  } catch {
    // Unrecoverable: fail closed via STORE_BOUNDARY_REFUSED.
  }
  return null;
}

let seq = 0;
const pending = new Map();
parentPort.on("message", (msg) => {
  if (msg && msg.t === "consultReply" && pending.has(msg.seq)) {
    pending.get(msg.seq)(msg.ok === true);
    pending.delete(msg.seq);
  }
});

/** Ask the parent to charge one candidate consultation before keeping it. */
function consultParent() {
  return new Promise((resolve) => {
    seq += 1;
    pending.set(seq, resolve);
    parentPort.postMessage({ t: "consultCandidate", seq });
  });
}

function drainError(code, message) {
  parentPort.postMessage({ t: "drainError", code, message });
}

/**
 * A ReferenceError while ESTABLISHING the drain (factory call, promise
 * unwrap, or first next() step) means the factory closed over caller-side
 * state that does not exist in the worker — the classic closure-capture
 * failure. Fail closed with STORE_BOUNDARY_REFUSED, never silently
 * downgraded to an unguarded in-thread drain. A ReferenceError after the
 * drain is established is a genuine store bug and propagates as a drain
 * error instead.
 */
function boundaryRefused(detail) {
  drainError("STORE_BOUNDARY_REFUSED", `async store references caller-side state: ${detail}`);
}

function thrownMessage(err) {
  return err && err.message ? err.message : String(err);
}

async function drain() {
  const factory = reconstructFactory(workerData && workerData.fnSource);
  if (!factory) {
    // Fail closed: the async store cannot cross the worker boundary, and
    // it must never be downgraded to an unguarded in-thread drain.
    drainError("STORE_BOUNDARY_REFUSED", "async store factory is not reconstructible across the worker boundary");
    return;
  }
  const store = { episodesInOrder: factory };
  let iterable;
  try {
    iterable = store.episodesInOrder();
  } catch (err) {
    if (err instanceof ReferenceError) boundaryRefused(thrownMessage(err));
    else drainError(undefined, thrownMessage(err));
    return;
  }
  if (iterable && typeof iterable.then === "function") {
    try {
      iterable = await iterable;
    } catch (err) {
      if (err instanceof ReferenceError) boundaryRefused(thrownMessage(err));
      else drainError(undefined, thrownMessage(err));
      return;
    }
  }
  const asyncIt =
    iterable && typeof iterable[Symbol.asyncIterator] === "function" ? iterable[Symbol.asyncIterator]() : null;
  const syncIt =
    !asyncIt && iterable && typeof iterable[Symbol.iterator] === "function" ? iterable[Symbol.iterator]() : null;
  if (!asyncIt && !syncIt) {
    drainError(undefined, "store.episodesInOrder() must return an iterable");
    return;
  }
  const next = asyncIt ? () => asyncIt.next() : () => syncIt.next();
  const episodes = [];
  let established = false;
  for (;;) {
    let step;
    try {
      // Any hang here — sync prefix or post-await continuation — blocks
      // THIS thread only. The parent's timer is the enforcement boundary.
      step = await next();
    } catch (err) {
      if (!established && err instanceof ReferenceError) boundaryRefused(thrownMessage(err));
      else drainError(undefined, thrownMessage(err));
      return;
    }
    established = true;
    if (!step || typeof step !== "object" || step.done) break;
    // Central charge-before-inspect lives on the parent thread: the raw
    // candidate is held, not inspected, until the parent approves.
    const ok = await consultParent();
    if (!ok) {
      parentPort.postMessage({ t: "drained", episodes, budgetExhausted: true });
      return;
    }
    episodes.push(step.value);
  }
  try {
    parentPort.postMessage({ t: "drained", episodes });
  } catch (err) {
    // Structured-clone of a hostile yielded value failed inside the
    // worker: contained here, reported as a drain error.
    drainError(undefined, "episode payload is not transferable across the worker boundary");
  }
}

drain().catch((err) => {
  drainError(undefined, err && err.message ? err.message : String(err));
});
