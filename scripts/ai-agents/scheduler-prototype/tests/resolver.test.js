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
