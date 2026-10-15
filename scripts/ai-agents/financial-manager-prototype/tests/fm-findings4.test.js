/**
 * fm-findings4.test.js — FM-005 round-4 regressions (rereview4 verdict).
 *
 * The consultation cap must be charged INCREMENTALLY: the 65th consultation
 * refuses immediately (BUDGET_EXCEEDED) BEFORE that item is inspected and
 * before anything after it is touched. The spy probe below instruments
 * candidate section objects and proves zero reads past the cap. The same
 * early-stop rule applies to span counting.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, makeContext, run } from "./harness.js";
import { planConsultations } from "../src/index.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";

function registerTampered(store, content) {
  const blob = gitBlobSha1(canonicalBytes(content));
  const ref = {
    repo: "forge-ai-drop-fixtures",
    path: "fixtures/financial-manager/tampered.json",
    commit: "f".repeat(40),
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

function assertRefusedNoPartial(r, code) {
  assert.equal(r.status, "REFUSED");
  assert.equal(r.diagnostics[0].code, code);
  assert.deepStrictEqual(r.sections, []);
  assert.equal(r.package_complete, false);
  assert.equal(r.rollup.possible, false);
}

const emptySec = (id) => ({
  section_id: id,
  currency: "USD",
  minor_unit_scale: 2,
  population_id: "pop-r4",
  period_start: "2026-01-01",
  period_end: "2026-01-31",
  lines: [],
  claimed_totals: [],
  narrative_claims: [],
});

// Verdict probe (required): instrumented candidate source. Every section is
// a Proxy recording each property read. With 1 bundle ref + 100 sections,
// charges run 2..65; the 65th charge (section index 63) must refuse BEFORE
// any property of that section — or any later section — is read.
test("fm005-r4: spy probe — zero reads of records at/past the cap", () => {
  const N = 100;
  const reads = [];
  const sections = Array.from({ length: N }, (_, i) => {
    const target = { ...emptySec("s" + i) };
    return new Proxy(target, {
      get(t, prop, receiver) {
        reads.push([i, String(prop)]);
        return Reflect.get(t, prop, receiver);
      },
    });
  });
  const resolved = [
    { fixtureId: "f", sourceRef: { repo: "r" }, fixture: { content: { sections } } },
  ];
  const task = { task_id: "t", bundle_refs: [{ repo: "r" }] };
  const out = planConsultations(resolved, task, "t");
  assert.equal(out.ok, false);
  assert.equal(out.refusal.status, "REFUSED");
  assert.equal(out.refusal.diagnostics[0].code, "BUDGET_EXCEEDED");
  // Fail-closed empty result: no sections planned, no partial domain output.
  assert.deepStrictEqual(out.refusal.sections, []);

  const touched = new Set(reads.map(([i]) => i));
  // Sections 0..62 were charged and shallowly inspected (64 charges total
  // with the bundle ref). Section 63 tripped the 65th charge BEFORE any
  // property read; sections 63..99 must show zero reads.
  assert.ok(touched.has(62), "last within-budget section was inspected");
  for (let i = 63; i < N; i++) {
    assert.ok(!touched.has(i), `section ${i} was inspected after the cap tripped`);
  }
  assert.equal(reads.filter(([i]) => i >= 63).length, 0);
});

// The probe above targets planConsultations directly (the exact function the
// run path calls). The same over-limit input through the full run must also
// refuse with no partial output.
test("fm005-r4: 100 sections through the full run -> BUDGET_EXCEEDED, no partial", () => {
  const store = loadStore();
  const sections = Array.from({ length: 100 }, (_, i) => emptySec("s" + i));
  const { ctx, ref } = registerTampered(store, { sections });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// Incremental charging crosses categories: the 65th charge can land on a
// narrative claim, not just a section. 1 ref + 1 section + 62 lines +
// 1 claim = 65 -> the claim is refused BEFORE inspection.
test("fm005-r4: 65th charge lands on a claim -> BUDGET_EXCEEDED before claim inspection", () => {
  const store = loadStore();
  const lines = Array.from({ length: 62 }, (_, i) => ({
    line_id: "L" + i,
    category: "expense",
    budget_minor: "1000",
    actual_minor: "900",
    source_labels: ["lbl-" + i],
    support_strength: "verified",
    flags: [],
  }));
  const sec = {
    ...emptySec("s0"),
    lines,
    narrative_claims: [
      {
        claim_id: "C0",
        kind: "cause",
        metric: "variance",
        line_ids: ["L0"],
        direction: "down",
        quoted_text: "costs fell",
        basis_refs: [],
      },
    ],
  };
  const { ctx, ref } = registerTampered(store, { sections: [sec] });
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
});

// One fewer line: 1 ref + 1 section + 61 lines + 1 claim = 64 -> within
// budget, not BUDGET_EXCEEDED (exact-boundary across categories).
test("fm005-r4: 64 consultations across lines+claim -> not BUDGET_EXCEEDED", () => {
  const store = loadStore();
  const lines = Array.from({ length: 61 }, (_, i) => ({
    line_id: "L" + i,
    category: "expense",
    budget_minor: "1000",
    actual_minor: "900",
    source_labels: ["lbl-" + i],
    support_strength: "verified",
    flags: [],
  }));
  const sec = {
    ...emptySec("s0"),
    lines,
    narrative_claims: [
      {
        claim_id: "C0",
        kind: "cause",
        metric: "variance",
        line_ids: ["L0"],
        direction: "down",
        quoted_text: "costs fell",
        basis_refs: [],
      },
    ],
  };
  const { ctx, ref } = registerTampered(store, { sections: [sec] });
  const r = run(taskFor(ref), ctx);
  assert.notEqual(r.diagnostics[0]?.code, "BUDGET_EXCEEDED");
});
