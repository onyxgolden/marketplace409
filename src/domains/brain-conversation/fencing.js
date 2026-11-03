// FORGE Brain conversation harness — model-payload fencing (A5).
//
// There is NO model client in this build: the chat route never calls a model,
// and no harness module imports a model SDK (pinned by the fencing test's
// source scan). This module is the guard any future model adapter must pass
// through — and that adapter needs its own separate authorization before it
// may send anything anywhere.
//
// Fence rules:
// - An entry explicitly tagged with tenant, financial, ledger, or scheduling
//   sensitivity is refused outright.
// - An entry carrying resolved record details (as opposed to a pointer) is
//   refused: memory stores pointers (Q5), never resolved tenant details, and
//   the payload builder must never re-resolve them into a payload.
// - Pointer-only entries pass through as { type, id } and nothing more.

export const SENSITIVE_KINDS = Object.freeze([
  "tenant",
  "financial",
  "ledger",
  "scheduling",
]);

export function assertModelPayloadSafe(entries) {
  for (const entry of entries ?? []) {
    if (!entry) continue;
    if (SENSITIVE_KINDS.includes(entry.sensitivity)) {
      throw new Error(
        "Refusing model payload: an entry carries sensitive content.",
      );
    }
    if (entry.recordDetails !== undefined && entry.recordDetails !== null) {
      throw new Error(
        "Refusing model payload: resolved record details must never enter a model payload; pointers only.",
      );
    }
  }
}

export function buildModelPayload(workingSet) {
  assertModelPayloadSafe(workingSet);
  return (workingSet ?? []).map((entry) => ({
    kind: "memory",
    text: entry.content ?? entry.text ?? "",
    salience: entry.salience ?? null,
    provenance: entry.provenanceSource ?? null,
    pointer:
      entry.recordType && entry.recordId
        ? { type: entry.recordType, id: entry.recordId }
        : null,
  }));
}
