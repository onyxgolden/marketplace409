/**
 * rational.test.js — exact rational arithmetic and display rounding.
 * No binary floats: every expectation is hand-derived.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rat, ratEq, ratCmp, parseDecimal, formatFixed, formatPercent, formatRoas, exactString } from "../src/rational.js";

describe("rat", () => {
  it("reduces and normalizes sign", () => {
    assert.deepEqual(rat(50, 1000), { n: 1n, d: 20n });
    assert.deepEqual(rat(-4, -8), { n: 1n, d: 2n });
    assert.deepEqual(rat(3, -9), { n: -1n, d: 3n });
    assert.deepEqual(rat(0, 7), { n: 0n, d: 1n });
  });
  it("rejects zero denominator", () => {
    assert.throws(() => rat(1, 0), RangeError);
  });
  it("equality and comparison are exact", () => {
    assert.ok(ratEq(rat(1, 3), rat(2, 6)));
    assert.ok(!ratEq(rat(1, 3), rat(1, 4)));
    assert.equal(ratCmp(rat(1, 3), rat(1, 2)), -1);
    assert.equal(ratCmp(rat(2, 2), rat(1, 1)), 0);
    assert.equal(ratCmp(rat(3, 2), rat(1, 1)), 1);
  });
});

describe("parseDecimal", () => {
  it("parses exact decimals", () => {
    assert.deepEqual(parseDecimal("5.00"), { n: 5n, d: 1n });
    assert.deepEqual(parseDecimal("0.05"), { n: 1n, d: 20n });
    assert.deepEqual(parseDecimal("2.0000"), { n: 2n, d: 1n });
  });
  it("parses percents as hundredths", () => {
    assert.deepEqual(parseDecimal("5.00%"), { n: 1n, d: 20n });
    assert.deepEqual(parseDecimal("100%"), { n: 1n, d: 1n });
  });
  it("rejects non-decimals", () => {
    assert.equal(parseDecimal("abc"), null);
    assert.equal(parseDecimal("1/2"), null);
    assert.equal(parseDecimal(""), null);
    assert.equal(parseDecimal("1e5"), null);
  });
});

describe("display rounding (half away from zero)", () => {
  it("percentages to 2 decimals", () => {
    assert.equal(formatPercent(rat(1, 20)), "5.00%");
    assert.equal(formatPercent(rat(1, 6)), "16.67%"); // 16.666..% rounds up
    assert.equal(formatPercent(rat(1, 8)), "12.50%");
    assert.equal(formatPercent(rat(1, 200)), "0.50%");
  });
  it("half-away-from-zero, not banker's", () => {
    // 2.125% exactly: banker's would give 2.12%, half-away gives 2.13%.
    assert.equal(formatPercent(rat(17, 800)), "2.13%");
    // 0.125% -> 0.13% (away from zero), never 0.12%.
    assert.equal(formatPercent(rat(1, 800)), "0.13%");
  });
  it("ROAS to 4 decimals", () => {
    assert.equal(formatRoas(rat(200005, 100000)), "2.0001"); // 2.00005 exactly
    assert.equal(formatRoas(rat(2, 1)), "2.0000");
    assert.equal(formatRoas(rat(4, 9)), "0.4444"); // 0.4444|4...
    assert.equal(formatRoas(rat(1, 3)), "0.3333");
  });
  it("formatFixed zero decimals", () => {
    assert.equal(formatFixed(rat(5, 2), 0), "3"); // 2.5 away from zero
    assert.equal(formatFixed(rat(7, 2), 0), "4");
  });
  it("exactString preserves the reduced fraction", () => {
    assert.equal(exactString(rat(50, 1000)), "1/20");
  });
});
