/**
 * citations.test.js — PM-001 regression: citations must quote exact
 * registered source bytes with verified byte spans, never constructed
 * sentences or hard-coded byte counts.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run, utf8ByteSlice, canonicalJson } from "../src/index.js";
import { loadStore, baseContext, taskFor } from "./testutil.js";
import { gitBlobId } from "../src/canonical.js";

const gitBlob = (s) => gitBlobId(Buffer.from(s, "utf8"));

test("utf8ByteSlice never splits a character", () => {
  // "é" is 2 bytes, "€" is 3 bytes in UTF-8.
  assert.equal(utf8ByteSlice("abcdef", 4), "abcd");
  assert.equal(utf8ByteSlice("aébc", 2), "a"); // cut would split é
  assert.equal(utf8ByteSlice("aébc", 3), "aé");
  assert.equal(utf8ByteSlice("€100", 3), "€");
  assert.equal(utf8ByteSlice("€100", 2), "");
  assert.equal(utf8ByteSlice("plain", 100), "plain");
  assert.equal(utf8ByteSlice("", 10), "");
  // 4-byte emoji (surrogate pair in UTF-16).
  assert.equal(utf8ByteSlice("a🧰b", 4), "a");
  assert.equal(utf8ByteSlice("a🧰b", 5), "a🧰");
});

test("utf8ByteSlice output round-trips to a byte prefix of the source", () => {
  const samples = [
    "Café façade — naïve résumé: ¾″ pipe, 20°C ambient.",
    "日本語テスト mixed with ASCII 123",
    "🧰🔧 emoji lead text",
    "a".repeat(200),
  ];
  for (const s of samples) {
    for (const max of [0, 1, 2, 3, 5, 40, 120, 1000]) {
      const q = utf8ByteSlice(s, max);
      const src = Buffer.from(s, "utf8");
      const qb = Buffer.from(q, "utf8");
      assert.ok(qb.length <= max, `slice exceeds ${max} bytes for ${JSON.stringify(s)}`);
      assert.ok(src.subarray(0, qb.length).equals(qb), "slice is not an exact byte prefix");
      // Decodes cleanly — no replacement characters from a split.
      assert.ok(!q.includes("\uFFFD"), "slice contains a split character");
    }
  }
});

test("permission citation quotes exact record bytes (PM-001)", () => {
  const store = loadStore();
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.equal(r.status, "PROPOSED");
  for (const rec of r.recommendations) {
    for (const ev of rec.permission_check.evidence) {
      // No fabricated sentence: the quoted span is the full canonical record.
      assert.ok(!ev.quoted_span.startsWith("permission "), "fabricated citation sentence");
      const pid = ev.path.split("/")[1].replace(".json", "");
      const record = store.permission_records.find((x) => x.permission_id === pid);
      const exact = canonicalJson(record);
      assert.equal(ev.quoted_span, exact, "quoted span must be the exact record bytes");
      assert.equal(ev.span.start_byte, 0);
      assert.equal(ev.span.end_byte, Buffer.byteLength(exact, "utf8"));
      assert.equal(ev.span.quoted_text, exact);
      assert.equal(ev.blob, gitBlob(exact), "blob must be recomputed from exact bytes");
      assert.equal(ev.verification, "VERIFIED");
    }
  }
});

test("permission citations vary with action length (no hard-coded span)", () => {
  const store = loadStore();
  const spans = new Set();
  for (const caseId of ["SYN-CASE-001", "SYN-CASE-005", "SYN-CASE-010"]) {
    const r = run(taskFor(store, caseId), baseContext());
    for (const rec of r.recommendations) {
      for (const ev of rec.permission_check.evidence) spans.add(ev.span.end_byte);
    }
  }
  assert.ok(spans.size > 1, "all citation spans identical — hard-coded byte count suspected");
});

test("note citation with non-ASCII round-trips exactly (PM-001)", () => {
  const store = loadStore();
  // SYN-CASE-001 carries the non-ASCII fixture note.
  const r = run(taskFor(store, "SYN-CASE-001"), baseContext());
  assert.equal(r.status, "PROPOSED");
  const seen = [];
  for (const rec of r.recommendations) {
    for (const ev of rec.basis ?? []) {
      const noteId = ev.path.split("/")[1].replace(".md", "");
      const text = store.note_texts[noteId];
      const qb = Buffer.from(ev.quoted_span, "utf8");
      assert.ok(qb.length <= 120, "quoted span exceeds 120 bytes");
      assert.ok(Buffer.from(text, "utf8").subarray(0, qb.length).equals(qb), "quoted span is not an exact byte prefix");
      assert.equal(ev.span.start_byte, 0);
      assert.equal(ev.span.end_byte, qb.length);
      assert.equal(ev.blob, gitBlob(text));
      seen.push(ev.quoted_span);
    }
  }
  assert.ok(seen.some((q) => q.includes("Café")), "expected the non-ASCII fixture note to be cited");
});
