/** canonical.test.js — date utilities, canonical JSON, hashes. */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson, canonicalByteLength, sha256HexUtf8, gitBlobId,
  dayNumberOf, civilOfDayNumber, isoWeekdayOf, isRealDate,
} from "../src/canonical.js";

test("day number round-trips civil dates", () => {
  for (const d of ["2026-01-05", "2028-02-29", "2026-12-31", "2000-02-29"]) {
    assert.equal(civilOfDayNumber(dayNumberOf(d)), d);
  }
});

test("ISO weekdays: 2026-01-05 is Monday, 2028-02-25 is Friday", () => {
  assert.equal(isoWeekdayOf("2026-01-05"), 1);
  assert.equal(isoWeekdayOf("2028-02-25"), 5);
  assert.equal(isoWeekdayOf("2026-01-11"), 7); // Sunday
});

test("isRealDate rejects impossible dates", () => {
  assert.equal(isRealDate("2026-02-30"), false);
  assert.equal(isRealDate("2026-13-01"), false);
  assert.equal(isRealDate("2028-02-29"), true); // leap year
  assert.equal(isRealDate("2026-02-29"), false);
  assert.equal(isRealDate("not-a-date"), false);
});

test("canonicalJson is key-order stable", () => {
  assert.equal(canonicalJson({ b: 1, a: 2 }), canonicalJson({ a: 2, b: 1 }));
  assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
});

test("canonicalJson rejects nonfinite numbers", () => {
  assert.throws(() => canonicalJson(NaN), /nonfinite/);
  assert.throws(() => canonicalJson(Infinity), /nonfinite/);
});

test("sha256 and git blob ids are well-formed", () => {
  assert.match(sha256HexUtf8("abc"), /^[0-9a-f]{64}$/);
  assert.match(gitBlobId(Buffer.from("abc", "utf8")), /^[0-9a-f]{40}$/);
  // git blob id includes the header: differs from plain sha1; verified against `git hash-object`
  assert.equal(gitBlobId(Buffer.from("abc", "utf8")), "f2ba8f84ab5c1bce84a7b441cb1959cfc7093b7f");
});

test("canonicalByteLength counts UTF-8 bytes", () => {
  assert.equal(canonicalByteLength("é"), 4); // JSON-quoted "é" = quote + 2 bytes + quote
});
