// Team Brain slice 3 — fix round 2 acceptance tests (TBP3-006A).
//
// ChatGPT's fix-round-1 re-review (results/chatgpt/
// team-brain-p3-fix-round1-rereview-2026-10-27.md) left exactly one
// finding open: TBP3-006A. Task-derived intents must carry a complete
// binding (source task identity PLUS a revision/applicability token),
// the binding must be part of replay identity, and claim/delivery must
// require current applicability with no nullable bypass. `cancelOutbox-
// ForTask` remains a convenience; correctness must not depend on it.
// Pure functions, synthetic fixtures, injected `now` throughout.

import { describe, expect, it } from "vitest";
import {
  assignNext,
  createTask,
} from "../orchestrator/controller.mjs";
import {
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
// TeamBrainError carries its machine-readable code on `.code`; the
// message alone does not contain it, so code-sensitive tests assert it.
function thrownCode(fn) {
  try {
    fn();
  } catch (e) {
    return e.code;
  }
  return null;
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

describe("TBP3-006A: task-derived intents require a complete binding at admission", () => {
  it("explicit sourceTaskId without a revision token is refused", () => {
    expect(() => enqueueOutbox([], outboxEntry({ sourceTaskId: "t" }))).toThrowError(
      /requires sourceTaskRevision/,
    );
  });

  it("inferred payload.taskId without a revision token is refused", () => {
    expect(() =>
      enqueueOutbox([], outboxEntry({ payload: { taskId: "t", kind: "REPING_DUE" } })),
    ).toThrowError(/requires sourceTaskRevision/);
  });

  it("a bound entry persists both identity and revision token", () => {
    const tasks = assigned();
    const first = enqueueOutbox([], boundEntry(tasks));
    expect(first.entry.sourceTaskId).toBe("t");
    expect(first.entry.sourceTaskRevision).toBe(taskApplicabilityToken(tasks[0]));
    expect(first.entry.sourceTaskRevision).toBe("1:0");
  });

  it("replay with a changed sourceTaskId is CONFLICTING_REPLAY", () => {
    const tasks = assigned();
    const first = enqueueOutbox([], boundEntry(tasks));
    expect(() =>
      enqueueOutbox(first.entries, boundEntry(tasks, { sourceTaskId: "other" })),
    ).toThrowError(/different sourceTaskId/);
  });

  it("replay with a changed revision token is CONFLICTING_REPLAY", () => {
    const tasks = assigned();
    const first = enqueueOutbox([], boundEntry(tasks));
    expect(() =>
      enqueueOutbox(first.entries, boundEntry(tasks, { sourceTaskRevision: "2:0" })),
    ).toThrowError(/different sourceTaskRevision/);
  });

  it("exact replay including the binding still dedups", () => {
    const tasks = assigned();
    const first = enqueueOutbox([], boundEntry(tasks));
    const second = enqueueOutbox(first.entries, boundEntry(tasks));
    expect(second.deduped).toBe(true);
    expect(second.entries).toHaveLength(1);
  });
});

describe("TBP3-006A: claim and delivery require current applicability, no nullable bypass", () => {
  it("claim without tasks for a task-derived intent is refused, not skipped", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    expect(
      thrownCode(() =>
        claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW }),
      ),
    ).toBe("APPLICABILITY_REQUIRED");
  });

  it("delivery without tasks for a task-derived intent is refused, not skipped", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const claimed = claimOutbox({
      entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks,
    });
    expect(
      thrownCode(() =>
        recordDelivery({
          entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
          gitResponse: gitResponse(),
        }),
      ),
    ).toBe("APPLICABILITY_REQUIRED");
  });

  it("claim with tasks that omit the source task is refused, not skipped", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    expect(
      thrownCode(() =>
        claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: [] }),
      ),
    ).toBe("UNKNOWN_TASK");
  });

  it("claim against a DONE source task is STALE_INTENT", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const done = [{ ...tasks[0], status: "DONE" }];
    expect(() =>
      claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: done }),
    ).toThrowError(/stale/);
  });

  it("claim after reassignment (epoch change) is STALE_INTENT on revision mismatch", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const reassigned = [{ ...tasks[0], assignmentEpoch: tasks[0].assignmentEpoch + 1 }];
    expect(() =>
      claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: reassigned }),
    ).toThrowError(/revision mismatch/);
  });

  it("claim after a snapshot revision change is STALE_INTENT on revision mismatch", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const resnapped = [{ ...tasks[0], snapshotRevision: tasks[0].snapshotRevision + 1 }];
    expect(() =>
      claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: resnapped }),
    ).toThrowError(/revision mismatch/);
  });

  it("claim with a live, revision-current task still succeeds", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const claim = claimOutbox({
      entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks,
    });
    expect(claim.entry.state).toBe("CLAIMED");
  });

  it("delivery with a live, revision-current task still succeeds", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const claimed = claimOutbox({
      entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks,
    });
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      tasks, gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("non-task-derived intents still claim and deliver without tasks", () => {
    const pending = enqueueOutbox([], outboxEntry());
    const claimed = claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW });
    expect(claimed.entry.state).toBe("CLAIMED");
    const delivered = recordDelivery({
      entries: claimed.entries, operationId: "op", owner: "sender", generation: 1, now: NOW,
      gitResponse: gitResponse(),
    });
    expect(delivered.entry.state).toBe("DELIVERED");
  });

  it("cancelOutboxForTask remains a working convenience for unsent intents", () => {
    const tasks = assigned();
    const pending = enqueueOutbox([], boundEntry(tasks));
    const { entries, cancelled } = cancelOutboxForTask(pending.entries, "t", NOW);
    expect(cancelled).toEqual(["op"]);
    expect(entries[0].state).toBe("CANCELLED");
  });
});
