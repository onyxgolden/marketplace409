// Team Brain slice 3 — fix round 3 acceptance tests (TBP3-006B).
//
// ChatGPT's fix-round-2 re-review (results/chatgpt/
// team-brain-p3-fix-round2-rereview-2026-10-27.md) left exactly one
// finding open: TBP3-006B. enqueueOutbox gave a nonempty explicit
// sourceTaskId unconditional precedence over payload.taskId and never
// checked agreement, so an intent whose payload named an already
// answered task could bind its applicability to an unrelated live task
// and advance to DELIVERED. The repair: when payload.taskId is a task
// identity under this contract and an explicit sourceTaskId is present,
// exact equality is required before admission or replay; contradictory
// or malformed bindings are refused with the named outcome
// CONFLICTING_TASK_BINDING, never silently resolved in favour of one
// side; and claim/delivery revalidate the stored binding so legacy
// persisted entries carrying the same contradiction fail closed.
// Positive cases — explicit-only, inferred-only, matching-both,
// non-task, exact-replay idempotency, DONE/epoch-mismatch staleness —
// are preserved. Pure functions, synthetic fixtures, injected `now`
// throughout; no sends, no I/O.

import { describe, expect, it } from "vitest";
import {
  assignNext,
  createTask,
  submitResult,
} from "../orchestrator/controller.mjs";
import {
  canonicalPayloadHash,
  cancelOutboxForTask,
  claimOutbox,
  enqueueOutbox,
  recordDelivery,
  taskApplicabilityToken,
} from "../orchestrator/outbox.mjs";

const NOW = "2026-10-27T12:00:00Z";
const T0 = "2026-10-27T10:00:00Z";
const AGENTS = [{ id: "a", scopes: ["team-brain"] }];

function task(id, extra = {}) {
  return createTask({ id, goal: "synthetic goal", filedAt: T0, requiredOutputs: ["out"], ...extra });
}
function assigned(id = "t") {
  return assignNext({ tasks: [task(id)], agents: AGENTS, now: NOW, snapshotRevision: 0 }).tasks;
}
function outboxEntry(extra = {}) {
  return {
    operationId: "op",
    targetRepo: "onyxgolden/forge-ai-drop",
    targetPath: "results/team-brain/receipts/op.json",
    expectedPriorBlob: "a".repeat(40),
    payload: { text: "synthetic" },
    createdAt: T0,
    ...extra,
  };
}
// A task-derived entry bound to the CURRENT record of `tasks[0]`.
function boundEntry(tasks, extra = {}) {
  return outboxEntry({
    sourceTaskId: tasks[0].id,
    sourceTaskRevision: taskApplicabilityToken(tasks[0]),
    ...extra,
  });
}
// The verdict's counterexample fixture: a live task plus an
// already-answered (DONE) task, built with real controller calls.
function liveAndAnswered() {
  const live = assigned("live")[0];
  const answered = submitResult({
    tasks: assigned("answered"),
    taskId: "answered",
    agentId: "a",
    generation: 1,
    now: NOW,
    result: { status: "done", outputs: { out: "ok" } },
  }).tasks[0];
  expect(answered.status).toBe("DONE");
  return { live, answered, tasks: [live, answered] };
}
function gitResponse(path = "results/team-brain/receipts/op.json") {
  return {
    repo: "onyxgolden/forge-ai-drop",
    priorBlob: "a".repeat(40),
    newBlob: "b".repeat(40),
    head: "c".repeat(40),
    path,
  };
}
// A stored entry as a pre-fix row would persist it: built by hand,
// bypassing enqueueOutbox, so the admission rule cannot mask a legacy
// contradiction. payloadHash is pinned correctly, so no drift check
// can explain a refusal — only the binding check can.
function legacyEntry({ sourceTaskId, payloadTaskId, state = "PENDING", lease = null }) {
  const payload = { taskId: payloadTaskId, kind: "REPING_DUE" };
  return {
    operationId: "op",
    targetRepo: "onyxgolden/forge-ai-drop",
    targetPath: "results/team-brain/receipts/op.json",
    expectedPriorBlob: "a".repeat(40),
    payload,
    payloadHash: canonicalPayloadHash(payload),
    sourceTaskId,
    sourceTaskRevision: "1:0",
    state,
    lease,
    attempts: state === "CLAIMED" ? 1 : 0,
    deliveryReceipt: null,
    lastError: null,
    cancelledAt: null,
    cancelReason: null,
    createdAt: T0,
  };
}
function thrownCode(fn) {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
}

describe("TBP3-006B: explicit and payload task identities must agree at admission", () => {
  it("the verdict counterexample is refused at admission, never DELIVERED", () => {
    const { live, tasks } = liveAndAnswered();
    expect(
      thrownCode(() =>
        enqueueOutbox(
          [],
          outboxEntry({
            payload: { taskId: "answered", kind: "REPING_DUE" },
            sourceTaskId: "live",
            sourceTaskRevision: taskApplicabilityToken(live),
          }),
        ),
      ),
    ).toBe("CONFLICTING_TASK_BINDING");
    void tasks;
  });

  it("reversed identity (payload live, explicit answered) is refused the same way", () => {
    const { live, answered } = liveAndAnswered();
    expect(
      thrownCode(() =>
        enqueueOutbox(
          [],
          outboxEntry({
            payload: { taskId: "live", kind: "REPING_DUE" },
            sourceTaskId: "answered",
            sourceTaskRevision: taskApplicabilityToken(answered),
          }),
        ),
      ),
    ).toBe("CONFLICTING_TASK_BINDING");
    void live;
  });

  it("a contradictory replay is refused, not deduped or rebound", () => {
    const tasks = assigned();
    const first = enqueueOutbox([], boundEntry(tasks));
    expect(first.entries).toHaveLength(1);
    expect(
      thrownCode(() =>
        enqueueOutbox(
          first.entries,
          boundEntry(tasks, {
            payload: { taskId: "other", kind: "REPING_DUE" },
            sourceTaskId: tasks[0].id,
          }),
        ),
      ),
    ).toBe("CONFLICTING_TASK_BINDING");
    expect(first.entries).toHaveLength(1);
  });

  it("a malformed explicit binding is refused, never silently inferred past", () => {
    expect(
      thrownCode(() => enqueueOutbox([], outboxEntry({ sourceTaskId: 42, payload: { taskId: "t" } }))),
    ).toBe("CONFLICTING_TASK_BINDING");
    expect(
      thrownCode(() => enqueueOutbox([], outboxEntry({ sourceTaskId: "", payload: { taskId: "t" } }))),
    ).toBe("CONFLICTING_TASK_BINDING");
  });
});

describe("TBP3-006B: claim and delivery revalidate the stored binding", () => {
  it("legacy stored mismatch fails closed at claim, not STALE_INTENT and not CLAIMED", () => {
    const { tasks } = liveAndAnswered();
    const entries = [legacyEntry({ sourceTaskId: "live", payloadTaskId: "answered" })];
    expect(
      thrownCode(() => claimOutbox({ entries, operationId: "op", owner: "sender", now: NOW, tasks })),
    ).toBe("CONFLICTING_TASK_BINDING");
  });

  it("legacy stored mismatch fails closed at delivery for an in-flight entry", () => {
    const { tasks } = liveAndAnswered();
    const lease = {
      leaseId: "op:1",
      owner: "sender",
      generation: 1,
      issuedAt: NOW,
      expiresAt: "2026-10-27T12:15:00Z",
    };
    const entries = [legacyEntry({ sourceTaskId: "live", payloadTaskId: "answered", state: "CLAIMED", lease })];
    expect(
      thrownCode(() =>
        recordDelivery({
          entries,
          operationId: "op",
          owner: "sender",
          generation: 1,
          now: NOW,
          tasks,
          gitResponse: gitResponse(),
        }),
      ),
    ).toBe("CONFLICTING_TASK_BINDING");
  });

  it("a stored payload naming a task with no binding at all fails closed at claim", () => {
    const { tasks } = liveAndAnswered();
    const entries = [legacyEntry({ sourceTaskId: null, payloadTaskId: "answered" })];
    expect(
      thrownCode(() => claimOutbox({ entries, operationId: "op", owner: "sender", now: NOW, tasks })),
    ).toBe("CONFLICTING_TASK_BINDING");
  });

  it("serialization round-trip preserves the legacy refusal", () => {
    const { tasks } = liveAndAnswered();
    const entries = JSON.parse(
      JSON.stringify([legacyEntry({ sourceTaskId: "live", payloadTaskId: "answered" })]),
    );
    expect(
      thrownCode(() => claimOutbox({ entries, operationId: "op", owner: "sender", now: NOW, tasks })),
    ).toBe("CONFLICTING_TASK_BINDING");
  });
});

describe("TBP3-006B: positive cases are preserved", () => {
  it("explicit-only intents still admit, claim, and deliver", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    expect(pending.entry.sourceTaskId).toBe("t");
    const claimed = claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks });
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      tasks, gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("inferred-only intents still admit with the payload identity, claim, and deliver", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], outboxEntry({
      payload: { taskId: "t", kind: "REPING_DUE" },
      sourceTaskRevision: taskApplicabilityToken(tasks[0]),
    }));
    expect(pending.entry.sourceTaskId).toBe("t");
    const claimed = claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks });
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      tasks, gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("matching-both intents still admit, dedup on exact replay, and deliver", () => {
    const tasks = assigned();
    const first = enqueueOutbox([], boundEntry(tasks, { payload: { taskId: "t", kind: "REPING_DUE" } }));
    expect(first.entry.sourceTaskId).toBe("t");
    const second = enqueueOutbox(first.entries, boundEntry(tasks, { payload: { taskId: "t", kind: "REPING_DUE" } }));
    expect(second.deduped).toBe(true);
    expect(second.entries).toHaveLength(1);
    const claimed = claimOutbox({ entries: second.entries, operationId: "op", owner: "sender", now: NOW, tasks });
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      tasks, gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("non-task intents still claim and deliver without tasks", () => {
    const pending = enqueueOutbox([], outboxEntry());
    const claimed = claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW });
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("serialization round-trip preserves a valid binding end to end", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks, { payload: { taskId: "t", kind: "REPING_DUE" } }));
    const entries = JSON.parse(JSON.stringify(pending.entries));
    const claimed = claimOutbox({ entries, operationId: "op", owner: "sender", now: NOW, tasks });
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      tasks, gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("matching-both intent against a DONE task is still STALE_INTENT, not a binding error", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks, { payload: { taskId: "t", kind: "REPING_DUE" } }));
    const done = [{ ...tasks[0], status: "DONE" }];
    expect(
      thrownCode(() => claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: done })),
    ).toBe("STALE_INTENT");
  });

  it("matching-both intent after reassignment is still STALE_INTENT on revision mismatch", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks, { payload: { taskId: "t", kind: "REPING_DUE" } }));
    const reassigned = [{ ...tasks[0], assignmentEpoch: tasks[0].assignmentEpoch + 1 }];
    expect(
      thrownCode(() => claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: reassigned })),
    ).toBe("STALE_INTENT");
  });

  it("cancelOutboxForTask still cancels a matching-both unsent intent", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks, { payload: { taskId: "t", kind: "REPING_DUE" } }));
    const { entries, cancelled } = cancelOutboxForTask(pending.entries, "t", NOW);
    expect(cancelled).toEqual(["op"]);
    expect(entries[0].state).toBe("CANCELLED");
  });
});
