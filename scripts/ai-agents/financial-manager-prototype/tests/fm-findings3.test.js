/**
 * fm-findings3.test.js — FM-005 round-3 regressions (rereview3 verdict).
 *
 * Single consultation budget: section metadata objects, lines, narrative
 * claims, claimed totals and each nested basis record are ALL charged,
 * BEFORE section validation traverses anything. Over-limit input yields
 * BUDGET_EXCEEDED with REFUSED status and no partial domain result.
 * Deduplication never refunds reads already performed.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, makeContext, run } from "./harness.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";

function registerTampered(store, content) {
  const blob = gitBlobSha1(canonicalBytes(content));
  const ref = {
    repo: "forge-ai-drop-fixtures",
    path: "fixtures/financial-manager/tampered.json",
    commit: "e".repeat(40),
    blob,
    algorithm: "git-sha1",
    revision: "1",
  };
  const ctx = makeContext(store);
  ctx.fixtureStore = { fixtures: { t: { source_ref: ref, content } } };
  return { ctx, ref };
}

const taskFor = (ref) => ({
  task_id: "t",
  bundle_refs: [ref],
  period_ids: [],
  requested_action: "assemble_draft",
});

const emptySec = (id) => ({
  section_id: id,
  currency: "USD",
  minor_unit_scale: 2,
  population_id: "pop-r3",
  period_start: "2026-01-01",
  period_end: "2026-01-31",
  lines: [],
  claimed_totals: [],
  narrative_claims: [],
});

const line0 = {
  line_id: "L0",
  category: "expense",
  budget_minor: "1000",
  actual_minor: "900",
  source_labels: ["lbl-0"],
  support_strength: "verified",
  flags: [],
};

const basisRefs = (n) =>
  Array.from({ length: n }, (_, i) => ({
    basis_id: "B" + i,
    verified: true,
    bounded_fact: "L0 synthetic cause",
  }));

const claimWithBases = (n) => ({
  claim_id: "C0",
  kind: "cause",
  metric: "variance",
  line_ids: ["L0"],
  direction: "down",
  quoted_text: "costs fell",
  basis_refs: basisRefs(n),
});

const secWithClaim = (nBases) => ({
  ...emptySec("s0"),
  lines: [line0],
  narrative_claims: [claimWithBases(nBases)],
});

function assertRefusedNoPartial(r, code) {
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, code);
  assert.deepStrictEqual(r.sections, []);
  assert.equal(r.package_complete, false);
  assert.equal(r.rollup.possible, false);
}

// Verdict probe 1: 100 sections with empty lines/claims must NOT assemble.
// Consultations = 1 ref + 100 section objects = 101 > 64.
test("fm005-r3: 100 empty sections -> BUDGET_EXCEEDED (section objects are charged)", () => {
  const store = loadStore();
  const sections = Array.from({ length: 100 }, (_, i) => emptySec("s" + i));
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// Verdict probe 2: 70 nested basis_refs on one claim must NOT assemble.
// Consultations = 1 ref + 1 section + 1 line + 1 claim + 70 bases = 74 > 64.
test("fm005-r3: 70 nested basis_refs -> BUDGET_EXCEEDED (basis records are charged)", () => {
  const store = loadStore();
  const { ctx, ref } = registerTampered(store, { sections: [secWithClaim(70)] });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// Exact limit: 63 sections -> 1 + 63 = 64 consultations, within budget.
test("fm005-r3: 63 sections (exact consultation limit) -> not BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const sections = Array.from({ length: 63 }, (_, i) => emptySec("s" + i));
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(taskFor(ref), ctx);
  assert.notEqual(r.diagnostics[0]?.code, "BUDGET_EXCEEDED");
  assert.equal(r.status, "ASSEMBLED");
});

// +1 over the limit: 64 sections -> 65 consultations -> BUDGET_EXCEEDED.
test("fm005-r3: 64 sections (+1 over limit) -> BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const sections = Array.from({ length: 64 }, (_, i) => emptySec("s" + i));
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// Exact limit for nested basis records: 1 + 1 + 1 + 1 + 60 = 64 -> within budget.
test("fm005-r3: 60 basis_refs (exact consultation limit) -> not BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const { ctx, ref } = registerTampered(store, { sections: [secWithClaim(60)] });
  const r = run(taskFor(ref), ctx);
  assert.notEqual(r.diagnostics[0]?.code, "BUDGET_EXCEEDED");
  assert.equal(r.status, "ASSEMBLED");
});

// +1 over the limit for nested basis records: 65 consultations -> BUDGET_EXCEEDED.
test("fm005-r3: 61 basis_refs (+1 over limit) -> BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const { ctx, ref } = registerTampered(store, { sections: [secWithClaim(61)] });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// Claimed totals count too: 1 ref + 1 section + 63 totals = 65 -> BUDGET_EXCEEDED.
test("fm005-r3: 63 claimed totals (+1 over limit) -> BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const totals = Array.from({ length: 63 }, (_, i) => ({
    claim_id: "T" + i,
    line_ids: ["L0"],
    claimed_budget_minor: "1000",
    claimed_actual_minor: "900",
  }));
  const sec = { ...emptySec("s0"), lines: [line0], claimed_totals: totals };
  const { ctx, ref } = registerTampered(store, { sections: [sec] });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// Budget is charged BEFORE validation: malformed shapes refuse cleanly
// (INVALID_INPUT from the pre-validation stage) without deep traversal throwing.
test("fm005-r3: malformed section shapes refuse cleanly, not a throw", () => {
  const store = loadStore();
  const sections = Array.from({ length: 100 }, (_, i) => ({
    section_id: "s" + i,
    lines: "not-an-array",
    claimed_totals: [],
    narrative_claims: [],
  }));
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(taskFor(ref), ctx);
  // shape refusal (INVALID_INPUT) comes from the pre-validation stage;
  // the point is no exception escapes and no partial result is produced.
  assert.equal(r.status, "REFUSED");
  assert.deepStrictEqual(r.sections, []);
});
