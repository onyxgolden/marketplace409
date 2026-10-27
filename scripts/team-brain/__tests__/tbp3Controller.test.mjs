// Team Brain slice 3 — orchestrator controller acceptance tests.
// Pure controller: fixed task lists + injected `now`, no I/O, no clock,
// no network, no sends. Every test names the brief §9 acceptance behavior
// it pins, not the implementation's internal shape.

import { describe, expect, it } from "vitest";
import {
  LEASE_MS,
  addDependency,
  agentState,
  assignNext,
  controllerIdleReport,
  createTask,
  escalationFor,
  oldestAcrossPages,
  reclaimExpiredLeases,
  releaseLease,
  renewLease,
  startExecution,
  submitResult,
} from "../orchestrator/controller.mjs";
import { FOUR_HOURS_MS } from "../queue/projection.mjs";

const NOW = "2026-10-27T12:00:00Z";
const T0 = "2026-10-27T10:00:00Z";
const T1 = "2026-10-27T11:00:00Z";

function task(id, filedAt, extra = {}) {
  return createTask({ id, goal: `goal-${id}`, filedAt, ...extra });
}
function agent(id, scopes = ["team-brain"]) {
  return { id, scopes };
}
function assigned(tasks, id, agentId, now = NOW) {
  const r = assignNext({ tasks, agents: [agent(agentId)], now, snapshotRevision: 0 });
  expect(r.assignment).not.toBeNull();
  expect(r.assignment.taskId).toBe(id);
  return { tasks: r.tasks, lease: r.assignment.lease };
}
function executing(tasks, id, agentId, now = NOW) {
  const a = assigned(tasks, id, agentId, now);
  return {
    tasks: startExecution({ tasks: a.tasks, taskId: id, agentId, generation: 1, now }),
    lease: a.lease,
  };
}

describe("ordering and dependencies", () => {
  it("older scope beats newer review: age is primary across kinds", () => {
    const tasks = [
      task("new-review", T1, { goal: "review" }),
      task("old-scope", T0, { goal: "scope" }),
    ];
    const r = assignNext({ tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    expect(r.assignment.taskId).toBe("old-scope");
  });

  it("transitive blockers: only the leaf is actionable", () => {
    const tasks = [
      task("a", T0, { deps: ["b"] }),
      task("b", T0, { deps: ["c"] }),
      task("c", T0),
    ];
    const r = assignNext({ tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    expect(r.assignment.taskId).toBe("c");
    expect(r.blocked.map((b) => b.id).sort()).toEqual(["a", "b"]);
  });

  it("concurrent graph cycle fails closed with members named", () => {
    const tasks = [task("a", T0), task("b", T0)];
    const withEdge = addDependency(tasks, "a", "b");
    expect(() => addDependency(withEdge, "b", "a")).toThrowError(/a -> b/);
  });

  it("self-dependency is rejected", () => {
    const tasks = [task("a", T0)];
    expect(() => addDependency(tasks, "a", "a")).toThrowError(/depends on itself/);
  });

  it("blocker inherits blocked age: blocker sorts ahead of younger work", () => {
    const tasks = [
      task("young", T1),
      task("blocker", "2026-10-27T11:30:00Z"),
      task("old-blocked", T0, { deps: ["blocker"] }),
    ];
    const r = assignNext({ tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    // blocker inherits old-blocked's 10:00 age, beating young (11:00).
    expect(r.assignment.taskId).toBe("blocker");
  });

  it("shuffled input yields the same assignment (deterministic)", () => {
    const mk = () => [task("z", T1), task("a", T0), task("m", "2026-10-27T10:30:00Z")];
    const r1 = assignNext({ tasks: mk(), agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    const r2 = assignNext({ tasks: [...mk()].reverse(), agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    expect(r1.assignment.taskId).toBe(r2.assignment.taskId);
    expect(r1.assignment.taskId).toBe("a");
  });

  it("Jason override reorders ahead of older plain work", () => {
    const grant = { id: "g1", granter: "Jason", itemId: "newer", rank: 1 };
    const tasks = [
      task("older", T0),
      task("newer", T1, {
        override: { actor: "Jason", recordedAt: T1, reason: "pin", authorityRef: "g1", rank: 1 },
      }),
    ];
    const r = assignNext({
      tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0, trustedAuthorizations: [grant],
    });
    expect(r.assignment.taskId).toBe("newer");
  });

  it("revoked override is a diagnostic refusal, not a silent skip", () => {
    const grant = { id: "g1", granter: "Jason", itemId: "t", rank: 1, revoked: true };
    const tasks = [
      task("t", T0, {
        override: { actor: "Jason", recordedAt: T0, reason: "pin", authorityRef: "g1", rank: 1 },
      }),
    ];
    expect(() =>
      assignNext({ tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0, trustedAuthorizations: [grant] }),
    ).toThrowError(/revoked/);
  });

  it("unknown-authority override is refused", () => {
    const tasks = [
      task("t", T0, {
        override: { actor: "Jason", recordedAt: T0, reason: "pin", authorityRef: "nope", rank: 1 },
      }),
    ];
    expect(() =>
      assignNext({ tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0, trustedAuthorizations: [] }),
    ).toThrowError(/unknown authority/);
  });
});

describe("escalation and age boundaries", () => {
  it("exactly four hours is no action due; one millisecond past is REPING_DUE", () => {
    const at = task("t", "2026-10-27T08:00:00Z");
    expect(escalationFor(at, "2026-10-27T12:00:00Z")).toBeNull();
    const past = escalationFor(at, "2026-10-27T12:00:00.001Z");
    expect(past.action).toBe("REPING_DUE");
    expect(past.ageMs).toBe(FOUR_HOURS_MS + 1);
  });

  it("reping sent advances to REPORT_TO_JASON_DUE; both sent ends the chain", () => {
    const base = task("t", "2026-10-27T06:00:00Z");
    const reping = { ...base, repingSent: true };
    expect(escalationFor(reping, NOW).action).toBe("REPORT_TO_JASON_DUE");
    const both = { ...base, repingSent: true, reportSent: true };
    expect(escalationFor(both, NOW)).toBeNull();
  });

  it("answered item cancels its unsent escalation", () => {
    const ex = executing([task("t", T0, { requiredOutputs: ["out"] })], "t", "a1");
    const withEsc = ex.tasks.map((t) =>
      t.id === "t" ? { ...t, escalation: { kind: "STALE", stage: "REPING_DUE", sent: false } } : t,
    );
    const r = submitResult({
      tasks: withEsc, taskId: "t", agentId: "a1", generation: 1,
      result: { status: "done", outputs: { out: 1 } }, now: NOW,
    });
    const done = r.tasks.find((t) => t.id === "t");
    expect(done.status).toBe("DONE");
    expect(done.escalation).toBeNull();
    expect(escalationFor(done, NOW)).toBeNull();
  });

  it("global oldest across pages beats every page-local oldest", () => {
    const page1 = [task("p1-young", T1)];
    const page2 = [task("p2-old", T0)];
    const r = oldestAcrossPages([page1, page2], NOW);
    expect(r.oldest.id).toBe("p2-old");
    expect(r.oldestAgeMs).toBe(Date.parse(NOW) - Date.parse(T0));
  });

  it("stale snapshot blocks use; current snapshot assigns", () => {
    const stale = task("stale", T0, { snapshotRevision: 3 });
    const r = assignNext({ tasks: [stale], agents: [agent("a1")], now: NOW, snapshotRevision: 5 });
    expect(r.assignment).toBeNull();
    expect(r.stale).toEqual(["stale"]);
    expect(r.reason).toBe("STALE_SNAPSHOT");
    const current = task("cur", T0, { snapshotRevision: 5 });
    const r2 = assignNext({ tasks: [current], agents: [agent("a1")], now: NOW, snapshotRevision: 5 });
    expect(r2.assignment.taskId).toBe("cur");
  });
});

describe("leases", () => {
  it("start with the wrong generation is STALE_LEASE", () => {
    const a = assigned([task("t", T0)], "t", "a1");
    expect(() =>
      startExecution({ tasks: a.tasks, taskId: "t", agentId: "a1", generation: 9, now: NOW }),
    ).toThrowError(/does not match owner\/generation/);
  });

  it("lease expiry boundary: at expiresAt the lease is dead", () => {
    const a = assigned([task("t", T0)], "t", "a1");
    const atExpiry = new Date(Date.parse(NOW) + LEASE_MS).toISOString();
    expect(() =>
      startExecution({ tasks: a.tasks, taskId: "t", agentId: "a1", generation: 1, now: atExpiry }),
    ).toThrowError(/expired/);
  });

  it("renew by a non-owner is STALE_LEASE; owner renew bumps generation and expiry", () => {
    const a = assigned([task("t", T0)], "t", "a1");
    expect(() =>
      renewLease({ tasks: a.tasks, taskId: "t", agentId: "a2", generation: 1, now: NOW }),
    ).toThrowError(/does not match owner\/generation/);
    const r = renewLease({ tasks: a.tasks, taskId: "t", agentId: "a1", generation: 1, now: NOW });
    expect(r.lease.generation).toBe(2);
    expect(Date.parse(r.lease.expiresAt)).toBe(Date.parse(NOW) + LEASE_MS);
  });

  it("release by owner re-queues; expired leases are reclaimed with attempts intact", () => {
    const a = assigned([task("t", T0)], "t", "a1");
    const released = releaseLease({ tasks: a.tasks, taskId: "t", agentId: "a1", generation: 1, now: NOW });
    const back = released.find((t) => t.id === "t");
    expect(back.status).toBe("QUEUED");
    expect(back.lease).toBeNull();
    const later = new Date(Date.parse(NOW) + LEASE_MS + 1000).toISOString();
    const reclaimed = reclaimExpiredLeases({ tasks: a.tasks, now: later });
    const taskAfter = reclaimed.find((t) => t.id === "t");
    expect(taskAfter.status).toBe("QUEUED");
    expect(taskAfter.attempts).toBe(0);
  });

  it("submit with an expired lease is LEASE_EXPIRED and changes nothing", () => {
    const ex = executing([task("t", T0)], "t", "a1");
    const later = new Date(Date.parse(NOW) + LEASE_MS + 1000).toISOString();
    expect(() =>
      submitResult({
        tasks: ex.tasks, taskId: "t", agentId: "a1", generation: 1,
        result: { status: "failed", error: "boom" }, now: later,
      }),
    ).toThrowError(/expired/);
    expect(ex.tasks.find((t) => t.id === "t").status).toBe("EXECUTING");
  });
});

describe("scoped assignment", () => {
  it("agent without the task scope is skipped; scoped agent assigns", () => {
    const tasks = [task("t", T0, { scope: "capture" })];
    const r = assignNext({ tasks, agents: [agent("a1", ["team-brain"])], now: NOW, snapshotRevision: 0 });
    expect(r.assignment).toBeNull();
    expect(r.reason).toBe("NO_SCOPED_AGENT");
    const r2 = assignNext({ tasks, agents: [agent("a1", ["capture"])], now: NOW, snapshotRevision: 0 });
    expect(r2.assignment.agentId).toBe("a1");
  });

  it("busy scoped agent yields ALL_AGENTS_BUSY, not a double assignment", () => {
    const a = assigned([task("t1", T0)], "t1", "a1");
    const tasks = [...a.tasks, task("t2", T1)];
    const r = assignNext({ tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    expect(r.assignment).toBeNull();
    expect(r.reason).toBe("ALL_AGENTS_BUSY");
  });
});

describe("structured result validation", () => {
  const malformedCases = [
    ["non-object result", null],
    ["unknown status", { status: "maybe" }],
    ["unknown field", { status: "failed", error: "x", surprise: 1 }],
    ["off-topic goal", { status: "failed", error: "x", goal: "other-goal" }],
    ["done without outputs", { status: "done" }],
    ["done missing required output", { status: "done", outputs: {} }],
    ["blocked without blockedOn", { status: "blocked" }],
    ["needs_input without question", { status: "needs_input" }],
    ["failed without error", { status: "failed" }],
  ];
  it.each(malformedCases)("malformed result rejected without advancing state: %s", (_name, result) => {
    const ex = executing([task("t", T0, { requiredOutputs: ["out"] })], "t", "a1");
    const r = submitResult({ tasks: ex.tasks, taskId: "t", agentId: "a1", generation: 1, result, now: NOW });
    expect(r.rejected.code).toMatch(/MALFORMED/);
    const after = r.tasks.find((t) => t.id === "t");
    expect(after.status).toBe("EXECUTING");
    expect(after.malformedCount).toBe(1);
    expect(after.lease).not.toBeNull();
  });

  it("malformed limit escalates with MALFORMED_LIMIT", () => {
    let tasks = executing([task("t", T0, { maxMalformed: 2 })], "t", "a1").tasks;
    let r = submitResult({ tasks, taskId: "t", agentId: "a1", generation: 1, result: { status: "nope" }, now: NOW });
    expect(r.rejected.code).toBe("MALFORMED_RESULT");
    r = submitResult({ tasks: r.tasks, taskId: "t", agentId: "a1", generation: 1, result: { status: "nope" }, now: NOW });
    expect(r.rejected.code).toBe("MALFORMED_LIMIT");
    const after = r.tasks.find((t) => t.id === "t");
    expect(after.status).toBe("ESCALATED");
    expect(after.lease).toBeNull();
  });

  it("done stores the result, clears the lease, and closes", () => {
    const ex = executing([task("t", T0, { requiredOutputs: ["out"] })], "t", "a1");
    const r = submitResult({
      tasks: ex.tasks, taskId: "t", agentId: "a1", generation: 1,
      result: { status: "done", outputs: { out: "ok" } }, now: NOW,
    });
    expect(r.accepted.status).toBe("done");
    const after = r.tasks.find((t) => t.id === "t");
    expect(after.status).toBe("DONE");
    expect(after.result.outputs.out).toBe("ok");
    expect(after.lease).toBeNull();
  });

  it("blocked waits on the defined event; needs_input waits on the question", () => {
    const ex1 = executing([task("t", T0)], "t", "a1");
    const r1 = submitResult({
      tasks: ex1.tasks, taskId: "t", agentId: "a1", generation: 1,
      result: { status: "blocked", blockedOn: "verdict-file" }, now: NOW,
    });
    const w1 = r1.tasks.find((t) => t.id === "t");
    expect(w1.status).toBe("WAITING");
    expect(w1.blockedOn).toBe("verdict-file");
    expect(w1.nextAction).toBe("WAIT_EXTERNAL");
    const ex2 = executing([task("u", T0)], "u", "a1");
    const r2 = submitResult({
      tasks: ex2.tasks, taskId: "u", agentId: "a1", generation: 1,
      result: { status: "needs_input", question: "approve?" }, now: NOW,
    });
    const w2 = r2.tasks.find((t) => t.id === "u");
    expect(w2.status).toBe("WAITING");
    expect(w2.question).toBe("approve?");
    expect(w2.nextAction).toBe("AWAIT_INPUT");
  });

  it("failed below the limit re-queues with RETRY; at the limit escalates", () => {
    let ex = executing([task("t", T0, { maxAttempts: 2 })], "t", "a1");
    let r = submitResult({
      tasks: ex.tasks, taskId: "t", agentId: "a1", generation: 1,
      result: { status: "failed", error: "boom" }, now: NOW,
    });
    expect(r.accepted.status).toBe("queued_retry");
    let after = r.tasks.find((t) => t.id === "t");
    expect(after.status).toBe("QUEUED");
    expect(after.attempts).toBe(1);
    expect(after.nextAction).toBe("RETRY");
    // Fix round 1 (TBP3-001): the reassignment fences with a new
    // generation, so the second round must use the fresh lease
    // generation — a hardcoded generation 1 is now correctly stale.
    const re = assignNext({ tasks: r.tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    expect(re.assignment.lease.generation).toBe(2);
    ex = {
      tasks: startExecution({
        tasks: re.tasks, taskId: "t", agentId: "a1", generation: re.assignment.lease.generation, now: NOW,
      }),
      lease: re.assignment.lease,
    };
    r = submitResult({
      tasks: ex.tasks, taskId: "t", agentId: "a1", generation: ex.lease.generation,
      result: { status: "failed", error: "boom again" }, now: NOW,
    });
    expect(r.accepted).toEqual({ status: "escalated", reason: "RETRY_LIMIT" });
    after = r.tasks.find((t) => t.id === "t");
    expect(after.status).toBe("ESCALATED");
    expect(after.attempts).toBe(2);
  });

  it("escalated dependency keeps dependents blocked", () => {
    const dep = task("dep", T0, { maxAttempts: 1 });
    const child = task("child", T0, { deps: ["dep"] });
    const ex = executing([dep, child], "dep", "a1");
    const r = submitResult({
      tasks: ex.tasks, taskId: "dep", agentId: "a1", generation: 1,
      result: { status: "failed", error: "boom" }, now: NOW,
    });
    expect(r.tasks.find((t) => t.id === "dep").status).toBe("ESCALATED");
    const r2 = assignNext({ tasks: r.tasks, agents: [agent("a1")], now: NOW, snapshotRevision: 0 });
    expect(r2.assignment).toBeNull();
    expect(r2.blocked.map((b) => b.id)).toEqual(["child"]);
  });

  it("result on a terminal task is ALREADY_TERMINAL", () => {
    const ex = executing([task("t", T0)], "t", "a1");
    const done = submitResult({
      tasks: ex.tasks, taskId: "t", agentId: "a1", generation: 1,
      result: { status: "done", outputs: {} }, now: NOW,
    }).tasks;
    expect(() =>
      submitResult({
        tasks: done, taskId: "t", agentId: "a1", generation: 1,
        result: { status: "done", outputs: {} }, now: NOW,
      }),
    ).toThrowError(/is DONE/);
  });
});

describe("no idle state without explicit controller marking", () => {
  it("unmarked idle report is false with NO_EXPLICIT_CONTROLLER_MARKING", () => {
    expect(controllerIdleReport({})).toEqual({ idle: false, reason: "NO_EXPLICIT_CONTROLLER_MARKING" });
    expect(controllerIdleReport({ markedIdle: { reason: "QUEUE_DRAINED_BY_HAND" } })).toEqual({
      idle: true,
      reason: "QUEUE_DRAINED_BY_HAND",
    });
  });

  it("agent state is never IDLE: unassigned is UNASSIGNED", () => {
    const tasks = [task("t", T0)];
    expect(agentState("nobody", tasks)).toBe("UNASSIGNED");
    const a = assigned(tasks, "t", "a1");
    expect(agentState("a1", a.tasks)).toBe("ASSIGNED");
  });
});
