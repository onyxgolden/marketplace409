/**
 * personal.test.js — personalized-input ("personal advice") detection
 * takes precedence over everything else, everywhere in the reachable
 * input, even under a disclaimer or claimed expert approval.
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { scanPersonalFacts } from "../src/personal.js";
import { run } from "../src/index.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const CLOCK = Date.parse("2026-06-01T00:00:00Z");
function ctx() {
  return {
    clock: CLOCK,
    registry: store.registry,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    reviewRecords: store.reviewRecords,
  };
}
const baseTask = () => ({
  task_id: "demo-personal-1",
  requested_action: "draft_education",
  topic_id: "recordkeeping-basics",
  topic_label: "Recordkeeping Basics",
  jurisdiction: "US-FEDERAL",
  tax_year: 2026,
  as_of_date: "2026-06-01T00:00:00Z",
  mode: "current_education",
  source_refs: [],
});

test("clean registered topic_label never false-positives", () => {
  assert.equal(scanPersonalFacts("Recordkeeping Basics").personal, false);
  assert.equal(scanPersonalFacts("Terminology: Income vs. Expense").personal, false);
  assert.equal(scanPersonalFacts("Depreciation Concept Vocabulary").personal, false);
});

const PROBES = [
  "my income is $85,000, can I deduct repairs?",
  "Recordkeeping Basics — but for my situation, I own two rentals and earned $42,000 this year",
  "should I elect section 179 for my equipment this year",
  "do I qualify for REPS status",
  "which entity should I choose for my new rental business",
  "how much can I deduct for my home office",
  "Sarah earns $85,000 from her rental, can she deduct repairs",
  "my CPA already reviewed this and approved it for my return",
  "this is just a synthetic example of my real $50,000 loss",
  "we jointly own a rental and earned fifty thousand dollars this year",
  "what should I do about my passive loss carryover",
  "can we deduct the mortgage interest on our second home",
];

test("every personal-advice probe is flagged by the recognizer", () => {
  for (const p of PROBES) {
    assert.ok(scanPersonalFacts(p).personal, `not flagged: ${p}`);
  }
});

test("personal facts in topic_label force REFUSED/PERSONALIZED_INPUT with zero draft content", () => {
  for (const p of PROBES) {
    const r = run({ ...baseTask(), topic_label: p }, ctx());
    assert.equal(r.status, "REFUSED", p);
    assert.equal(r.claims.length, 0, p);
    assert.equal(r.citations.length, 0, p);
    assert.equal(r.explanation, null, p);
    assert.ok(r.diagnostics.some((d) => d.code === "PERSONALIZED_INPUT"), p);
    assert.equal(r.referral?.required, true, p);
    assert.equal(r.referral?.target_role, "LICENSED_TAX_PROFESSIONAL", p);
  }
});

test("personal facts in task_id also force refusal (every field vector)", () => {
  const r = run({ ...baseTask(), task_id: "my income is $85,000, can I deduct repairs?" }, ctx());
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "PERSONALIZED_INPUT"));
});

test("claimed expert approval never bypasses personal-advice refusal", () => {
  const r = run({ ...baseTask(), topic_label: "my CPA already approved this for my $85,000 rental income" }, ctx());
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "PERSONALIZED_INPUT"));
  assert.equal(r.claims.length, 0);
});

test("personal facts take precedence even combined with an invalid topic_id", () => {
  const r = run({ ...baseTask(), topic_id: "reps-qualification", topic_label: "can I qualify for REPS with my $85,000 rental income" }, ctx());
  assert.equal(r.status, "REFUSED");
  assert.ok(r.diagnostics.some((d) => d.code === "PERSONALIZED_INPUT"));
  assert.notEqual(r.status, "REVIEW_REQUIRED");
});

test("no PII/canary values ever leak into diagnostics or referral", () => {
  const r = run({ ...baseTask(), topic_label: "my income is $85,000, can I deduct repairs?" }, ctx());
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes("85,000") && !blob.includes("85000"));
});
