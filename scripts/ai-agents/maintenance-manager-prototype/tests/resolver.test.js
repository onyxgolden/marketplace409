import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBudget, resolveSourceRef, verifySpanBounds, hasReadGrant, BudgetError, ResolutionError, BUDGET_LIMITS } from "../src/resolver.js";
import { gitBlobId } from "../src/canonical.js";

function sourcesFor(text) {
  const blob = gitBlobId(Buffer.from(text, "utf8"));
  const commit = "a".repeat(40);
  return { sources: { "maint-sources|content/x.txt": { revisions: { [commit]: { text, blob } } } }, ref: { repo: "maint-sources", path: "content/x.txt", commit, blob, algorithm: "git-sha1", revision: "v1" } };
}

test("resolveSourceRef recomputes the Git blob id and never trusts the caller's own pinned value", () => {
  const { sources, ref } = sourcesFor("hello world\n");
  const budget = makeBudget();
  const resolved = resolveSourceRef(ref, sources, budget, "x");
  assert.equal(resolved.text, "hello world\n");
});

test("resolveSourceRef throws HASH_MISMATCH when the registered bytes don't match the pinned blob", () => {
  const { sources, ref } = sourcesFor("hello world\n");
  const key = "maint-sources|content/x.txt";
  sources[key].revisions[ref.commit].text = "tampered\n"; // blob field left stale/unchanged — the hash check never reads it anyway
  const budget = makeBudget();
  assert.throws(() => resolveSourceRef(ref, sources, budget, "x"), (e) => e instanceof ResolutionError && e.code === "HASH_MISMATCH");
});

test("resolveSourceRef throws SOURCE_UNVERIFIED for an unregistered source key", () => {
  const { ref } = sourcesFor("hello world\n");
  const budget = makeBudget();
  assert.throws(() => resolveSourceRef(ref, {}, budget, "x"), (e) => e instanceof ResolutionError && e.code === "SOURCE_UNVERIFIED");
});

test("hasReadGrant requires an exact repo+path match, not a prefix", () => {
  const grants = [{ repo: "maint-sources", path: "content/x.txt" }];
  assert.equal(hasReadGrant({ repo: "maint-sources", path: "content/x.txt" }, grants), true);
  assert.equal(hasReadGrant({ repo: "maint-sources", path: "content/x.txt.evil" }, grants), false);
  assert.equal(hasReadGrant({ repo: "maint-sources", path: "content/" }, grants), false);
});

test("verifySpanBounds refuses a span past the end of the resolved content", () => {
  const bytes = Buffer.from("short", "utf8");
  const budget = makeBudget();
  assert.throws(() => verifySpanBounds(bytes, { start_byte: 0, end_byte: 999 }, budget, "x"), (e) => e instanceof ResolutionError && e.code === "SPAN_MISMATCH");
});

test("verifySpanBounds indexes by UTF-8 BYTE offset, not character count, across a multi-byte code point", () => {
  // "a€b" is bytes [0x61, 0xE2,0x82,0xAC, 0x62] = 5 bytes, 3 characters.
  // Byte span [1,4) is exactly the 3-byte euro sign.
  const text = "a€b";
  const bytes = Buffer.from(text, "utf8");
  assert.equal(bytes.length, 5);
  const budget = makeBudget();
  const r = verifySpanBounds(bytes, { start_byte: 1, end_byte: 4 }, budget, "x");
  assert.equal(r.quoted_text, "€");
});

test("makeBudget: object/payload/span charges are each independently monotonic and fail-closed", () => {
  const budget = makeBudget();
  for (let i = 0; i < BUDGET_LIMITS.maxObjects; i++) budget.countObject(`o${i}`);
  assert.throws(() => budget.countObject("one-too-many"), BudgetError);

  const b2 = makeBudget();
  assert.throws(() => b2.countPayload("x".repeat(BUDGET_LIMITS.maxPayloadBytes + 1), "p"), BudgetError);

  const b3 = makeBudget();
  for (let i = 0; i < BUDGET_LIMITS.maxSpans; i++) b3.countSpan(`s${i}`);
  assert.throws(() => b3.countSpan("one-too-many"), BudgetError);
});
