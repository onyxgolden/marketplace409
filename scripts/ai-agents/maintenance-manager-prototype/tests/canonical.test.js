import { test } from "node:test";
import assert from "node:assert/strict";
import { gitBlobId, canonicalJson, rational, rToFixed, rToPercentFixed, dayIndexOfMs, detached } from "../src/canonical.js";

test("gitBlobId matches a known git hash-object value for empty content", () => {
  // `git hash-object` of an empty file is this well-known constant.
  assert.equal(gitBlobId(Buffer.from("", "utf8")), "e69de29bb2d1d6434b8b29ae775ad8c2e48c5391");
});

test("canonicalJson sorts object keys regardless of insertion order", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
});

test("rational reduces to lowest terms and normalizes sign to the numerator", () => {
  const r = rational(-4, -8);
  assert.equal(r.num, 1n);
  assert.equal(r.den, 2n);
});

test("rational throws on a zero denominator", () => {
  assert.throws(() => rational(1, 0), RangeError);
});

test("rToFixed rounds half-away-from-zero at the exact midpoint", () => {
  assert.equal(rToFixed(rational(5, 2), 0), "3"); // 2.5 -> 3, not banker's-rounds-to-2
  assert.equal(rToFixed(rational(-5, 2), 0), "-3");
});

test("rToPercentFixed computes an exact percentage display", () => {
  assert.equal(rToPercentFixed(rational(1, 3), 2), "33.33");
});

test("dayIndexOfMs is stable across a UTC day boundary", () => {
  const d0 = dayIndexOfMs(Date.parse("2026-06-01T00:00:00Z"));
  const d1 = dayIndexOfMs(Date.parse("2026-06-01T23:59:59Z"));
  const d2 = dayIndexOfMs(Date.parse("2026-06-02T00:00:00Z"));
  assert.equal(d0, d1);
  assert.equal(d2, d0 + 1);
});

test("detached returns a deep, mutation-isolated clone", () => {
  const original = { a: [1, 2, { b: 3 }] };
  const clone = detached(original);
  clone.a[2].b = 999;
  assert.equal(original.a[2].b, 3);
});
