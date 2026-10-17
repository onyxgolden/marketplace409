/** resolver.test.js — budget and SourceRef resolution tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeBudget, BudgetError, resolveSourceRef, hasReadGrant, verifySpan, ResolutionError, BUDGET_LIMITS } from "../src/resolver.js";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

test("makeBudget: object cap refuses at 65", () => {
  const b = makeBudget();
  for (let i = 0; i < 64; i++) b.countObject(`o${i}`);
  assert.throws(() => b.countObject("o64"), (e) => e instanceof BudgetError && e.code === "BUDGET_EXCEEDED");
});

test("makeBudget: payload cap refuses over 256 KiB", () => {
  const b = makeBudget();
  assert.throws(() => b.countPayload("x".repeat(262145), "big"), (e) => e instanceof BudgetError && e.code === "INPUT_LIMIT");
});

test("makeBudget: span cap refuses at 513", () => {
  const b = makeBudget();
  for (let i = 0; i < 512; i++) b.countSpan(`s${i}`);
  assert.throws(() => b.countSpan("s512"), BudgetError);
});

test("resolveSourceRef: resolves and verifies blob", () => {
  const ref = store.bundleRefs["single-income"];
  const key = `${ref.repo}|${ref.path}`;
  const sources = { [key]: store.sources[key] };
  const r = resolveSourceRef(ref, sources, makeBudget(), "test");
  assert.ok(r.text.includes("txn-inc-1"));
});

test("resolveSourceRef: refuses on hash mismatch", () => {
  const ref = { ...store.bundleRefs["single-income"], blob: "0".repeat(40) };
  const key = `${ref.repo}|${ref.path}`;
  const sources = { [key]: store.sources[key] };
  assert.throws(() => resolveSourceRef(ref, sources, makeBudget(), "test"),
    (e) => e instanceof ResolutionError && e.code === "HASH_MISMATCH");
});

test("resolveSourceRef: refuses unregistered source", () => {
  const ref = store.bundleRefs["single-income"];
  assert.throws(() => resolveSourceRef(ref, {}, makeBudget(), "test"),
    (e) => e instanceof ResolutionError && e.code === "SOURCE_UNVERIFIED");
});

test("hasReadGrant: exact match only", () => {
  const grants = [{ repo: "fin-sources", path: "chart/finance-chart-v1.md" }];
  assert.ok(hasReadGrant({ repo: "fin-sources", path: "chart/finance-chart-v1.md" }, grants));
  assert.ok(!hasReadGrant({ repo: "fin-sources", path: "chart/other.md" }, grants));
  assert.ok(!hasReadGrant({ repo: "fin-sources", path: "chart" }, grants)); // no prefix grants
});

test("verifySpan: finds exact bytes", () => {
  const bytes = Buffer.from("hello world", "utf8");
  const s = verifySpan(bytes, "world", makeBudget(), "t");
  assert.equal(s.start_byte, 6);
  assert.equal(s.end_byte, 11);
});

test("verifySpan: rejects missing span", () => {
  const bytes = Buffer.from("hello world", "utf8");
  assert.throws(() => verifySpan(bytes, "xyz", makeBudget(), "t"), ResolutionError);
});

test("verifySpan: rejects UTF-8 split", () => {
  // "é" is 2 bytes in UTF-8; a span covering only the first byte must fail.
  const bytes = Buffer.from("café", "utf8");
  const bad = bytes.subarray(3, 4).toString("utf8"); // lone continuation byte -> replacement char
  // Direct byte search for the partial sequence:
  const needle = Buffer.from([0xc3]); // first byte of é
  const start = bytes.indexOf(needle);
  assert.equal(start, 3);
  // verifySpan with a quoted string that isn't exactly present refuses:
  assert.throws(() => verifySpan(bytes, "\uFFFD", makeBudget(), "t"), ResolutionError);
});

test("BUDGET_LIMITS: matches common contract", () => {
  assert.equal(BUDGET_LIMITS.maxObjects, 64);
  assert.equal(BUDGET_LIMITS.maxSpans, 512);
  assert.equal(BUDGET_LIMITS.maxPayloadBytes, 262144);
  assert.equal(BUDGET_LIMITS.maxOutputRecords, 256);
  assert.equal(BUDGET_LIMITS.maxOutputBytes, 262144);
});
