// Team Brain slice 3 — status and receipt exporters.
//
// Deterministic, secret-free projections over controller task records and
// outbox entries. Exporters never mutate state, never send, and never
// include payload contents — only identities, counts, and digests, so a
// status export can be pasted anywhere without leaking coordination
// content. Receipts are canonical (key-sorted) JSON strings: the same task
// exports byte-identically regardless of insertion order.

import { stableStringify } from "../report/stableStringify.mjs";
import { escalationFor } from "./controller.mjs";
import { FOUR_HOURS_MS } from "../queue/projection.mjs";
import { utcIsoToMs } from "../ledger/validation.mjs";

export { FOUR_HOURS_MS };

export function exportStatus({ tasks, outboxEntries = [], now }) {
  const nowMs = utcIsoToMs(now, "now");
  const counts = {};
  for (const task of tasks || []) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }
  const open = (tasks || []).filter((t) => t.status !== "DONE" && t.status !== "ESCALATED");
  let oldest = null;
  let oldestAgeMs = null;
  for (const task of open) {
    const ageMs = nowMs - utcIsoToMs(task.filedAt, `task.filedAt for ${task.id}`);
    if (oldestAgeMs === null || ageMs > oldestAgeMs || (ageMs === oldestAgeMs && task.id < oldest.id)) {
      oldest = { id: task.id, status: task.status };
      oldestAgeMs = ageMs;
    }
  }
  const escalations = (tasks || [])
    .map((t) => escalationFor(t, now))
    .filter(Boolean)
    .sort((a, b) => b.ageMs - a.ageMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const outboxCounts = {};
  for (const entry of outboxEntries) {
    outboxCounts[entry.state] = (outboxCounts[entry.state] || 0) + 1;
  }
  return {
    generatedAt: now,
    taskCounts: counts,
    totalTasks: (tasks || []).length,
    oldest,
    oldestAgeMs,
    escalations,
    outboxCounts,
  };
}

export function exportReceipt(task) {
  if (!task) throw new Error("exportReceipt requires a task");
  return stableStringify({
    id: task.id,
    goal: task.goal,
    scope: task.scope,
    status: task.status,
    filedAt: task.filedAt,
    attempts: task.attempts,
    maxAttempts: task.maxAttempts,
    malformedCount: task.malformedCount,
    ownerAgent: task.ownerAgent,
    nextAction: task.nextAction,
    escalation: task.escalation,
    resultStatus: task.result?.status ?? null,
    transitions: (task.transitions || []).map((t) => ({ at: t.at, from: t.from, to: t.to, reason: t.reason })),
  });
}
