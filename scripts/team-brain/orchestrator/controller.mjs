// Team Brain slice 3 — deterministic supervisor / work-queue controller.
//
// Pure functions over durable task records: no I/O, no clock reads, no
// network, no model calls, no sends. Callers pass `now` (UTC ISO) and the
// current task list; every function returns a new task list and never
// mutates its inputs. The controller owns assignment, progress checks and
// escalation; it never relies on chat history or agent self-report.
//
// Task record fields (all inputs validated by createTask):
//   id, goal, scope, status, filedAt, deps, state ("OPEN"/"CLOSED"),
//   attempts, maxAttempts, malformedCount, maxMalformed,
//   ownerAgent, lease, nextAction, blockedOn, question, requiredOutputs,
//   result, snapshotRevision, override, repingSent, reportSent,
//   escalation, transitions.
//
// Statuses: QUEUED, ASSIGNED, EXECUTING, WAITING (blocked on a defined
// external event, or awaiting a defined input question), DONE, ESCALATED.
// Dependency blocking is expressed by the slice-1 queue projection: a task
// whose dependencies are unresolved stays QUEUED and is never assigned.
// There is NO idle state: an agent is EXECUTING, WAITING, ESCALATED, or
// UNASSIGNED, and the controller reports idle only when explicitly marked
// (see controllerIdleReport). No automatic closure: DONE requires a
// validated `done` result; nothing here sends notifications or closes
// another agent's work.

import { CODES, fail, P3_CODES } from "./errors.mjs";
import { FOUR_HOURS_MS, projectQueue } from "../queue/projection.mjs";
import { assertNonEmptyString, assertStringArray, utcIsoToMs } from "../ledger/validation.mjs";

export const LEASE_MS = 15 * 60 * 1000;
export const DEFAULT_MAX_ATTEMPTS = 3;
export const DEFAULT_MAX_MALFORMED = 3;

const TERMINAL = new Set(["DONE", "ESCALATED"]);
const RESULT_STATUSES = new Set(["done", "blocked", "needs_input", "failed"]);
// Closed result schema: anything outside this key set is malformed, so a
// stray field can never smuggle an obligation, permission, or closure
// through the controller.
const RESULT_KEYS = new Set(["status", "outputs", "blockedOn", "question", "error", "goal", "evidence"]);

function transition(task, to, reason, now) {
  return {
    ...task,
    status: to,
    transitions: [...(task.transitions || []), { at: now, from: task.status, to, reason }],
  };
}

function byId(tasks) {
  return new Map(tasks.map((t) => [t.id, t]));
}

function replaceTask(tasks, next) {
  return tasks.map((t) => (t.id === next.id ? next : t));
}

export function createTask(fields) {
  const {
    id,
    goal,
    scope = "team-brain",
    filedAt,
    deps = [],
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    maxMalformed = DEFAULT_MAX_MALFORMED,
    requiredOutputs = [],
    snapshotRevision = 0,
    override = null,
  } = fields || {};
  assertNonEmptyString(id, "task.id");
  assertNonEmptyString(goal, "task.goal");
  assertNonEmptyString(scope, "task.scope");
  utcIsoToMs(filedAt, `task.filedAt for ${id}`);
  assertStringArray(deps, `task.deps for ${id}`);
  if (new Set(deps).size !== deps.length) {
    fail(CODES.INVALID_FIELD, `Task ${id} has duplicate dependencies`, { id });
  }
  if (deps.includes(id)) {
    fail(CODES.SELF_DEPENDENCY, `Task ${id} depends on itself`, { id });
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    fail(CODES.INVALID_FIELD, `Task ${id} maxAttempts must be a positive integer`, { id });
  }
  if (!Number.isInteger(maxMalformed) || maxMalformed < 1) {
    fail(CODES.INVALID_FIELD, `Task ${id} maxMalformed must be a positive integer`, { id });
  }
  assertStringArray(requiredOutputs, `task.requiredOutputs for ${id}`);
  return {
    id,
    goal,
    scope,
    status: "QUEUED",
    filedAt,
    deps: [...deps],
    state: "OPEN",
    attempts: 0,
    maxAttempts,
    malformedCount: 0,
    maxMalformed,
    ownerAgent: null,
    lease: null,
    nextAction: null,
    blockedOn: null,
    question: null,
    requiredOutputs: [...requiredOutputs],
    result: null,
    snapshotRevision,
    override,
    repingSent: false,
    reportSent: false,
    escalation: null,
    transitions: [],
  };
}

// Add a dependency edge, failing closed on a cycle. Unknown dependency ids
// are blockers, not errors (the projection treats them as unresolved).
export function addDependency(tasks, taskId, depId) {
  const map = byId(tasks);
  const task = map.get(taskId);
  if (!task) fail(P3_CODES.UNKNOWN_TASK, `Unknown task ${taskId}`, { taskId });
  if (depId === taskId) {
    fail(CODES.SELF_DEPENDENCY, `Task ${taskId} depends on itself`, { id: taskId });
  }
  if (task.deps.includes(depId)) return tasks;
  const next = tasks.map((t) =>
    t.id === taskId ? { ...t, deps: [...t.deps, depId] } : t,
  );
  // Cycle check over the known-id graph (same rule as the projection:
  // unknown ids are blockers, never cycle members).
  const known = new Map(next.map((t) => [t.id, t]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map(next.map((t) => [t.id, WHITE]));
  const stack = [];
  function visit(id) {
    color.set(id, GRAY);
    stack.push(id);
    const node = known.get(id);
    for (const dep of [...(node.deps || [])].sort()) {
      if (!known.has(dep)) continue;
      if (color.get(dep) === GRAY) {
        const members = [...new Set(stack.slice(stack.indexOf(dep)).concat(dep))].sort();
        fail(CODES.DEPENDENCY_CYCLE, `Dependency cycle detected: ${members.join(" -> ")}`, {
          cycle: members,
        });
      }
      if (color.get(dep) === WHITE) visit(dep);
    }
    stack.pop();
    color.set(id, BLACK);
  }
  for (const t of [...next].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))) {
    if (color.get(t.id) === WHITE) visit(t.id);
  }
  return next;
}

// A revoked override is a diagnostic, not a silent skip: assignment of that
// task is refused with the authority reference named.
function checkRevokedOverrides(tasks, trustedAuthorizations = []) {
  const revoked = new Set(
    (trustedAuthorizations || []).filter((r) => r && r.revoked).map((r) => r.id),
  );
  for (const task of tasks) {
    const ref = task.override?.authorityRef;
    if (ref && revoked.has(ref)) {
      fail(P3_CODES.REVOKED_OVERRIDE, `Priority override for ${task.id} rejected: authority ${ref} is revoked`, {
        id: task.id,
        authorityRef: ref,
      });
    }
  }
}

function toProjectionObligations(tasks) {
  return tasks.map((t) => ({
    id: t.id,
    kind: "TASK",
    filedAt: t.filedAt,
    // Only DONE closes a dependency. An ESCALATED task stays unresolved:
    // its dependents remain blocked behind it, never released by escalation.
    state: t.status === "DONE" ? "CLOSED" : "OPEN",
    deps: t.deps,
    repingSent: t.repingSent,
    reportSent: t.reportSent,
    override: t.override,
  }));
}

// Assign the oldest ready task to a free agent scoped for it. Ready means:
// projection-actionable (no unresolved deps), snapshot-current, and not
// terminal. Returns the new task list plus assignment detail; a null
// assignment always names its reason, never silently idles.
export function assignNext({ tasks, agents, now, snapshotRevision, trustedAuthorizations = [] }) {
  const nowMs = utcIsoToMs(now, "now");
  checkRevokedOverrides(tasks, trustedAuthorizations);
  const projection = projectQueue({
    obligations: toProjectionObligations(tasks),
    now,
    trustedAuthorizations,
  });
  const map = byId(tasks);
  // Assignment order is the projection's `ordered` list (override rank,
  // then effective age), not the plain age-sorted `actionable` list: a
  // Jason override must actually move its item ahead of older plain work.
  const actionable = projection.ordered
    .map((id) => map.get(id))
    .filter((t) => t && t.status === "QUEUED");
  const stale = [];
  const ready = [];
  for (const task of actionable) {
    if (task.snapshotRevision !== snapshotRevision) stale.push(task.id);
    else ready.push(task);
  }
  const busy = new Set(
    tasks.filter((t) => t.status === "ASSIGNED" || t.status === "EXECUTING").map((t) => t.ownerAgent),
  );
  for (const task of ready) {
    const agent = (agents || []).find(
      (a) => a && !busy.has(a.id) && (a.scopes || []).includes(task.scope),
    );
    if (!agent) continue;
    const generation = 1;
    const lease = {
      leaseId: `${task.id}:${generation}`,
      owner: agent.id,
      generation,
      issuedAt: now,
      expiresAt: new Date(nowMs + LEASE_MS).toISOString(),
    };
    const next = transition({ ...task, ownerAgent: agent.id, lease, nextAction: "EXECUTE" }, "ASSIGNED", "ASSIGNED", now);
    return {
      assignment: { taskId: task.id, agentId: agent.id, lease },
      tasks: replaceTask(tasks, next),
      blocked: projection.blocked,
      stale,
      reason: null,
    };
  }
  let reason;
  if (ready.length === 0) {
    reason = stale.length > 0 ? "STALE_SNAPSHOT" : "NO_READY_TASK";
  } else if ((agents || []).some((a) => ready.some((t) => (a.scopes || []).includes(t.scope)))) {
    reason = "ALL_AGENTS_BUSY";
  } else {
    reason = "NO_SCOPED_AGENT";
  }
  return { assignment: null, tasks, blocked: projection.blocked, stale, reason };
}

function leaseCheck(task, agentId, generation, now) {
  const nowMs = utcIsoToMs(now, "now");
  if (!task.lease || task.lease.owner !== agentId || task.lease.generation !== generation) {
    fail(P3_CODES.STALE_LEASE, `Lease for ${task.id} does not match owner/generation`, {
      id: task.id,
      agentId,
      generation,
    });
  }
  if (nowMs >= utcIsoToMs(task.lease.expiresAt, `lease.expiresAt for ${task.id}`)) {
    fail(P3_CODES.LEASE_EXPIRED, `Lease for ${task.id} expired at ${task.lease.expiresAt}`, {
      id: task.id,
      expiresAt: task.lease.expiresAt,
    });
  }
}

function requireTask(tasks, taskId) {
  const task = byId(tasks).get(taskId);
  if (!task) fail(P3_CODES.UNKNOWN_TASK, `Unknown task ${taskId}`, { taskId });
  return task;
}

export function startExecution({ tasks, taskId, agentId, generation, now }) {
  const task = requireTask(tasks, taskId);
  if (task.status !== "ASSIGNED") {
    fail(P3_CODES.NOT_EXECUTING, `Task ${taskId} is ${task.status}, not ASSIGNED`, { id: taskId });
  }
  leaseCheck(task, agentId, generation, now);
  return replaceTask(tasks, transition({ ...task, nextAction: "EXECUTE" }, "EXECUTING", "STARTED", now));
}

export function renewLease({ tasks, taskId, agentId, generation, now }) {
  const task = requireTask(tasks, taskId);
  if (task.status !== "ASSIGNED" && task.status !== "EXECUTING") {
    fail(P3_CODES.NOT_EXECUTING, `Task ${taskId} is ${task.status}, no lease to renew`, { id: taskId });
  }
  leaseCheck(task, agentId, generation, now);
  const nowMs = utcIsoToMs(now, "now");
  const nextGeneration = generation + 1;
  const lease = {
    leaseId: `${task.id}:${nextGeneration}`,
    owner: agentId,
    generation: nextGeneration,
    issuedAt: now,
    expiresAt: new Date(nowMs + LEASE_MS).toISOString(),
  };
  return {
    tasks: replaceTask(tasks, { ...task, lease }),
    lease,
  };
}

export function releaseLease({ tasks, taskId, agentId, generation, now }) {
  const task = requireTask(tasks, taskId);
  if (task.status !== "ASSIGNED" && task.status !== "EXECUTING") {
    fail(P3_CODES.NOT_EXECUTING, `Task ${taskId} is ${task.status}, no lease to release`, { id: taskId });
  }
  leaseCheck(task, agentId, generation, now);
  return replaceTask(
    tasks,
    transition({ ...task, ownerAgent: null, lease: null, nextAction: null }, "QUEUED", "LEASE_RELEASED", now),
  );
}

// Reclaim leases past expiry. Expired work returns to QUEUED with its
// attempts intact — a crash never silently consumes a retry.
export function reclaimExpiredLeases({ tasks, now }) {
  const nowMs = utcIsoToMs(now, "now");
  let next = tasks;
  for (const task of tasks) {
    if (
      (task.status === "ASSIGNED" || task.status === "EXECUTING") &&
      task.lease &&
      nowMs >= utcIsoToMs(task.lease.expiresAt, `lease.expiresAt for ${task.id}`)
    ) {
      next = replaceTask(
        next,
        transition({ ...task, ownerAgent: null, lease: null, nextAction: null }, "QUEUED", "LEASE_EXPIRED", now),
      );
    }
  }
  return next;
}

function malformed(tasks, task, reason, details, now) {
  const count = task.malformedCount + 1;
  let next = { ...task, malformedCount: count };
  next = transition(next, next.status, "RESULT_REJECTED", now);
  if (count >= task.maxMalformed) {
    next = transition(
      { ...next, ownerAgent: null, lease: null, nextAction: null, escalation: { kind: "MALFORMED_LIMIT", stage: "REPORT_TO_JASON_DUE", sent: false } },
      "ESCALATED",
      "MALFORMED_LIMIT",
      now,
    );
    return { tasks: replaceTask(tasks, next), rejected: { code: P3_CODES.MALFORMED_LIMIT, reason, ...details } };
  }
  return { tasks: replaceTask(tasks, next), rejected: { code: P3_CODES.MALFORMED_RESULT, reason, ...details } };
}

// Validate and apply one structured agent result. Malformed output is
// rejected without advancing state and never cascades: the task keeps its
// lease and position until the malformed limit escalates it.
export function submitResult({ tasks, taskId, agentId, generation, result, now }) {
  const task = requireTask(tasks, taskId);
  if (TERMINAL.has(task.status)) {
    fail(P3_CODES.ALREADY_TERMINAL, `Task ${taskId} is ${task.status}`, { id: taskId });
  }
  if (task.status !== "ASSIGNED" && task.status !== "EXECUTING") {
    fail(P3_CODES.NOT_EXECUTING, `Task ${taskId} is ${task.status}, cannot accept a result`, { id: taskId });
  }
  leaseCheck(task, agentId, generation, now);
  const bad = (reason, details = {}) => malformed(tasks, task, reason, details, now);

  if (!result || typeof result !== "object" || Array.isArray(result)) {
    return bad("result must be an object");
  }
  for (const key of Object.keys(result)) {
    if (!RESULT_KEYS.has(key)) return bad(`unknown result field ${key}`, { field: key });
  }
  if (!RESULT_STATUSES.has(result.status)) {
    return bad(`unknown result status ${String(result.status)}`, { status: result.status });
  }
  if (result.goal !== undefined && result.goal !== task.goal) {
    return bad("result goal does not match task goal", { goal: result.goal });
  }
  if (result.status === "done") {
    const outputs = result.outputs;
    if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) {
      return bad("done result requires an outputs object");
    }
    const missing = task.requiredOutputs.filter((k) => outputs[k] === undefined);
    if (missing.length > 0) return bad("done result missing required outputs", { missing });
    const next = transition(
      { ...task, result, ownerAgent: null, lease: null, nextAction: null, escalation: task.escalation?.sent ? task.escalation : null },
      "DONE",
      "COMPLETED",
      now,
    );
    return { tasks: replaceTask(tasks, next), accepted: { status: "done" } };
  }
  if (result.status === "blocked") {
    if (typeof result.blockedOn !== "string" || result.blockedOn.length === 0) {
      return bad("blocked result requires a defined blockedOn event");
    }
    const next = transition(
      { ...task, result, blockedOn: result.blockedOn, nextAction: "WAIT_EXTERNAL" },
      "WAITING",
      "BLOCKED_ON_EVENT",
      now,
    );
    return { tasks: replaceTask(tasks, next), accepted: { status: "blocked" } };
  }
  if (result.status === "needs_input") {
    if (typeof result.question !== "string" || result.question.length === 0) {
      return bad("needs_input result requires a question");
    }
    const next = transition(
      { ...task, result, question: result.question, nextAction: "AWAIT_INPUT" },
      "WAITING",
      "NEEDS_INPUT",
      now,
    );
    return { tasks: replaceTask(tasks, next), accepted: { status: "needs_input" } };
  }
  // failed
  if (typeof result.error !== "string" || result.error.length === 0) {
    return bad("failed result requires an error string");
  }
  const attempts = task.attempts + 1;
  if (attempts >= task.maxAttempts) {
    const next = transition(
      { ...task, result, attempts, ownerAgent: null, lease: null, nextAction: null, escalation: { kind: "RETRY_LIMIT", stage: "REPORT_TO_JASON_DUE", sent: false } },
      "ESCALATED",
      "RETRY_LIMIT",
      now,
    );
    return { tasks: replaceTask(tasks, next), accepted: { status: "escalated", reason: "RETRY_LIMIT" } };
  }
  const next = transition(
    { ...task, result, attempts, ownerAgent: null, lease: null, nextAction: "RETRY" },
    "QUEUED",
    "FAILED_RETRY",
    now,
  );
  return { tasks: replaceTask(tasks, next), accepted: { status: "queued_retry", attempts } };
}

// Escalation intent for one task at `now`. Strictly greater than four
// hours starts the chain; exactly four hours is pinned to no action due
// (same boundary as the slice-1 projection). Terminal tasks never
// escalate: an answered item cancels its unsent escalation.
export function escalationFor(task, now) {
  if (TERMINAL.has(task.status)) return null;
  const ageMs = utcIsoToMs(now, "now") - utcIsoToMs(task.filedAt, `task.filedAt for ${task.id}`);
  if (ageMs <= FOUR_HOURS_MS) return null;
  if (!task.repingSent) return { id: task.id, action: "REPING_DUE", ageMs };
  if (!task.reportSent) return { id: task.id, action: "REPORT_TO_JASON_DUE", ageMs };
  return null;
}

// Global oldest across pages of tasks. Pages are never trusted to be
// sorted: the whole graph is projected once, so an older item on a later
// page still beats a younger page-local oldest. Duplicate ids are
// de-duplicated (first occurrence wins); conflicting duplicates are a
// caller error, not something the controller guesses through.
export function oldestAcrossPages(pages, now) {
  const seen = new Map();
  for (const page of pages || []) {
    for (const task of page || []) {
      if (!seen.has(task.id)) seen.set(task.id, task);
    }
  }
  const all = [...seen.values()];
  if (all.length === 0) return { oldest: null, oldestAgeMs: null };
  const projection = projectQueue({
    obligations: toProjectionObligations(all),
    now,
  });
  return { oldest: projection.oldest, oldestAgeMs: projection.oldestAgeMs };
}

// Agent state, with no idle state to infer. An agent with no task is
// UNASSIGNED — never IDLE — until the controller explicitly marks idle.
export function agentState(agentId, tasks) {
  const current = tasks.find(
    (t) => t.ownerAgent === agentId && (t.status === "ASSIGNED" || t.status === "EXECUTING" || t.status === "WAITING"),
  );
  if (!current) return "UNASSIGNED";
  if (current.status === "WAITING") return "WAITING";
  if (current.status === "EXECUTING") return "EXECUTING";
  return "ASSIGNED";
}

export function controllerIdleReport({ markedIdle = null } = {}) {
  if (!markedIdle) return { idle: false, reason: "NO_EXPLICIT_CONTROLLER_MARKING" };
  return { idle: true, reason: markedIdle.reason || "CONTROLLER_MARKED_IDLE" };
}
