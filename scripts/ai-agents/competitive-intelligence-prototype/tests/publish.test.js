/** Publisher + inventory tests (§1, §6, §9). */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  looksCopied, renderMatrixMarkdown, renderOpportunitiesMarkdown,
  makeRunReceipt, gateArtifacts,
} from "../src/publish.js";
import { forgeEvidence, classifyForgeFinding, snapshotPin, FORGE_STATUSES } from "../src/inventory.js";

test("looksCopied flags copyright text", () => {
  assert.equal(looksCopied("© 2026 Vendor Inc. All rights reserved."), true);
  assert.equal(looksCopied("Supports online payments."), false);
});

test("gateArtifacts rejects copied content", () => {
  const v = gateArtifacts({ memo: "© Vendor. All rights reserved." });
  assert.equal(v.length, 1);
  assert.deepEqual(gateArtifacts({ memo: "Paraphrased capability summary." }), []);
});

test("matrix markdown renders without winner", () => {
  const md = renderMatrixMarkdown({
    lane: "Rental", as_of_date: "2026-10-13",
    products: ["rentec", "yardi"],
    comparisons: [
      { feature_id: "a", vendor_id: "rentec", verdict: "parity" },
      { feature_id: "a", vendor_id: "yardi", verdict: "behind" },
    ],
  });
  assert.match(md, /INTERNAL ONLY/);
  assert.match(md, /No whole-product winner/);
  assert.match(md, /\| a \| parity \| behind \|/);
});

test("opportunities memo separates gap types", () => {
  const md = renderOpportunitiesMarkdown({
    gaps: [{ feature_id: "x", vendor_id: "yardi", gap_type: "evidence_gap", next_step: "look" }],
    comparisons: [{ feature_id: "z", vendor_id: "rentec", verdict: "behind", basis: "docs show split payments" }],
  });
  assert.match(md, /Confirmed implementation gaps/);
  assert.match(md, /Evidence gaps/);
});

test("run receipt is internal only", () => {
  const r = makeRunReceipt({ task_id: "t", lane: "Rental", forge_base_pin: {}, source_results: [], limitations: ["x"] });
  assert.equal(r.internal_only, true);
});

test("forgeEvidence requires full SHA", () => {
  assert.equal(forgeEvidence({ repo: "r", path: "p", commit: "short", blob: "b" }).ok, false);
  const good = forgeEvidence({
    repo: "onyxgolden/marketplace409", path: "src/x.js",
    commit: "ec995080ec995080ec995080ec995080ec995080", blob: "abc",
  });
  assert.equal(good.ok, true);
  assert.equal(good.evidence.attribution, "forge_code");
});

test("not-found is unknown, not absent", () => {
  const r = classifyForgeFinding({ searched_paths: ["src/a", "src/b"], found: false });
  assert.equal(r.status, "unknown");
  assert.match(r.basis, /not verified absent/);
});

test("snapshotPin requires full commit", () => {
  assert.equal(snapshotPin({ repo: "r", commit: "abc" }).ok, false);
  assert.equal(snapshotPin({ repo: "r", commit: "ec995080ec995080ec995080ec995080ec995080" }).ok, true);
});

test("all FORGE statuses known", () => {
  assert.ok(FORGE_STATUSES.includes("implemented_on_main"));
  assert.ok(FORGE_STATUSES.includes("unknown"));
});
