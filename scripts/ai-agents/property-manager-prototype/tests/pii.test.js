/**
 * pii.test.js — zero PII-canary output gate.
 *
 * Fixtures carry invented SYN-* IDs only: the store's note texts must not
 * contain emails, phone numbers, SSNs, or street addresses. Identifier and
 * canary probes refuse without echoing the payload anywhere in the result.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { run, canonicalJson } from "../src/index.js";
import { loadStore, baseContext, taskFor } from "./testutil.js";

const store = loadStore();

const REAL_PATTERNS = [
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /(\+?1[-.\s]?)?(\(?\d{3}\)?[-.\s]?)\d{3}[-.\s]?\d{4}/,
  /\b\d{3}-\d{2}-\d{4}\b/,
  /\b\d{1,5}\s+[A-Z][a-zA-Z]+\s+(St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Ct|Court|Way|Pl|Place)\b/,
  /CANARY_[A-Z0-9_]+/,
];

test("fixture note texts contain no real identifiers or canaries", () => {
  const hits = [];
  for (const [id, text] of Object.entries(store.note_texts)) {
    for (const p of REAL_PATTERNS) {
      if (p.test(text)) hits.push(`${id}: ${p}`);
    }
  }
  assert.deepEqual(hits, []);
});

test("fixture case summaries and action texts contain no real identifiers", () => {
  const hits = [];
  for (const c of store.cases) {
    const texts = [c.summary, ...(c.actions ?? []).map((a) => a.text)];
    for (const t of texts) {
      for (const p of REAL_PATTERNS) {
        if (p.test(t)) hits.push(`${c.case_id}: ${p}`);
      }
    }
  }
  assert.deepEqual(hits, []);
});

const PROBES = [
  "Contact ops@example.com for the vendor list.",
  "Call 555-013-4471 to confirm the window.",
  "Reference CANARY_SSN_078-05-1120 on the ledger.",
  "Inspect the unit at 1420 Harbor Blvd tomorrow.",
];

for (const [i, note] of PROBES.entries()) {
  test(`identifier probe ${i + 1} refuses with zero payload echo`, () => {
    const r = run(taskFor(store, "SYN-CASE-001", { note }), baseContext());
    assert.equal(r.status, "REFUSED");
    const out = canonicalJson(r);
    for (const p of REAL_PATTERNS) {
      assert.ok(!p.test(out), `output matches ${p}`);
    }
    assert.ok(!out.includes(note));
  });
}
