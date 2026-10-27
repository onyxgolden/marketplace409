// Team Brain slice 3 — fix round 1 acceptance tests (TBP3-001..010).
//
// Each case pins the repaired behavior from ChatGPT's P3 review
// (results/chatgpt/team-brain-p3-review-2026-10-27.md). The reviewer's
// 18 characterization probes (which assert the OLD bad behavior) were
// reproduced passing against the unfixed head first; these tests assert
// the CORRECT behavior after the fix. Pure functions, synthetic
// fixtures, injected `now` throughout; no sends, no I/O.

import { describe, expect, it } from "vitest";
import {
  LEASE_MS,
  agentState,
  assignNext,
  createTask,
  effectiveFiledMsById,
  escalationFor,
  oldestAcrossPages,
  reclaimExpiredLeases,
  releaseLease,
  renewLease,
  resumeWaiting,
  startExecution,
  submitResult,
} from "../orchestrator/controller.mjs";
import {
  cancelOutboxForTask,
  claimOutbox,
  enqueueOutbox,
  recordDelivery,
  taskApplicabilityToken,
} from "../orchestrator/outbox.mjs";
import { exportReceipt, exportStatus } from "../orchestrator/exporters.mjs";

const NOW = "2026-10-27T12:00:00Z";
const T0 = "2026-10-27T10:00:00Z";
const LATER = "2026-10-27T12:16:00Z";
const AGENTS = [{ id: "a", scopes: ["team-brain"] }, { id: "b", scopes: ["team-brain"] }];

function task(id, extra = {}) {
  return createTask({ id, goal: "synthetic goal", filedAt: T0, requiredOutputs: ["out"], ...extra });
}
function assign(tasks, now = NOW, agents = AGENTS) {
  return assignNext({ tasks, agents, now, snapshotRevision: 0 });
}
function doneResult(outputs = { out: "ok" }) {
  return { status: "done", outputs };
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
function claimedEntry(extra = {}) {
  const e = enqueueOutbox([], outboxEntry(extra));
  const c = claimOutbox({ entries: e.entries, operationId: "op", owner: "a", now: NOW });
  return c;
}

describe("TBP3-001: fencing epoch survives every recovery path", () => {
  for (const mode of ["failed", "released", "expired"]) {
    it(`stale generation-1 result is refused after ${mode} + reassignment`, () => {
      const first = assign([task("t")]);
      expect(first.assignment.lease.generation).toBe(1);
      let tasks;
      let now = NOW;
      if (mode === "failed") {
        tasks = submitResult({
          tasks: first.tasks, taskId: "t", agentId: "a", generation: 1, now,
          result: { status: "failed", error: "synthetic" },
        }).tasks;
      } else if (mode === "released") {
        tasks = releaseLease({ tasks: first.tasks, taskId: "t", agentId: "a", generation: 1, now });
      } else {
        now = LATER;
        tasks = reclaimExpiredLeases({ tasks: first.tasks, now });
        expect(tasks[0].status).toBe("QUEUED");
      }
      const second = assign(tasks, now);
      expect(second.assignment.lease.generation).toBe(2);
      expect(() =>
        submitResult({
          tasks: second.tasks, taskId: "t", agentId: "a", generation: 1, now,
          result: doneResult({ out: "old attempt" }),
        }),
      ).toThrowError(/does not match owner\/generation/);
      const fresh = submitResult({
        tasks: second.tasks, taskId: "t", agentId: "a", generation: 2, now,
        result: doneResult(),
      });
      expect(fresh.tasks[0].status).toBe("DONE");
    });
  }

  it("renewal advances the epoch, so a later assignment cannot collide with it", () => {
    const first = assign([task("t")]);
    const renewed = renewLease({ tasks: first.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW });
    expect(renewed.lease.generation).toBe(2);
    const released = releaseLease({ tasks: renewed.tasks, taskId: "t", agentId: "a", generation: 2, now: NOW });
    const second = assign(released, NOW);
    expect(second.assignment.lease.generation).toBe(3);
    expect(() =>
      submitResult({
        tasks: second.tasks, taskId: "t", agentId: "a", generation: 2, now: NOW,
        result: doneResult(),
      }),
    ).toThrowError(/does not match owner\/generation/);
  });

  it("reassignment to a different agent also fences the old generation", () => {
    const first = assign([task("t")]);
    const released = releaseLease({ tasks: first.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW });
    const second = assign(released, NOW, [{ id: "b", scopes: ["team-brain"] }]);
    expect(second.assignment.agentId).toBe("b");
    expect(second.assignment.lease.generation).toBe(2);
    expect(() =>
      submitResult({
        tasks: second.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
        result: doneResult(),
      }),
    ).toThrowError(/does not match owner\/generation/);
  });
});

describe("TBP3-002: outbox identity binds the whole write intent", () => {
  for (const field of ["targetRepo", "targetPath", "expectedPriorBlob"]) {
    it(`replay with a changed ${field} is CONFLICTING_REPLAY, not a silent dedup`, () => {
      const first = enqueueOutbox([], outboxEntry());
      const value =
        field === "targetRepo"
          ? "onyxgolden/marketplace409"
          : field === "targetPath"
            ? "results/team-brain/receipts/other.json"
            : "b".repeat(40);
      // targetRepo change needs the changed repo to be allowlisted to
      // reach the replay check; use a custom policy that allows both.
      const opts =
        field === "targetRepo"
          ? { allowedRepos: ["onyxgolden/forge-ai-drop", "onyxgolden/marketplace409"] }
          : undefined;
      expect(() => enqueueOutbox(first.entries, outboxEntry({ [field]: value }), opts)).toThrowError(
        /different/,
      );
    });
  }

  it("exact replay still dedups", () => {
    const first = enqueueOutbox([], outboxEntry());
    const second = enqueueOutbox(first.entries, outboxEntry());
    expect(second.deduped).toBe(true);
    expect(second.entries).toHaveLength(1);
  });

  it("delivery observed from another repo is REPO_MISMATCH, never stamped as intended", () => {
    const c = claimedEntry();
    expect(() =>
      recordDelivery({
        entries: c.entries, operationId: "op", owner: "a", generation: 1, now: NOW,
        gitResponse: {
          repo: "synthetic/other", priorBlob: "a".repeat(40), newBlob: "b".repeat(40),
          head: "c".repeat(40), path: "results/team-brain/receipts/op.json",
        },
      }),
    ).toThrowError(/does not match outbox target/);
  });

  it("delivery with an unknown gitResponse field is refused", () => {
    const c = claimedEntry();
    expect(() =>
      recordDelivery({
        entries: c.entries, operationId: "op", owner: "a", generation: 1, now: NOW,
        gitResponse: {
          repo: "onyxgolden/forge-ai-drop", priorBlob: "a".repeat(40), newBlob: "b".repeat(40),
          head: "c".repeat(40), path: "results/team-brain/receipts/op.json", extra: "nope",
        },
      }),
    ).toThrowError(/unknown field/);
  });

  it("caller mutation after enqueue cannot drift the admitted payload", () => {
    const payload = { text: "before" };
    const first = enqueueOutbox([], outboxEntry({ payload }));
    payload.text = "after";
    expect(first.entry.payload.text).toBe("before");
    expect(first.entry.payload).not.toBe(payload);
  });
});

describe("TBP3-003: required outputs need own properties", () => {
  for (const name of ["constructor", "toString", "__proto__"]) {
    it(`inherited ${name} does not satisfy a required output`, () => {
      const a = assign([task("t", { requiredOutputs: [name] })]);
      const outputs = JSON.parse("{}");
      expect(Object.hasOwn(outputs, name)).toBe(false);
      const r = submitResult({
        tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
        result: { status: "done", outputs },
      });
      expect(r.rejected).toBeDefined();
      expect(r.tasks[0].status).not.toBe("DONE");
    });
  }

  it("an ordinary missing output is still rejected; a legitimate own field passes", () => {
    const a = assign([task("t", { requiredOutputs: ["out"] })]);
    const missing = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: { status: "done", outputs: {} },
    });
    expect(missing.rejected).toBeDefined();
    const own = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: { status: "done", outputs: { constructor: "own value", out: "ok" } },
    });
    // requiredOutputs is ["out"] here, so the own constructor value is
    // extra but harmless; the required output itself is present.
    expect(own.tasks[0].status).toBe("DONE");
  });
});

describe("TBP3-004: timeout recovery is bounded", () => {
  it("maxAttempts 1 escalates on the first expired reclaim", () => {
    let tasks = [task("t", { maxAttempts: 1 })];
    tasks = assign(tasks).tasks;
    const later = new Date(Date.parse(NOW) + LEASE_MS + 1).toISOString();
    tasks = reclaimExpiredLeases({ tasks, now: later });
    expect(tasks[0].status).toBe("ESCALATED");
    expect(tasks[0].escalation.kind).toBe("TIMEOUT_LIMIT");
    expect(tasks[0].timeoutCount).toBe(1);
    expect(tasks[0].attempts).toBe(0);
  });

  it("exact limit/+1: maxAttempts 2 survives one reclaim, escalates on the second", () => {
    let tasks = [task("t", { maxAttempts: 2 })];
    let now = NOW;
    tasks = assign(tasks, now).tasks;
    now = new Date(Date.parse(now) + LEASE_MS + 1).toISOString();
    tasks = reclaimExpiredLeases({ tasks, now });
    expect(tasks[0].status).toBe("QUEUED");
    expect(tasks[0].timeoutCount).toBe(1);
    tasks = assign(tasks, now).tasks;
    now = new Date(Date.parse(now) + LEASE_MS + 1).toISOString();
    tasks = reclaimExpiredLeases({ tasks, now });
    expect(tasks[0].status).toBe("ESCALATED");
    expect(tasks[0].timeoutCount).toBe(2);
  });

  it("proven failures and timeouts consume separate budgets", () => {
    let tasks = [task("t", { maxAttempts: 3 })];
    tasks = assign(tasks).tasks;
    tasks = submitResult({
      tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: { status: "failed", error: "boom" },
    }).tasks;
    expect(tasks[0].attempts).toBe(1);
    expect(tasks[0].timeoutCount).toBe(0);
    tasks = assign(tasks).tasks;
    const later = new Date(Date.parse(NOW) + LEASE_MS + 1).toISOString();
    tasks = reclaimExpiredLeases({ tasks, now: later });
    expect(tasks[0].status).toBe("QUEUED");
    expect(tasks[0].attempts).toBe(1);
    expect(tasks[0].timeoutCount).toBe(1);
  });
});

describe("TBP3-005: conflicting page rows conflict, never first-win", () => {
  it("both conflict orders report the conflict with no oldest", () => {
    const open = task("t");
    const done = { ...open, status: "DONE" };
    for (const pages of [[[done], [open]], [[open], [done]]]) {
      const r = oldestAcrossPages(pages, NOW);
      expect(r.oldest).toBeNull();
      expect(r.oldestAgeMs).toBeNull();
      expect(r.conflictedIds).toEqual(["t"]);
    }
  });

  it("mixed revisions for one id conflict; identical rows dedup", () => {
    const a = task("t", { snapshotRevision: 0 });
    const b = { ...a, snapshotRevision: 5 };
    expect(oldestAcrossPages([[a], [b]], NOW).conflictedIds).toEqual(["t"]);
    const r = oldestAcrossPages([[a], [a]], NOW);
    expect(r.conflictedIds).toEqual([]);
    expect(r.oldest.id).toBe("t");
  });
});

describe("TBP3-006: answering cancels unsent intents, gates in-flight ones", () => {
  // Fix round 2 (TBP3-006A): task-derived intents bind the current
  // applicability token at admission; the tests below bind it from the
  // assigned task record, as production callers must.
  it("answer-before-claim: cancelled intent cannot be claimed", () => {
    const a = assign([task("t", { filedAt: "2026-10-27T06:00:00Z" })]);
    const pending = enqueueOutbox([], outboxEntry({
      payload: { taskId: "t", kind: "REPING_DUE" },
      sourceTaskRevision: taskApplicabilityToken(a.tasks[0]),
    }));
    const answered = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: doneResult(),
    }).tasks;
    const { entries, cancelled } = cancelOutboxForTask(pending.entries, "t", NOW);
    expect(cancelled).toEqual(["op"]);
    expect(entries[0].state).toBe("CANCELLED");
    expect(() => claimOutbox({ entries, operationId: "op", owner: "sender", now: NOW })).toThrowError(
      /cancelled/,
    );
  });

  it("answer-during-claim: delivery is gated on current applicability", () => {
    const a = assign([task("t")]);
    const pending = enqueueOutbox([], outboxEntry({
      payload: { taskId: "t", kind: "REPING_DUE" },
      sourceTaskRevision: taskApplicabilityToken(a.tasks[0]),
    }));
    const c = claimOutbox({ entries: pending.entries, operationId: "op", owner: "a", now: NOW, tasks: a.tasks });
    const answered = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: doneResult(),
    }).tasks;
    expect(() =>
      recordDelivery({
        entries: c.entries, operationId: "op", owner: "a", generation: 1, now: NOW, tasks: answered,
        gitResponse: {
          repo: "onyxgolden/forge-ai-drop", priorBlob: "a".repeat(40), newBlob: "b".repeat(40),
          head: "c".repeat(40), path: "results/team-brain/receipts/op.json",
        },
      }),
    ).toThrowError(/stale/);
    expect(c.entries[0].state).toBe("CLAIMED");
  });

  it("claim with live task state still works", () => {
    const a = assign([task("t")]);
    const pending = enqueueOutbox([], outboxEntry({
      payload: { taskId: "t", kind: "REPING_DUE" },
      sourceTaskRevision: taskApplicabilityToken(a.tasks[0]),
    }));
    const claim = claimOutbox({ entries: pending.entries, operationId: "op", owner: "sender", now: NOW, tasks: a.tasks });
    expect(claim.entry.state).toBe("CLAIMED");
  });
});

describe("TBP3-007: status projection is canonical", () => {
  it("escalated unresolved task appears in oldest and escalations", () => {
    const a = assign([task("t", { maxAttempts: 1, filedAt: "2026-10-27T06:00:00Z" })]);
    const r = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: { status: "failed", error: "synthetic" },
    });
    expect(r.tasks[0].escalation.stage).toBe("REPORT_TO_JASON_DUE");
    const s = exportStatus({ tasks: r.tasks, now: NOW });
    expect(s.oldest.id).toBe("t");
    expect(s.escalations.map((e) => e.id)).toContain("t");
    expect(s.escalations.find((e) => e.id === "t").action).toBe("REPORT_TO_JASON_DUE");
  });

  it("blocker inherits its ask's age in exported escalations", () => {
    const tasks = [
      task("ask", { filedAt: "2026-10-27T06:00:00Z", deps: ["blocker"] }),
      task("blocker", { filedAt: "2026-10-27T11:00:00Z" }),
    ];
    const p = assign(tasks);
    expect(p.assignment.taskId).toBe("blocker");
    const s = exportStatus({ tasks, now: NOW });
    expect(s.escalations.map((e) => e.id)).toContain("blocker");
    // Effective age is inherited (06:00), not the blocker's own 11:00.
    expect(effectiveFiledMsById(tasks, NOW).blocker).toBe(Date.parse("2026-10-27T06:00:00Z"));
  });

  it("agent state prefers executing over an older waiting task", () => {
    const a = assign([task("first")]);
    const w = submitResult({
      tasks: a.tasks, taskId: "first", agentId: "a", generation: 1, now: NOW,
      result: { status: "needs_input", question: "synthetic question" },
    }).tasks;
    const next = assign([...w, task("second")]);
    expect(next.assignment.taskId).toBe("second");
    const executing = startExecution({
      tasks: next.tasks, taskId: "second", agentId: "a", generation: 1, now: NOW,
    });
    expect(executing[1].status).toBe("EXECUTING");
    expect(agentState("a", executing)).toBe("EXECUTING");
  });

  it("terminal-complete tasks stay out of oldest and escalations", () => {
    const a = assign([task("t")]);
    const done = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: doneResult(),
    }).tasks;
    const s = exportStatus({ tasks: done, now: NOW });
    expect(s.oldest).toBeNull();
    expect(s.escalations).toEqual([]);
    expect(escalationFor(done[0], NOW)).toBeNull();
  });
});

describe("TBP3-008: receipts carry digests, not free-form text", () => {
  it("goal canary never appears; goal digest does", () => {
    const marker = "SYNTHETIC_SECRET_DO_NOT_EXPORT";
    const t = task("t", { goal: marker });
    const receipt = exportReceipt(t);
    expect(receipt).not.toContain(marker);
    const parsed = JSON.parse(receipt);
    expect(parsed.goalDigest).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed).not.toHaveProperty("goal");
    expect(exportReceipt(t)).toBe(receipt);
  });
});

describe("TBP3-009: destinations are allowlisted and canonical", () => {
  it("unregistered repo is refused", () => {
    expect(() => enqueueOutbox([], outboxEntry({ targetRepo: "synthetic/unregistered" }))).toThrowError(
      /not in the destination allowlist/,
    );
  });

  for (const bad of [
    "commands/team-brain/./not-normalized.json",
    "results//double-slash.json",
    "results\\backslash.json",
    "results/team-brain/../escape.json",
  ]) {
    it(`noncanonical path is refused: ${bad}`, () => {
      expect(() => enqueueOutbox([], outboxEntry({ targetPath: bad }))).toThrowError(/not canonical|not repo-relative/);
    });
  }

  it("allowed repo + canonical path still admits; injected policy is authoritative", () => {
    const ok = enqueueOutbox([], outboxEntry());
    expect(ok.entry.state).toBe("PENDING");
    expect(() =>
      enqueueOutbox([], outboxEntry(), { allowedRepos: ["other/repo"] }),
    ).toThrowError(/not in the destination allowlist/);
    const custom = enqueueOutbox([], outboxEntry({ targetRepo: "other/repo" }), {
      allowedRepos: ["other/repo"],
    });
    expect(custom.entry.state).toBe("PENDING");
  });
});

describe("TBP3-010: waiting tasks resume on their awaited event or input", () => {
  function waitingBlocked() {
    const a = assign([task("t")]);
    const w = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: { status: "blocked", blockedOn: "synthetic-event" },
    }).tasks;
    expect(w[0].status).toBe("WAITING");
    return w;
  }

  it("wrong event is refused; correct event resumes with history preserved", () => {
    const w = waitingBlocked();
    expect(() => resumeWaiting({ tasks: w, taskId: "t", now: NOW, event: "other-event" })).toThrowError(
      /does not match awaited event/,
    );
    const resumed = resumeWaiting({ tasks: w, taskId: "t", now: NOW, event: "synthetic-event" });
    const t = resumed.find((x) => x.id === "t");
    expect(t.status).toBe("QUEUED");
    expect(t.filedAt).toBe(T0);
    expect(t.attempts).toBe(0);
    expect(t.transitions.length).toBeGreaterThan(w[0].transitions.length);
    expect(t.blockedOn).toBeNull();
    expect(t.lease).toBeNull();
    const again = assign(resumed);
    expect(again.assignment.taskId).toBe("t");
    const done = submitResult({
      tasks: again.tasks, taskId: "t", agentId: "a", generation: again.assignment.lease.generation,
      now: NOW, result: doneResult(),
    });
    expect(done.tasks[0].status).toBe("DONE");
  });

  it("duplicate resume is refused once the task has left WAITING", () => {
    const w = waitingBlocked();
    const resumed = resumeWaiting({ tasks: w, taskId: "t", now: NOW, event: "synthetic-event" });
    expect(() => resumeWaiting({ tasks: resumed, taskId: "t", now: NOW, event: "synthetic-event" })).toThrowError(
      /not WAITING/,
    );
  });

  it("needs_input resumes only with a supplied input", () => {
    const a = assign([task("t")]);
    const w = submitResult({
      tasks: a.tasks, taskId: "t", agentId: "a", generation: 1, now: NOW,
      result: { status: "needs_input", question: "synthetic question" },
    }).tasks;
    expect(w[0].status).toBe("WAITING");
    expect(() => resumeWaiting({ tasks: w, taskId: "t", now: NOW })).toThrowError(/requires the awaited input/);
    const resumed = resumeWaiting({ tasks: w, taskId: "t", now: NOW, input: "synthetic answer" });
    expect(resumed.find((x) => x.id === "t").status).toBe("QUEUED");
    expect(resumed.find((x) => x.id === "t").question).toBeNull();
  });
});
