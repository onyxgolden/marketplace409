// Team Brain slice 4 — verified end-to-end handoffs: fault-injection tests.
//
// Every test runs against synthetic fixtures only: an in-memory sandbox
// Git (no network), a PGlite handoff machine, and the pure slice-3
// outbox. Timestamps are fixed literals; no wall-clock reads. A
// "restart" is a fresh driver instance over the same ledger, outbox
// holder, Git, and (for one test) a reopened PGlite data directory —
// the same stores a crashed worker would resume from.
//
// Fault classes (brief Section 9, P4 row): crash after every
// external/local boundary, lost Git success, wrong repo/path/blob/
// head/time/actor/reason replay, stale worker, head moves before
// consumption, missing provenance, queue receipt mismatch.

import { describe, expect, it, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { freshBackend, tempDir, cleanupTempDirs } from "./helpers.mjs";
import { createVerifiedHandoffDriver, createHandoffLedger } from "../service/verifiedHandoff.mjs";
import { gitBlobSha1, EMPTY_BLOB, sha256Hex } from "../service/gitIdentity.mjs";
import { P4_CODES } from "../service/errors.mjs";
import { P3_CODES } from "../orchestrator/errors.mjs";
import { CODES } from "../ledger/errors.mjs";
import { createTask } from "../orchestrator/controller.mjs";
import { enqueueOutbox, claimOutbox, recordDelivery } from "../orchestrator/outbox.mjs";
import { stableStringify } from "../report/stableStringify.mjs";

afterEach(() => {
  cleanupTempDirs();
});

const REPO = "onyxgolden/forge-ai-drop";
const OUTCOME_PATH = "results/team-brain/outcome-1.json";
const QUEUE_PATH = "results/team-brain/queue/1.json";
const T0 = "2026-10-28T10:00:00Z";
const T1 = "2026-10-28T10:01:00Z";
const T2 = "2026-10-28T10:02:00Z";
const T3 = "2026-10-28T10:03:00Z";
const T4 = "2026-10-28T10:04:00Z";
const T5 = "2026-10-28T10:05:00Z";

function tbError(code, message = code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function fakeCommit(...parts) {
  return createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 40);
}

// Sandbox Git: commits are immutable full file maps; every write is a
// new commit; blob identity is real gitBlobSha1. failNextWrite lets a
// test simulate a lost reply (write lands, reply never arrives) or a
// pre-write transport refusal.
function createSandboxGit() {
  const repos = new Map();
  let writes = 0;
  let failNext = null;
  function repoState(repo) {
    if (!repos.has(repo)) {
      const root = fakeCommit("root", repo);
      repos.set(repo, { head: root, commits: new Map([[root, new Map()]]) });
    }
    return repos.get(repo);
  }
  return {
    writeCount: () => writes,
    failNextWrite(mode) {
      failNext = mode;
    },
    currentBlob(repo, path) {
      const st = repoState(repo);
      const file = st.commits.get(st.head).get(path);
      return file ? file.blob : EMPTY_BLOB;
    },
    // Another writer advances the head without touching the outcome.
    writeOtherPath(repo, path, bytes) {
      const st = repoState(repo);
      const commit = fakeCommit("other", repo, path, bytes, String(writes));
      const files = new Map(st.commits.get(st.head));
      files.set(path, { bytes, blob: gitBlobSha1(bytes) });
      st.commits.set(commit, files);
      st.head = commit;
      return commit;
    },
    // Another writer overwrites the path (outcome gone / divergent).
    tamper(repo, path, bytes) {
      const st = repoState(repo);
      const commit = fakeCommit("tamper", repo, path, bytes, String(writes));
      const files = new Map(st.commits.get(st.head));
      files.set(path, { bytes, blob: gitBlobSha1(bytes) });
      st.commits.set(commit, files);
      st.head = commit;
      return commit;
    },
    async head(repo) {
      return repoState(repo).head;
    },
    async read({ repo, commit, path }) {
      const st = repoState(repo);
      const files = st.commits.get(commit);
      if (!files) throw tbError(P4_CODES.GIT_NOT_FOUND, `no commit ${commit}`);
      const file = files.get(path);
      if (!file) throw tbError(P4_CODES.GIT_NOT_FOUND, `no path ${path} at ${commit}`);
      return { bytes: file.bytes };
    },
    async write({ repo, path, expectedPriorBlob, bytes }) {
      const st = repoState(repo);
      const current = st.commits.get(st.head).get(path);
      const priorBlob = current ? current.blob : EMPTY_BLOB;
      if (priorBlob !== expectedPriorBlob) throw tbError(P4_CODES.GIT_CAS_CONFLICT, "stale prior blob");
      if (failNext === "unavailable") {
        failNext = null;
        throw tbError(P4_CODES.GIT_UNAVAILABLE, "transport down before write");
      }
      const newBlob = gitBlobSha1(bytes);
      const commit = fakeCommit("write", repo, path, newBlob, String(writes));
      const files = new Map(st.commits.get(st.head));
      files.set(path, { bytes, blob: newBlob });
      st.commits.set(commit, files);
      st.head = commit;
      writes += 1;
      if (failNext === "lost-reply") {
        failNext = null;
        throw tbError(P4_CODES.GIT_LOST_REPLY, "reply lost after write");
      }
      failNext = null;
      return { repo, priorBlob: expectedPriorBlob, newBlob, head: commit, path };
    },
  };
}

async function setup({ workerId = "worker-a", generation = 1, provenance = "VERIFIED", allowedRepos = undefined } = {}) {
  const { db, handoffs } = await freshBackend();
  const git = createSandboxGit();
  const outbox = { entries: [] };
  const ledger = createHandoffLedger();
  const provenanceState = { status: provenance };
  const provenanceFor =
    provenance === null
      ? null
      : () => ({ status: provenanceState.status });
  const driver = createVerifiedHandoffDriver({
    handoffs,
    git,
    outboxEntries: outbox,
    ledger,
    workerId,
    generation,
    provenanceFor,
    ...(allowedRepos ? { allowedRepos } : {}),
  });
  return { db, handoffs, git, outbox, ledger, driver, provenanceState, provenanceFor };
}

// A restart: same durable stores, fresh driver instance.
function restart(ctx, { workerId = "worker-a", generation = 1, provenanceFor = undefined } = {}) {
  return createVerifiedHandoffDriver({
    handoffs: ctx.handoffs,
    git: ctx.git,
    outboxEntries: ctx.outbox,
    ledger: ctx.ledger,
    workerId,
    generation,
    provenanceFor: provenanceFor !== undefined ? provenanceFor : ctx.provenanceFor,
  });
}

function taskList() {
  return [createTask({ id: "task-1", goal: "synthetic task goal", filedAt: T0, requiredOutputs: [] })];
}

async function begin(ctx, driver = ctx.driver) {
  return driver.beginVerified({
    handoffId: "h-1",
    taskId: "task-1",
    taskSnapshot: { snapshotRevision: 0, assignmentEpoch: 0 },
    actor: "worker-a",
    recordedAt: T0,
    reason: "begin",
  });
}

async function publish(ctx, driver = ctx.driver, extra = {}) {
  return driver.publishOutcome({
    handoffId: "h-1",
    operationId: "op-outcome-1",
    content: { result: "done", n: 3 },
    targetRepo: REPO,
    targetPath: OUTCOME_PATH,
    expectedPriorBlob: EMPTY_BLOB,
    actor: "worker-a",
    recordedAt: T1,
    reason: "publish",
    ...extra,
  });
}

async function readback(ctx, driver = ctx.driver, extra = {}) {
  return driver.verifyReadback({
    handoffId: "h-1",
    verifier: "reader-1",
    checkedAt: T2,
    reason: "readback",
    ...extra,
  });
}

async function queueAnswer(ctx, driver = ctx.driver, extra = {}) {
  return driver.recordQueueAnswer({
    handoffId: "h-1",
    taskId: "task-1",
    queueOperationId: "op-queue-1",
    queueExportBytes: "# queue export\n- h-1 answered\n",
    targetRepo: REPO,
    targetPath: QUEUE_PATH,
    expectedPriorBlob: EMPTY_BLOB,
    actor: "worker-a",
    recordedAt: T3,
    reason: "queue",
    tasks: taskList(),
    ...extra,
  });
}

async function complete(ctx, driver = ctx.driver, extra = {}) {
  return driver.completeVerified({
    handoffId: "h-1",
    actor: "worker-a",
    recordedAt: T4,
    reason: "complete",
    tasks: taskList(),
    ...extra,
  });
}

// Drive a handoff all the way to QUEUE_UPDATED.
async function toQueue(ctx, driver = ctx.driver) {
  await begin(ctx, driver);
  await publish(ctx, driver);
  await readback(ctx, driver);
  return queueAnswer(ctx, driver);
}

async function toComplete(ctx, driver = ctx.driver) {
  await toQueue(ctx, driver);
  return complete(ctx, driver);
}

function expectCode(promise, code) {
  return expect(promise).rejects.toMatchObject({ code });
}

describe("happy path and replay", () => {
  it("full journey OPEN -> COMPLETE closes the ledger item and the task", async () => {
    const ctx = await setup();
    const done = await toComplete(ctx);
    expect(done.handoff.state).toBe("COMPLETE");
    expect(done.queueItem.status).toBe("CLOSED");
    const closed = done.tasks.find((t) => t.id === "task-1");
    expect(closed.status).toBe("DONE");
    expect(closed.handoffClose.handoffId).toBe("h-1");
    const receipts = ctx.driver.getReceipts("h-1");
    expect(done.queueItem.closeReceiptId).toBe(receipts.queueReceipts[0].receiptId);
    expect(receipts.outcome).not.toBeNull();
    expect(receipts.readbacks).toHaveLength(2); // pinned readback + head-moved re-readback at complete
    expect(receipts.queueReceipts).toHaveLength(1);
    expect(receipts.queueReceipts[0].status).toBe("ANSWER_RECORDED_PENDING_CLOSE");
    expect(receipts.queueReceipts[0].outcome.blob).toBe(receipts.outcome.artifact.blob);
  }, 30000); // first PGlite WASM init in the file lands here

  it("standalone mode (no task binding) completes and closes its own item", async () => {
    const ctx = await setup();
    await ctx.driver.beginVerified({ handoffId: "h-s", actor: "worker-a", recordedAt: T0, reason: "begin" });
    await ctx.driver.publishOutcome({
      handoffId: "h-s",
      operationId: "op-s",
      content: { ok: true },
      targetRepo: REPO,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      actor: "worker-a",
      recordedAt: T1,
      reason: "publish",
    });
    await ctx.driver.verifyReadback({ handoffId: "h-s", verifier: "reader-1", checkedAt: T2, reason: "readback" });
    await ctx.driver.recordQueueAnswer({
      handoffId: "h-s",
      queueOperationId: "op-qs",
      queueExportBytes: "queue export s",
      targetRepo: REPO,
      targetPath: QUEUE_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      actor: "worker-a",
      recordedAt: T3,
      reason: "queue",
    });
    const done = await ctx.driver.completeVerified({ handoffId: "h-s", actor: "worker-a", recordedAt: T4, reason: "complete" });
    expect(done.handoff.state).toBe("COMPLETE");
    expect(done.queueItem.status).toBe("CLOSED");
    expect(done.queueItem.key).toBe("handoff:h-s");
  });

  it("exact publish replay returns the existing receipt with no second write or event", async () => {
    const ctx = await setup();
    await begin(ctx);
    const first = await publish(ctx);
    const writesAfterFirst = ctx.git.writeCount();
    const eventsAfterFirst = (await ctx.handoffs.getEvents("h-1")).length;
    const replay = await publish(ctx);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.operationId).toBe(first.receipt.operationId);
    expect(ctx.git.writeCount()).toBe(writesAfterFirst);
    expect((await ctx.handoffs.getEvents("h-1")).length).toBe(eventsAfterFirst);
  });

  it("exact readback replay returns the existing receipt with no second event", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const first = await readback(ctx);
    const eventsAfterFirst = (await ctx.handoffs.getEvents("h-1")).length;
    const replay = await readback(ctx);
    expect(replay.replayed).toBe(true);
    expect(replay.receipt.receiptId).toBe(first.receipt.receiptId);
    expect((await ctx.handoffs.getEvents("h-1")).length).toBe(eventsAfterFirst);
  });

  it("exact queue-answer replay returns the existing receipt", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    const replay = await queueAnswer(ctx);
    expect(replay.replayed).toBe(true);
    expect(ctx.driver.getReceipts("h-1").queueReceipts).toHaveLength(1);
  });

  it("exact complete replay returns the closed state", async () => {
    const ctx = await setup();
    await toComplete(ctx);
    const replay = await complete(ctx);
    expect(replay.replayed).toBe(true);
    expect(replay.handoff.state).toBe("COMPLETE");
    expect(replay.queueItem.status).toBe("CLOSED");
  });
});

describe("crash after every boundary, recovered by restart + reconcile", () => {
  it("crash after outbox enqueue, before claim: reconcile allows republish, one write", async () => {
    const ctx = await setup();
    await begin(ctx);
    const envelope = { operationId: "op-outcome-1", handoffId: "h-1", content: { result: "done", n: 3 }, contentSha256: sha256Hex(stableStringify({ result: "done", n: 3 })) };
    const enqueued = enqueueOutbox(ctx.outbox.entries, {
      operationId: "op-outcome-1",
      targetRepo: REPO,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      payload: envelope,
      createdAt: T1,
    });
    ctx.outbox.entries = enqueued.entries;
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("REPUBLISH_ALLOWED");
    expect(rec.operationId).toBe("op-outcome-1");
    await publish(ctx, d2);
    expect(ctx.git.writeCount()).toBe(1);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
  });

  it("crash after claim, before write: reconcile allows republish, one write", async () => {
    const ctx = await setup();
    await begin(ctx);
    const envelope = { operationId: "op-outcome-1", handoffId: "h-1", content: { result: "done", n: 3 }, contentSha256: sha256Hex(stableStringify({ result: "done", n: 3 })) };
    const enqueued = enqueueOutbox(ctx.outbox.entries, {
      operationId: "op-outcome-1",
      targetRepo: REPO,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      payload: envelope,
      createdAt: T1,
    });
    ctx.outbox.entries = enqueued.entries;
    const claimed = claimOutbox({ entries: ctx.outbox.entries, operationId: "op-outcome-1", owner: "worker-a", now: T1 });
    ctx.outbox.entries = claimed.entries;
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("REPUBLISH_ALLOWED");
    await publish(ctx, d2);
    expect(ctx.git.writeCount()).toBe(1);
  });

  it("crash after Git write with lost reply: reconcile recovers the landed write, no duplicate", async () => {
    const ctx = await setup();
    await begin(ctx);
    ctx.git.failNextWrite("lost-reply");
    await expectCode(publish(ctx), P4_CODES.DELIVERY_UNKNOWN);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OPEN");
    expect(ctx.git.writeCount()).toBe(1);
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("OUTCOME_REAPPLIED");
    expect(rec.state).toBe("OUTCOME_WRITTEN");
    const receipts = d2.getReceipts("h-1");
    expect(receipts.outcome.deliveryMethod).toBe("RECONCILED_READBACK");
    // Continue to COMPLETE with no second outcome write.
    await readback(ctx, d2);
    await queueAnswer(ctx, d2);
    const done = await complete(ctx, d2);
    expect(done.handoff.state).toBe("COMPLETE");
    expect(ctx.git.writeCount()).toBe(2); // outcome + queue export only
  });

  it("crash after recordDelivery, before writeOutcome: reconcile re-applies the outcome", async () => {
    const ctx = await setup();
    await begin(ctx);
    const envelope = { operationId: "op-outcome-1", handoffId: "h-1", content: { result: "done", n: 3 }, contentSha256: sha256Hex(stableStringify({ result: "done", n: 3 })) };
    const enqueued = enqueueOutbox(ctx.outbox.entries, {
      operationId: "op-outcome-1",
      targetRepo: REPO,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      payload: envelope,
      createdAt: T1,
    });
    ctx.outbox.entries = enqueued.entries;
    const claimed = claimOutbox({ entries: ctx.outbox.entries, operationId: "op-outcome-1", owner: "worker-a", now: T1 });
    ctx.outbox.entries = claimed.entries;
    const gitResponse = await ctx.git.write({ repo: REPO, path: OUTCOME_PATH, expectedPriorBlob: EMPTY_BLOB, bytes: stableStringify(envelope) });
    const recorded = recordDelivery({ entries: ctx.outbox.entries, operationId: "op-outcome-1", owner: "worker-a", generation: claimed.lease.generation, gitResponse, now: T1 });
    ctx.outbox.entries = recorded.entries;
    // Crash here: outbox DELIVERED, handoff still OPEN.
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("OUTCOME_REAPPLIED");
    expect(rec.state).toBe("OUTCOME_WRITTEN");
  });

  it("crash after writeOutcome, before readback: reconcile reports READBACK_REQUIRED then advances", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const d2 = restart(ctx);
    const probe = await d2.reconcile({ handoffId: "h-1" });
    expect(probe.action).toBe("READBACK_REQUIRED");
    const advanced = await d2.reconcile({ handoffId: "h-1", verify: { verifier: "reader-1", checkedAt: T2, reason: "readback" } });
    expect(advanced.action).toBe("READBACK_ADVANCED");
    expect(advanced.state).toBe("READBACK_VERIFIED");
  });

  it("crash after readback receipt stored, before state advance: reconcile re-applies from the receipt", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const handoff = await ctx.handoffs.getHandoff("h-1");
    // White-box crash simulation: a receipt was durably stored but the
    // machine transition never committed.
    ctx.ledger.readbackReceipts["h-1"] = [
      {
        receiptId: "rb-simulated",
        artifact: { ...handoff.artifact },
        verifier: "reader-1",
        checkedAt: T2,
        reason: "readback",
        status: "VERIFIED",
      },
    ];
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("READBACK_REAPPLIED");
    expect(rec.state).toBe("READBACK_VERIFIED");
    expect(d2.getReceipts("h-1").readbacks).toHaveLength(1); // no duplicate receipt
  });

  it("crash after queue-export delivery, before QUEUE_UPDATED: re-run resumes with one write", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await readback(ctx);
    const queueBytes = "# queue export\n- h-1 answered\n";
    const payload = { handoffId: "h-1", taskId: "task-1", exportSha256: sha256Hex(queueBytes), exportBytes: queueBytes };
    const enqueued = enqueueOutbox(ctx.outbox.entries, {
      operationId: "op-queue-1",
      targetRepo: REPO,
      targetPath: QUEUE_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      payload,
      createdAt: T3,
      sourceTaskId: "task-1",
      sourceTaskRevision: "0:0",
    });
    ctx.outbox.entries = enqueued.entries;
    const claimed = claimOutbox({ entries: ctx.outbox.entries, operationId: "op-queue-1", owner: "worker-a", now: T3, tasks: taskList() });
    ctx.outbox.entries = claimed.entries;
    const gitResponse = await ctx.git.write({ repo: REPO, path: QUEUE_PATH, expectedPriorBlob: EMPTY_BLOB, bytes: queueBytes });
    const recorded = recordDelivery({ entries: ctx.outbox.entries, operationId: "op-queue-1", owner: "worker-a", generation: claimed.lease.generation, gitResponse, now: T3, tasks: taskList() });
    ctx.outbox.entries = recorded.entries;
    // Crash here: queue export DELIVERED, handoff still READBACK_VERIFIED.
    const writesBefore = ctx.git.writeCount();
    const d2 = restart(ctx);
    const resumed = await queueAnswer(ctx, d2);
    expect(resumed.replayed).toBe(false);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
    expect(ctx.git.writeCount()).toBe(writesBefore); // no second queue write
  });

  it("crash after queue-export write with lost reply: re-run reconciles instead of rewriting", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await readback(ctx);
    ctx.git.failNextWrite("lost-reply");
    await expectCode(queueAnswer(ctx), P4_CODES.DELIVERY_UNKNOWN);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("READBACK_VERIFIED");
    const writesAfterLost = ctx.git.writeCount();
    const d2 = restart(ctx);
    const resumed = await queueAnswer(ctx, d2);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
    expect(ctx.git.writeCount()).toBe(writesAfterLost); // landed write reused, not duplicated
  });

  it("crash after QUEUE_UPDATED, before complete: reconcile reports READY_TO_COMPLETE", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1", tasks: taskList() });
    expect(rec.action).toBe("READY_TO_COMPLETE");
    const done = await complete(ctx, d2);
    expect(done.handoff.state).toBe("COMPLETE");
  });

  it("crash after COMPLETE, before ledger close: reconcile re-applies the close once", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    // White-box crash simulation: COMPLETE committed, ledger close lost.
    await ctx.handoffs.completeHandoff("h-1", { actor: "worker-a", recordedAt: T4, reason: "complete" });
    expect(ctx.driver.getReceipts("h-1").queueItem.status).toBe("ANSWER_RECORDED_PENDING_CLOSE");
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1", tasks: taskList() });
    expect(rec.action).toBe("CLOSE_REAPPLIED");
    expect(d2.getReceipts("h-1").queueItem.status).toBe("CLOSED");
    expect(rec.tasks.find((t) => t.id === "task-1").status).toBe("DONE");
    const again = await d2.reconcile({ handoffId: "h-1", tasks: taskList() });
    expect(again.action).toBe("NONE");
  });

  it("real PGlite data-dir restart: machine state survives reopen and reconciles", async () => {
    const dir = tempDir("tb-p4-restart-");
    const backend1 = await freshBackend(dir);
    const git = createSandboxGit();
    const outbox = { entries: [] };
    const ledger = createHandoffLedger();
    const d1 = createVerifiedHandoffDriver({
      handoffs: backend1.handoffs,
      git,
      outboxEntries: outbox,
      ledger,
      workerId: "worker-a",
      generation: 1,
      provenanceFor: () => ({ status: "VERIFIED" }),
    });
    await d1.beginVerified({ handoffId: "h-1", taskId: "task-1", taskSnapshot: { snapshotRevision: 0, assignmentEpoch: 0 }, actor: "worker-a", recordedAt: T0, reason: "begin" });
    await d1.publishOutcome({
      handoffId: "h-1",
      operationId: "op-outcome-1",
      content: { result: "done", n: 3 },
      targetRepo: REPO,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      actor: "worker-a",
      recordedAt: T1,
      reason: "publish",
    });
    await backend1.db.close();
    // Crash + reopen: new DB handle, same dir, same ledger/outbox/git.
    const backend2 = await freshBackend(dir);
    const d2 = createVerifiedHandoffDriver({
      handoffs: backend2.handoffs,
      git,
      outboxEntries: outbox,
      ledger,
      workerId: "worker-a",
      generation: 1,
      provenanceFor: () => ({ status: "VERIFIED" }),
    });
    expect((await backend2.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
    const rec = await d2.reconcile({ handoffId: "h-1", verify: { verifier: "reader-1", checkedAt: T2, reason: "readback" } });
    expect(rec.action).toBe("READBACK_ADVANCED");
    await backend2.db.close();
  }, 30000); // two PGlite backends + a data-dir reopen
});

describe("wrong replay: repo, path, blob, head, time, actor, reason", () => {
  it("wrong repo: a readback receipt from another repo cannot verify this handoff", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const handoff = await ctx.handoffs.getHandoff("h-1");
    ctx.ledger.readbackReceipts["h-1"] = [
      {
        receiptId: "rb-foreign",
        artifact: { repo: "onyxgolden/other-repo", path: OUTCOME_PATH, commit: handoff.artifact.commit, blob: handoff.artifact.blob, head: handoff.artifact.head },
        verifier: "reader-1",
        checkedAt: T2,
        reason: "readback",
        status: "VERIFIED",
      },
    ];
    await expectCode(readback(ctx), P4_CODES.READBACK_MISMATCH);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
  });

  it("wrong path: a misdirected read serving another path's bytes fails the recomputation", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const realRead = ctx.git.read.bind(ctx.git);
    ctx.git.read = async (args) => {
      if (args.path === OUTCOME_PATH) return { bytes: "forged bytes from another path" };
      return realRead(args);
    };
    await expectCode(readback(ctx), P4_CODES.READBACK_MISMATCH);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
  });

  it("pinned readback survives head moves: a later commit cannot rewrite the pinned commit", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    ctx.git.tamper(REPO, OUTCOME_PATH, "forged bytes at the outcome path, newer commit");
    const rb = await readback(ctx);
    expect(rb.handoff.state).toBe("READBACK_VERIFIED");
    expect(rb.receipt.actualBlob).toBe(rb.receipt.expectedBlob);
  });

  it("wrong blob: a writer-side blob lie is caught by recomputation at readback", async () => {
    const ctx = await setup();
    await begin(ctx);
    // Wrap the writer to lie about the blob it stored.
    const realWrite = ctx.git.write.bind(ctx.git);
    ctx.git.write = async (args) => {
      const res = await realWrite(args);
      return { ...res, newBlob: fakeCommit("lie") };
    };
    const pub = await publish(ctx);
    expect(pub.receipt.artifact.blob).toBe(fakeCommit("lie"));
    await expectCode(readback(ctx), P4_CODES.READBACK_MISMATCH);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
  });

  it("wrong head: an outcome whose commit does not equal its head is refused", async () => {
    const ctx = await setup();
    await begin(ctx);
    const commit = fakeCommit("c1");
    const head = fakeCommit("c2");
    await ctx.handoffs.writeOutcome("h-1", {
      actor: "worker-a",
      recordedAt: T1,
      reason: "foreign-write",
      artifact: { repo: REPO, path: OUTCOME_PATH, commit, blob: fakeCommit("b"), head },
    });
    ctx.ledger.outcomeReceipts["h-1"] = {
      operationId: "op-foreign",
      handoffId: "h-1",
      artifact: { repo: REPO, path: OUTCOME_PATH, commit, blob: fakeCommit("b"), head },
    };
    await expectCode(readback(ctx), CODES.BINDING_MISMATCH);
  });

  it("wrong time: a readback checked before the outcome was recorded is refused", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await expectCode(readback(ctx, ctx.driver, { checkedAt: "2026-10-28T10:00:30Z" }), P4_CODES.TIME_ORDER);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
  });

  it("wrong actor: a second readback with a different verifier conflicts", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await readback(ctx);
    await expectCode(readback(ctx, ctx.driver, { verifier: "reader-2" }), CODES.CONFLICTING_REPLAY);
  });

  it("wrong reason: a second complete with a different reason conflicts", async () => {
    const ctx = await setup();
    await toComplete(ctx);
    await expectCode(complete(ctx, ctx.driver, { reason: "different-reason" }), CODES.CONFLICTING_REPLAY);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("COMPLETE");
  });

  it("same operationId with different content is CONFLICTING_REPLAY", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await expectCode(publish(ctx, ctx.driver, { content: { result: "different" } }), CODES.CONFLICTING_REPLAY);
  });

  it("caller verified:true is refused, not honored", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await expectCode(readback(ctx, ctx.driver, { verified: true }), P4_CODES.INVALID_READBACK_CLAIM);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
  });
});

describe("stale worker fencing", () => {
  it("an older generation cannot publish after a takeover", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const d2 = restart(ctx, { workerId: "worker-b", generation: 2 });
    // Takeover rebinds on a fencing-checked call.
    await d2.verifyReadback({ handoffId: "h-1", verifier: "reader-1", checkedAt: T2, reason: "readback" });
    await expectCode(publish(ctx, ctx.driver), P4_CODES.STALE_WORKER);
  });

  it("a different worker at the same generation cannot mutate", async () => {
    const ctx = await setup();
    await begin(ctx);
    const d2 = restart(ctx, { workerId: "worker-b", generation: 1 });
    await expectCode(publish(ctx, d2), P4_CODES.STALE_WORKER);
  });

  it("a stale worker cannot complete after a takeover", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    const d2 = restart(ctx, { workerId: "worker-b", generation: 2 });
    const done = await complete(ctx, d2);
    expect(done.handoff.state).toBe("COMPLETE");
    await expectCode(complete(ctx, ctx.driver), P4_CODES.STALE_WORKER);
  });

  it("same worker restarting at the same generation proceeds", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const d2 = restart(ctx);
    const rb = await readback(ctx, d2);
    expect(rb.handoff.state).toBe("READBACK_VERIFIED");
  });
});

describe("head moves before consumption", () => {
  it("head moves with the outcome intact: complete re-verifies at the new head", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    ctx.git.writeOtherPath(REPO, "results/team-brain/other.json", "unrelated content");
    const done = await complete(ctx);
    expect(done.handoff.state).toBe("COMPLETE");
    const readbacks = ctx.driver.getReceipts("h-1").readbacks;
    expect(readbacks[readbacks.length - 1].reason).toBe("HEAD_MOVED_REVERIFIED");
  });

  it("head moves and the outcome is gone: complete refuses STALE_HEAD with no close", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    ctx.git.tamper(REPO, OUTCOME_PATH, "overwritten by another writer");
    await expectCode(complete(ctx), P4_CODES.STALE_HEAD);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
    expect(ctx.driver.getReceipts("h-1").queueItem.status).toBe("ANSWER_RECORDED_PENDING_CLOSE");
  });

  it("same-head complete re-reads at the pinned commit (outcome in its own repo)", async () => {
    const otherRepo = "onyxgolden/other-repo";
    const ctx = await setup({ allowedRepos: [REPO, otherRepo] });
    await ctx.driver.beginVerified({
      handoffId: "h-1",
      taskId: "task-1",
      taskSnapshot: { snapshotRevision: 0, assignmentEpoch: 0 },
      actor: "worker-a",
      recordedAt: T0,
      reason: "begin",
    });
    await ctx.driver.publishOutcome({
      handoffId: "h-1",
      operationId: "op-outcome-1",
      content: { result: "done", n: 3 },
      targetRepo: otherRepo,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      actor: "worker-a",
      recordedAt: T1,
      reason: "publish",
    });
    await readback(ctx);
    await queueAnswer(ctx);
    const done = await complete(ctx);
    expect(done.handoff.state).toBe("COMPLETE");
    // No head-moved re-readback: the outcome repo head never moved.
    expect(ctx.driver.getReceipts("h-1").readbacks).toHaveLength(1);
  });
});

describe("missing provenance", () => {
  it("no provenance adapter wired: readback refuses PROVENANCE_MISSING", async () => {
    const ctx = await setup({ provenance: null });
    await begin(ctx);
    await publish(ctx);
    await expectCode(readback(ctx), P4_CODES.PROVENANCE_MISSING);
  });

  it("provenance UNKNOWN: readback refuses PROVENANCE_UNVERIFIED", async () => {
    const ctx = await setup({ provenance: "UNKNOWN" });
    await begin(ctx);
    await publish(ctx);
    await expectCode(readback(ctx), P4_CODES.PROVENANCE_UNVERIFIED);
  });

  it("provenance revoked between readback and complete: complete refuses, no close", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    ctx.provenanceState.status = "REVOKED";
    await expectCode(complete(ctx), P4_CODES.PROVENANCE_UNVERIFIED);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
    expect(ctx.driver.getReceipts("h-1").queueItem.status).toBe("ANSWER_RECORDED_PENDING_CLOSE");
  });
});

describe("queue receipt mismatch and evidence gaps", () => {
  it("queue export bytes seen differently at readback: QUEUE_RECEIPT_MISMATCH, state unchanged", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await readback(ctx);
    const realRead = ctx.git.read.bind(ctx.git);
    ctx.git.read = async (args) => {
      if (args.path === QUEUE_PATH) return { bytes: "different export bytes" };
      return realRead(args);
    };
    await expectCode(queueAnswer(ctx), P4_CODES.QUEUE_RECEIPT_MISMATCH);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("READBACK_VERIFIED");
  });

  it("queue receipt binding another handoff's outcome: complete refuses QUEUE_RECEIPT_MISMATCH", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    const receipts = ctx.driver.getReceipts("h-1");
    receipts.queueReceipts[0].outcome = { repo: REPO, path: OUTCOME_PATH, commit: fakeCommit("x"), blob: fakeCommit("y"), head: fakeCommit("x") };
    await expectCode(complete(ctx), P4_CODES.QUEUE_RECEIPT_MISMATCH);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
  });

  it("bound task moved between answer and complete: TASK_MOVED, no close", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    const moved = taskList().map((t) => ({ ...t, snapshotRevision: 1 }));
    await expectCode(complete(ctx, ctx.driver, { tasks: moved }), P4_CODES.TASK_MOVED);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
  });

  it("bound task terminal before complete: TASK_TERMINAL, no close", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    const terminal = taskList().map((t) => ({ ...t, status: "DONE" }));
    await expectCode(complete(ctx, ctx.driver, { tasks: terminal }), P4_CODES.TASK_TERMINAL);
  });

  it("missing readback receipt at complete: INCOMPLETE_EVIDENCE via READBACK_RECEIPT_MISSING", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    delete ctx.ledger.readbackReceipts["h-1"];
    await expectCode(complete(ctx), P4_CODES.READBACK_RECEIPT_MISSING);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
  });

  it("missing queue receipt at complete: QUEUE_RECEIPT_MISSING", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    ctx.ledger.queueReceipts = [];
    await expectCode(complete(ctx), P4_CODES.QUEUE_RECEIPT_MISSING);
  });

  it("missing outcome receipt at complete: OUTCOME_RECEIPT_MISSING", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    delete ctx.ledger.outcomeReceipts["h-1"];
    await expectCode(complete(ctx), P4_CODES.OUTCOME_RECEIPT_MISSING);
  });

  it("readback receipt can be re-established by a fresh read, then complete proceeds", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    delete ctx.ledger.readbackReceipts["h-1"];
    const re = await readback(ctx, ctx.driver, { checkedAt: T5, reason: "reestablish" });
    expect(re.receipt.reestablished).toBe(true);
    const done = await complete(ctx, ctx.driver, { recordedAt: "2026-10-28T10:06:00Z" });
    expect(done.handoff.state).toBe("COMPLETE");
  });

  it("queue export CAS conflict: entry stays CLAIMED, state unchanged, retry with fresh intent succeeds", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    await readback(ctx);
    await expectCode(queueAnswer(ctx, ctx.driver, { expectedPriorBlob: fakeCommit("stale") }), P3_CODES.CAS_CONFLICT);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("READBACK_VERIFIED");
    const entry = ctx.outbox.entries.find((e) => e.operationId === "op-queue-1");
    expect(entry.state).toBe("CLAIMED");
    // Fresh intent with the current prior blob succeeds.
    const ok = await queueAnswer(ctx, ctx.driver, { queueOperationId: "op-queue-2", expectedPriorBlob: ctx.git.currentBlob(REPO, QUEUE_PATH) });
    expect(ok.handoff.state).toBe("QUEUE_UPDATED");
  });

  it("outbox payload drift between enqueue and claim is refused as PAYLOAD_DRIFT", async () => {
    const ctx = await setup();
    await begin(ctx);
    ctx.git.failNextWrite("lost-reply");
    await expectCode(publish(ctx), P4_CODES.DELIVERY_UNKNOWN);
    // Attacker or bug mutates the admitted intent after enqueue.
    ctx.outbox.entries[0].payload.content = { result: "forged" };
    await expectCode(publish(ctx), P3_CODES.PAYLOAD_DRIFT);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OPEN");
  });
});

describe("identity, allowlist, transport, and ordering guards", () => {
  it("non-40-hex expected prior blob is refused at the P4 boundary", async () => {
    const ctx = await setup();
    await begin(ctx);
    await expectCode(publish(ctx, ctx.driver, { expectedPriorBlob: "abc" }), P4_CODES.INVALID_GIT_IDENTITY);
  });

  it("short blob from the Git response is refused", async () => {
    const ctx = await setup();
    await begin(ctx);
    const realWrite = ctx.git.write.bind(ctx.git);
    ctx.git.write = async (args) => {
      const res = await realWrite(args);
      return { ...res, newBlob: "short" };
    };
    await expectCode(publish(ctx), P4_CODES.INVALID_GIT_IDENTITY);
  });

  it("disallowed repo and disallowed path are refused before any write", async () => {
    const ctx = await setup();
    await begin(ctx);
    await expectCode(publish(ctx, ctx.driver, { targetRepo: "onyxgolden/other" }), P3_CODES.DISALLOWED_REPO);
    await expectCode(publish(ctx, ctx.driver, { targetPath: "src/app.js" }), P3_CODES.DISALLOWED_PATH);
    expect(ctx.git.writeCount()).toBe(0);
  });

  it("Git unavailable during readback: state unchanged; reconcile reports BLOCKED", async () => {
    const ctx = await setup();
    await begin(ctx);
    await publish(ctx);
    const realRead = ctx.git.read.bind(ctx.git);
    ctx.git.read = async () => {
      throw tbError(P4_CODES.GIT_UNAVAILABLE, "transport down");
    };
    await expectCode(readback(ctx), P4_CODES.GIT_UNAVAILABLE);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OUTCOME_WRITTEN");
    const d2 = restart(ctx);
    const rec = await d2.reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("READBACK_REQUIRED");
    ctx.git.read = realRead;
  });

  it("complete with a recordedAt before the queue receipt is TIME_ORDER", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    await expectCode(complete(ctx, ctx.driver, { recordedAt: "2026-10-28T10:02:30Z" }), P4_CODES.TIME_ORDER);
  });

  it("skipped transitions are refused: readback from OPEN, complete from READBACK_VERIFIED", async () => {
    const ctx = await setup();
    await begin(ctx);
    await expectCode(readback(ctx), CODES.SKIPPED_TRANSITION);
    await publish(ctx);
    await readback(ctx);
    await expectCode(complete(ctx), CODES.SKIPPED_TRANSITION);
  });

  it("zero unverified closes: with Git reads down, no close path succeeds", async () => {
    const ctx = await setup();
    await toQueue(ctx);
    ctx.git.read = async () => {
      throw tbError(P4_CODES.GIT_UNAVAILABLE, "transport down");
    };
    await expectCode(complete(ctx), P4_CODES.GIT_UNAVAILABLE);
    await expectCode(queueAnswer(ctx, ctx.driver, { queueOperationId: "op-queue-9", expectedPriorBlob: ctx.git.currentBlob(REPO, QUEUE_PATH) }), P4_CODES.GIT_UNAVAILABLE);
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
    expect(ctx.driver.getReceipts("h-1").queueItem.status).toBe("ANSWER_RECORDED_PENDING_CLOSE");
    const allHandoffs = await ctx.handoffs.listHandoffs();
    expect(allHandoffs.every((h) => h.state !== "COMPLETE")).toBe(true);
  });

  it("reconcile on an unknown handoff fails UNKNOWN_HANDOFF", async () => {
    const ctx = await setup();
    await expectCode(restart(ctx).reconcile({ handoffId: "h-nope" }), CODES.UNKNOWN_HANDOFF);
  });

  it("reconcile on a fresh handoff reports READY_TO_PUBLISH", async () => {
    const ctx = await setup();
    await begin(ctx);
    const rec = await restart(ctx).reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("READY_TO_PUBLISH");
  });

  it("reconcile halts when the outcome path holds unexpected foreign content", async () => {
    const ctx = await setup();
    await begin(ctx);
    const envelope = { operationId: "op-outcome-1", handoffId: "h-1", content: { result: "done", n: 3 }, contentSha256: sha256Hex(stableStringify({ result: "done", n: 3 })) };
    const enqueued = enqueueOutbox(ctx.outbox.entries, {
      operationId: "op-outcome-1",
      targetRepo: REPO,
      targetPath: OUTCOME_PATH,
      expectedPriorBlob: EMPTY_BLOB,
      payload: envelope,
      createdAt: T1,
    });
    ctx.outbox.entries = enqueued.entries;
    // A foreign writer occupies the path with unrelated content.
    ctx.git.writeOtherPath(REPO, OUTCOME_PATH, "foreign content, not our outcome");
    const rec = await restart(ctx).reconcile({ handoffId: "h-1" });
    expect(rec.action).toBe("HALT_CONFLICTING_REPLAY");
    expect((await ctx.handoffs.getHandoff("h-1")).state).toBe("OPEN");
  });
});

// Post-merge audit fix-forward (results/chatgpt/pr690-team-brain-p4-review-2026-10-28.md):
// TBP4-001 (worker fencing expires across awaited I/O), TBP4-002
// (COMPLETE crash recovery closes a reassigned task), TBP4-003
// (successful publish/queue-answer replay ignores changed operation
// parameters). Each finding below was independently reproduced first
// (as a failing-before probe) by running
// results/chatgpt/probes/pr690-reviewer-characterization-2026-10-28.mjs
// against the pre-fix code; the tests here assert the corrected
// behavior, not the drop repo's own characterization artifact (which
// deliberately still asserts the pre-fix outcome and is not part of
// this permanent suite).
describe("post-merge audit fix-forward (TBP4-001/002/003)", () => {
  it("TBP4-001: a worker whose generation is superseded during an awaited read cannot complete, even though it passed fencing at entry", async () => {
    const c = await setup();
    await toQueue(c);
    const orig = c.git.read.bind(c.git);
    let resolveGate, entered;
    const atGate = new Promise((r) => (entered = r));
    const gate = new Promise((r) => (resolveGate = r));
    let once = true;
    c.git.read = async (a) => {
      if (once) {
        once = false;
        entered();
        await gate;
      }
      return orig(a);
    };
    const pending = complete(c);
    await atGate;
    const d2 = restart(c, { workerId: "worker-b", generation: 2 });
    await begin(c, d2);
    resolveGate();
    await expectCode(pending, P4_CODES.STALE_WORKER);
    // The binding now correctly reflects the real current owner - the
    // stale completion attempt did not get to overwrite it.
    expect(c.ledger.bindings["h-1"].workerId).toBe("worker-b");
    expect((await c.handoffs.getHandoff("h-1")).state).toBe("QUEUE_UPDATED");
    await c.db.close();
  }, 30000);

  it("TBP4-001 positive control: an uninterrupted worker still completes normally", async () => {
    const c = await setup();
    const result = await toComplete(c);
    expect(result.handoff.state).toBe("COMPLETE");
    expect(result.queueItem.status).toBe("CLOSED");
    expect(result.queueItem.closeActor).toBe("worker-a");
    await c.db.close();
  });

  it("TBP4-002: reconcile's CLOSE_REAPPLIED path refuses to close a task that was reassigned after the historical COMPLETE event, and does not touch it", async () => {
    const c = await setup();
    await toComplete(c);
    const item = c.ledger.queueItems["task:task-1"];
    expect(item).toBeTruthy();
    // Simulate the documented crash window: COMPLETE already recorded,
    // ledger close did not happen yet.
    item.status = "ANSWER_RECORDED_PENDING_CLOSE";
    const reassignedTasks = taskList().map((t) => ({ ...t, assignmentEpoch: 2, snapshotRevision: 2, ownerAgent: "new-owner" }));
    const result = await c.driver.reconcile({ handoffId: "h-1", tasks: reassignedTasks });
    expect(result.action).toBe("TASK_REASSIGNED");
    // The reassignment must survive untouched - no DONE, no cleared owner.
    expect(result.tasks).toBeUndefined();
    expect(c.ledger.queueItems["task:task-1"].status).toBe("ANSWER_RECORDED_PENDING_CLOSE");
    await c.db.close();
  });

  it("TBP4-002 positive control: reconcile's CLOSE_REAPPLIED path still closes a genuinely unmoved task", async () => {
    const c = await setup();
    await toComplete(c);
    const item = c.ledger.queueItems["task:task-1"];
    item.status = "ANSWER_RECORDED_PENDING_CLOSE";
    const unchangedTasks = taskList();
    const result = await c.driver.reconcile({ handoffId: "h-1", tasks: unchangedTasks });
    expect(result.action).toBe("CLOSE_REAPPLIED");
    expect(result.tasks[0].status).toBe("DONE");
    expect(result.tasks[0].ownerAgent).toBe(null);
    expect(c.ledger.queueItems["task:task-1"].status).toBe("CLOSED");
    await c.db.close();
  });

  it("TBP4-003: publishOutcome rejects a replay whose audit identity (actor/time/reason/expectedPriorBlob) differs from the original, instead of accepting it as idempotent", async () => {
    const c = await setup();
    await begin(c);
    await publish(c);
    await expectCode(
      publish(c, c.driver, { expectedPriorBlob: "f".repeat(40), actor: "different-worker", recordedAt: T5, reason: "different" }),
      CODES.CONFLICTING_REPLAY,
    );
    await c.db.close();
  });

  it("TBP4-003 positive control: an exact publishOutcome replay (identical everything) still returns replayed:true", async () => {
    const c = await setup();
    await begin(c);
    const first = await publish(c);
    const second = await publish(c);
    expect(second.replayed).toBe(true);
    expect(second.receipt).toEqual(first.receipt);
    await c.db.close();
  });

  it("TBP4-003 extended: recordQueueAnswer rejects a replay whose audit identity differs from the original", async () => {
    const c = await setup();
    await begin(c);
    await publish(c);
    await readback(c);
    await queueAnswer(c);
    await expectCode(
      queueAnswer(c, c.driver, { actor: "different-worker", recordedAt: T5, reason: "different" }),
      CODES.CONFLICTING_REPLAY,
    );
    await c.db.close();
  });

  it("TBP4-003 extended positive control: an exact recordQueueAnswer replay (identical everything) still returns replayed:true", async () => {
    const c = await setup();
    await begin(c);
    await publish(c);
    await readback(c);
    const first = await queueAnswer(c);
    const second = await queueAnswer(c);
    expect(second.replayed).toBe(true);
    expect(second.queueReceipt).toEqual(first.queueReceipt);
    await c.db.close();
  });
});
