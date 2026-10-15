/**
 * fm-findings5.test.js — FM-005 round-5 regressions (rereview5 verdict).
 *
 * Round 4 made the internal planConsultations() helper correct, but the
 * PUBLIC run() entrypoint still inspected later records before the budget
 * was enforced: resolveRef() ran measureDepth()/canonicalBytes() across
 * the entire fixture, and stage 5b repeated both whole-fixture traversals,
 * before stage 5c ever charged the consultation budget. ChatGPT's probe:
 * public run() inspected all 100 sections (1332 property reads on
 * sections 63..99) before refusing.
 *
 * Round 5 moves the consultation budget gate BEFORE every integrity /
 * depth / serialization traversal. These sentinel regressions run through
 * the public run() entrypoint (not the exported helper) and assert ZERO
 * reads of candidate 65 and every later candidate on section, line/claim
 * and nested-basis boundaries.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { loadStore, makeContext, run } from "./harness.js";
import { canonicalBytes } from "../src/canonical.js";
import { gitBlobSha1 } from "../src/resolver.js";

function registerBlob(store, content, blob, path = "fixtures/financial-manager/r5.json") {
  const ref = {
    repo: "forge-ai-drop-fixtures",
    path,
    commit: "e".repeat(40),
    blob,
    algorithm: "git-sha1",
    revision: "1",
  };
  const ctx = makeContext(store);
  ctx.fixtureStore = { fixtures: { r5: { source_ref: ref, content } } };
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
  population_id: "pop-r5",
  period_start: "2026-01-01",
  period_end: "2026-01-31",
  lines: [],
  claimed_totals: [],
  narrative_claims: [],
});

const spy = (target, reads, idx) =>
  new Proxy(target, {
    get(t, prop, receiver) {
      reads.push([idx, String(prop)]);
      return Reflect.get(t, prop, receiver);
    },
  });

// Verdict probe, public path: 100 instrumented sections through run().
// Charges run 2..65; the 65th charge (section index 63) must refuse BEFORE
// any property of that section — or any later section — is read. The
// round-4 failure mode was 1332 property reads on sections 63..99 via the
// resolver + stage-5b whole-fixture traversals.
test("fm005-r5: public run() — zero reads of sections at/past the cap", () => {
  const N = 100;
  const reads = [];
  const sections = Array.from({ length: N }, (_, i) => spy({ ...emptySec("s" + i) }, reads, i));
  const content = { sections };
  // Blob registration touches every property; reset the tape so only the
  // run() under test is measured.
  const blob = gitBlobSha1(canonicalBytes(content));
  reads.length = 0;
  const { ctx, ref } = registerBlob(loadStore(), content, blob);
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");

  const touched = new Set(reads.map(([i]) => i));
  assert.ok(touched.has(62), "last within-budget section was inspected");
  for (let i = 63; i < N; i++) {
    assert.ok(!touched.has(i), `section ${i} was inspected after the cap tripped`);
  }
  assert.equal(reads.filter(([i]) => i >= 63).length, 0);
});

// Line/claim boundary through run(): 1 ref + 1 section + 62 lines makes
// the narrative claim the 65th consultation — it must be refused BEFORE
// any of its properties are read.
test("fm005-r5: public run() — zero reads of the over-budget claim", () => {
  const reads = [];
  const lines = Array.from({ length: 62 }, (_, i) => ({
    line_id: "L" + i,
    category: "expense",
    budget_minor: "1000",
    actual_minor: "900",
    source_labels: ["lbl-" + i],
    support_strength: "verified",
    flags: [],
  }));
  const claim = spy(
    {
      claim_id: "C0",
      kind: "cause",
      metric: "variance",
      line_ids: ["L0"],
      direction: "down",
      quoted_text: "costs fell",
      basis_refs: [],
    },
    reads,
    "claim"
  );
  const sec = { ...emptySec("s0"), lines, narrative_claims: [claim] };
  const content = { sections: [sec] };
  const blob = gitBlobSha1(canonicalBytes(content));
  reads.length = 0;
  const { ctx, ref } = registerBlob(loadStore(), content, blob);
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");
  assert.equal(reads.length, 0, `over-budget claim was inspected: ${JSON.stringify(reads.slice(0, 5))}`);
});

// Nested-basis boundary through run(): 1 ref + 1 section + 1 claim + 62
// basis records makes basis[61] the 65th consultation — it must be refused
// BEFORE any of its properties are read, and later basis records untouched.
test("fm005-r5: public run() — zero reads of over-budget basis records", () => {
  const reads = [];
  const claimReads = [];
  const bases = Array.from({ length: 62 }, (_, i) =>
    spy({ basis_id: "B" + i, note: "n" + i }, reads, i)
  );
  const sec = {
    ...emptySec("s0"),
    narrative_claims: [
      spy(
        {
          claim_id: "C0",
          kind: "cause",
          metric: "variance",
          line_ids: [],
          direction: "down",
          quoted_text: "costs fell",
          basis_refs: bases,
        },
        claimReads,
        "claim"
      ),
    ],
  };
  const content = { sections: [sec] };
  const blob = gitBlobSha1(canonicalBytes(content));
  reads.length = 0;
  claimReads.length = 0;
  const { ctx, ref } = registerBlob(loadStore(), content, blob);
  const r = run(taskFor(ref), ctx);
  assertRefusedNoPartial(r, "BUDGET_EXCEEDED");

  // Liveness: the walk reached the basis phase — the charged claim's
  // basis_refs were read before the 65th charge tripped.
  assert.ok(claimReads.length > 0, "probe is live: claim was inspected before the cap tripped");
  // The 65th consultation (basis[61]) was refused BEFORE any of its
  // properties were read; nothing later exists to touch.
  const touched = new Set(reads.map(([i]) => i));
  assert.ok(!touched.has(61), "basis record 61 (65th consultation) was inspected after the cap tripped");
  assert.equal(reads.filter(([i]) => i >= 61).length, 0);
});
