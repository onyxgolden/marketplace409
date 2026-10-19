/** resolver.test.js — budget primitives and source resolution. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBudget, BudgetError, resolveSourceRef, hasReadGrant, ResolutionError } from "../src/resolver.js";
import { gitBlobId } from "../src/canonical.js";

function pin(text) {
  const commit = "a".repeat(40);
  const blob = gitBlobId(Buffer.from(text, "utf8"));
  return {
    ref: { repo: "sched-sources", path: "networks/x.json", commit, blob, algorithm: "git-sha1", revision: "v1" },
    sources: { "sched-sources|networks/x.json": { revisions: { [commit]: { text, blob } } } },
  };
}

test("budget refuses the 65th object", () => {
  const b = makeBudget();
  for (let i = 0; i < 64; i++) b.countObject(`o${i}`);
  assert.throws(() => b.countObject("o64"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("budget refuses the 513th span", () => {
  const b = makeBudget();
  for (let i = 0; i < 512; i++) b.countSpan(`s${i}`);
  assert.throws(() => b.countSpan("s512"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("budget refuses oversize payload", () => {
  const b = makeBudget();
  assert.throws(() => b.countPayload("x".repeat(262145), "big"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("resolveSourceRef verifies blob and returns bytes", () => {
  const { ref, sources } = pin(`[{"record":"activity"}]`);
  const r = resolveSourceRef(ref, sources, makeBudget(), "t");
  assert.equal(r.text, `[{"record":"activity"}]`);
});

test("resolveSourceRef rejects hash mismatch", () => {
  const { ref, sources } = pin(`[{"record":"activity"}]`);
  const bad = { ...ref, blob: "0".repeat(40) };
  assert.throws(() => resolveSourceRef(bad, sources, makeBudget(), "t"), (e) => e instanceof ResolutionError && e.code === "HASH_MISMATCH");
});

test("resolveSourceRef rejects unregistered commit", () => {
  const { ref, sources } = pin(`[]`);
  const bad = { ...ref, commit: "1".repeat(40) };
  assert.throws(() => resolveSourceRef(bad, sources, makeBudget(), "t"), (e) => e instanceof ResolutionError && e.code === "SOURCE_UNVERIFIED");
});

test("hasReadGrant is exact repo+path", () => {
  const ref = { repo: "sched-sources", path: "networks/x.json" };
  assert.equal(hasReadGrant(ref, [{ repo: "sched-sources", path: "networks/x.json" }]), true);
  assert.equal(hasReadGrant(ref, [{ repo: "sched-sources", path: "networks/" }]), false);
  assert.equal(hasReadGrant(ref, []), false);
});

// ---- S648-002: runtime span verification (verifyRecordSpan) ----
// verifyRecordSpan is exported from src/index.js (runtime entrypoint).
import { verifyRecordSpan } from "../src/index.js";

test("verifyRecordSpan verifies exact UTF-8 byte ranges", () => {
  const text = `[{"n":"é"},{"n":"x"}]`; // é = 2 bytes; total 22 bytes
  const bytes = Buffer.from(text, "utf8");
  const b = makeBudget();
  const r0 = verifyRecordSpan(bytes, 1, 11, `{"n":"é"}`, b, "r0");
  assert.equal(r0.start_byte, 1);
  assert.equal(r0.end_byte, 11);
  assert.equal(r0.quoted_text, `{"n":"é"}`);
  // Second record starts right after the comma at byte 11.
  const r1 = verifyRecordSpan(bytes, 12, 21, `{"n":"x"}`, b, "r1");
  assert.equal(r1.quoted_text, `{"n":"x"}`);
});

test("verifyRecordSpan refuses at the 513th span (runtime, not just primitive)", () => {
  const bytes = Buffer.from(`[1]`, "utf8");
  const b = makeBudget();
  for (let i = 0; i < 512; i++) verifyRecordSpan(bytes, 1, 2, `1`, b, `s${i}`);
  assert.throws(
    () => verifyRecordSpan(bytes, 1, 2, `1`, b, "s512"),
    (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED"
  );
});

test("verifyRecordSpan later spans untouched after 513th refusal", () => {
  const bytes = Buffer.from(`[1,2]`, "utf8");
  const b = makeBudget();
  for (let i = 0; i < 512; i++) verifyRecordSpan(bytes, 1, 2, `1`, b, `s${i}`);
  // 513rd refuses...
  assert.throws(() => verifyRecordSpan(bytes, 1, 2, `1`, b, "s512"), BudgetError);
  // ...and a sentinel proves no further span was checked: if the 514th
  // were attempted, countSpan would throw BUDGET_EXCEEDED, not reach the
  // byte-range check. We verify the budget state directly.
  assert.equal(b.used.spans, 513);
});

test("verifyRecordSpan throws SPAN_MISMATCH on tampered bytes", () => {
  const bytes = Buffer.from(`[{"n":"x"}]`, "utf8");
  const b = makeBudget();
  assert.throws(
    () => verifyRecordSpan(bytes, 1, 10, `{"n":"y"}`, b, "tampered"),
    (e) => e instanceof ResolutionError && e.code === "SPAN_MISMATCH"
  );
});

test("verifyRecordSpan throws SPAN_MISMATCH on out-of-range bytes", () => {
  const bytes = Buffer.from(`[1]`, "utf8");
  const b = makeBudget();
  assert.throws(
    () => verifyRecordSpan(bytes, 0, 100, `1`, b, "oor"),
    (e) => e instanceof ResolutionError && e.code === "SPAN_MISMATCH"
  );
});
