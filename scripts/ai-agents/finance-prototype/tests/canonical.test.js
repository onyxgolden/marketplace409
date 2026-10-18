/** canonical.test.js — BigInt minor-unit arithmetic, rationals, rounding. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseDecimalToRational, parseMinorUnits, roundHalfAway,
  lineExtensionMinor, lineTaxMinor, formatMinor, canonicalJson, sha256HexUtf8,
} from "../src/canonical.js";

test("parseDecimalToRational: basic", () => {
  assert.deepEqual(parseDecimalToRational("2", "t"), { num: 2n, den: 1n });
  assert.deepEqual(parseDecimalToRational("0.0825", "t"), { num: 825n, den: 10000n });
  assert.deepEqual(parseDecimalToRational("-3.5", "t"), { num: -35n, den: 10n });
});

test("parseDecimalToRational: rejects >6 decimals", () => {
  assert.throws(() => parseDecimalToRational("1.1234567", "t"), /max 6 decimal/);
});

test("parseDecimalToRational: rejects >1e18 numerator", () => {
  assert.throws(() => parseDecimalToRational("10000000000000000000", "t"), /exceeds 10\^18/);
});

test("parseMinorUnits: signed integers", () => {
  assert.equal(parseMinorUnits("10000", "t"), 10000n);
  assert.equal(parseMinorUnits("-3000", "t"), -3000n);
  assert.throws(() => parseMinorUnits("10.5", "t"), /malformed integer/);
  assert.throws(() => parseMinorUnits("1e5", "t"), /malformed integer/);
});

test("roundHalfAway: ties go away from zero", () => {
  assert.equal(roundHalfAway(1n, 2n), 1n); // 0.5 -> 1
  assert.equal(roundHalfAway(-1n, 2n), -1n); // -0.5 -> -1
  assert.equal(roundHalfAway(3n, 2n), 2n); // 1.5 -> 2
  assert.equal(roundHalfAway(-3n, 2n), -2n); // -1.5 -> -2
  assert.equal(roundHalfAway(1n, 4n), 0n); // 0.25 -> 0
  assert.equal(roundHalfAway(3n, 4n), 1n); // 0.75 -> 1
});

test("lineExtensionMinor: 2 x 1000 = 2000", () => {
  const q = parseDecimalToRational("2", "t");
  assert.equal(lineExtensionMinor(q, 1000n), 2000n);
});

test("lineTaxMinor: 2000 x 0.0825 = 165", () => {
  const r = parseDecimalToRational("0.0825", "t");
  assert.equal(lineTaxMinor(2000n, r), 165n);
});

test("lineTaxMinor: half-cent tie rounds up", () => {
  const r = parseDecimalToRational("0.005", "t");
  assert.equal(lineTaxMinor(100n, r), 1n); // 0.5 -> 1
});

test("formatMinor: scale 2", () => {
  assert.equal(formatMinor(12345n, 2), "123.45");
  assert.equal(formatMinor(-5n, 2), "-0.05");
  assert.equal(formatMinor(0n, 2), "0.00");
});

test("canonicalJson: BigInt encoding is stable", () => {
  const a = canonicalJson({ b: 2n, a: 1n });
  const b = canonicalJson({ a: 1n, b: 2n });
  assert.equal(a, b);
  assert.ok(a.includes("$bigint"));
});

test("sha256HexUtf8: deterministic", () => {
  assert.equal(sha256HexUtf8("x"), sha256HexUtf8("x"));
  assert.equal(sha256HexUtf8("x").length, 64);
});
