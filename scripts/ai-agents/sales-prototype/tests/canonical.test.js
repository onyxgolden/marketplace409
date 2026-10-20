/**
 * canonical.test.js — canonical JSON, hashes, dates.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canonicalJson, canonicalByteLength, sha256HexUtf8, gitBlobId,
  isRealDate, isRealInstant, HEX40,
} from "../src/canonical.js";

describe("canonicalJson", () => {
  it("sorts keys stably", () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), `{"a":2,"b":1}`);
  });
  it("handles nested structures", () => {
    assert.equal(canonicalJson({ z: [3, 2], a: { d: 1, c: 2 } }), `{"a":{"c":2,"d":1},"z":[3,2]}`);
  });
  it("encodes bigint safely", () => {
    assert.equal(canonicalJson(10n), `{"$bigint":"10"}`);
  });
  it("rejects non-finite numbers", () => {
    assert.throws(() => canonicalJson(NaN), Error);
  });
  it("rejects uncodable types", () => {
    assert.throws(() => canonicalJson(() => 1), Error);
  });
});

describe("hashes", () => {
  it("sha256HexUtf8 is stable", () => {
    assert.equal(sha256HexUtf8("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("gitBlobId matches git semantics", () => {
    // Verified against `printf 'hello' | git hash-object --stdin`.
    assert.equal(gitBlobId(Buffer.from("hello", "utf8")), "b6fc4c620b67d95f953a5c1c1230aaab5db5a1b0");
  });
  it("HEX40 validates", () => {
    assert.ok(HEX40.test("a".repeat(40)));
    assert.ok(!HEX40.test("A".repeat(40)));
    assert.ok(!HEX40.test("a".repeat(39)));
  });
});

describe("dates", () => {
  it("isRealDate accepts real dates, rejects impossible ones", () => {
    assert.equal(isRealDate("2026-02-28"), true);
    assert.equal(isRealDate("2026-02-30"), false);
    assert.equal(isRealDate("2026-13-01"), false);
    assert.equal(isRealDate("not-a-date"), false);
  });
  it("isRealInstant validates exactly", () => {
    assert.equal(isRealInstant("2026-10-19T12:00:00Z"), true);
    assert.equal(isRealInstant("2026-10-19T25:00:00Z"), false);
    assert.equal(isRealInstant("2026-10-19"), false);
  });
  it("canonicalByteLength counts UTF-8 bytes of the canonical form", () => {
    // canonicalJson("é") is `"é"` with quotes: 1 + 2 + 1 = 4 bytes.
    assert.equal(canonicalByteLength("é"), 4);
  });
});
