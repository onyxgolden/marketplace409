// Team Brain slice 3 — status and receipt exporters.
//
// Deterministic, secret-free projections over controller task records and
// outbox entries. Exporters never mutate state, never send, and never
// include payload contents or free-form task text — only identities,
// counts, and digests, so a status export can be pasted anywhere without
// leaking coordination content. Receipts are canonical (key-sorted) JSON
// strings: the same task exports byte-identically regardless of
// insertion order. Fix round 1 (TBP3-007/008): escalation is not
// resolution, ages are inherited effective ages, and the receipt carries
// a goal digest instead of verbatim goal text.

import { createHash } from "node:crypto";
import { stableStringify } from "../report/stableStringify.mjs";
import { escalationFor, effectiveFiledMsById } from "./controller.mjs";
import { FOUR_HOURS_MS } from "../queue/projection.mjs";
import { utcIsoToMs } from "../ledger/validation.mjs";

export { FOUR_HOURS_MS };

export function exportStatus({ tasks, outboxEntries = [], now, trustedAuthorizations = [] }) {
  const nowMs = utcIsoToMs(now, "now");
  const allTasks = tasks || [];
  const counts = {};
  for (const task of allTasks) {
    counts[task.status] = (counts[task.status] || 0) + 1;
  }
  // Escalation is not resolution (TBP3-007): an ESCALATED task whose
  // escalation has not been sent is still unresolved and still counts
  // toward oldest/escalations. Only DONE, and ESCALATED-with-sent
  // escalation, are resolved.
  const unresolved = allTasks.filter(
    (t) => t.status !== "DONE" && !(t.status === "ESCALATED" && t.escalation?.sent),
  );
  const effective = effectiveFiledMsById(allTasks, now, trustedAuthorizations);
  let oldest = null;
  let oldestAgeMs = null;
  for (const task of unresolved) {
    const effMs = effective[task.id] ?? utcIsoToMs(task.filedAt, `task.filedAt for ${task.id}`);
    const ageMs = nowMs - effMs;
    if (oldestAgeMs === null || ageMs > oldestAgeMs || (ageMs === oldestAgeMs && task.id < oldest.id)) {
      oldest = { id: task.id, status: task.status };
      oldestAgeMs = ageMs;
    }
  }
  const escalations = [];
  for (const task of unresolved) {
    const effMs = effective[task.id] ?? utcIsoToMs(task.filedAt, `task.filedAt for ${task.id}`);
    if (task.status === "ESCALATED" && task.escalation && !task.escalation.sent) {
      // Already-escalated tasks surface their pending Jason report with
      // their inherited effective age, not a fresh REPING intent.
      escalations.push({ id: task.id, action: task.escalation.stage, ageMs: nowMs - effMs });
    } else {
      const intent = escalationFor(task, now, effMs);
      if (intent) escalations.push(intent);
    }
  }
  escalations.sort((a, b) => b.ageMs - a.ageMs || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const outboxCounts = {};
  for (const entry of outboxEntries) {
    outboxCounts[entry.state] = (outboxCounts[entry.state] || 0) + 1;
  }
  return {
    generatedAt: now,
    taskCounts: counts,
    totalTasks: allTasks.length,
    oldest,
    oldestAgeMs,
    escalations,
    outboxCounts,
  };
}

export function exportReceipt(task) {
  if (!task) throw new Error("exportReceipt requires a task");
  // TBP3-008: free-form goal text never leaves in a receipt. The digest
  // identifies the goal without exposing its content; scope stays as the
  // trusted display label.
  const goalDigest = createHash("sha256").update(String(task.goal ?? ""), "utf8").digest("hex");
  return stableStringify({
    id: task.id,
    goalDigest,
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
