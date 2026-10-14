/**
 * run-manual.js — manual smoke run of the CI core on invented fixtures.
 * Usage: node runner/run-manual.js
 * Everything here is synthetic; no real vendors, no network.
 */
import { runPipeline } from "../src/index.js";
import { PROPOSITION_IDS } from "../src/taxonomy.js";

const fid = PROPOSITION_IDS[0];
const mkCell = (subject, state) => ({
  feature_id: fid,
  proposition: "invented",
  subject_ref: { vendor_id: subject, product_id: `${subject}-p`, edition: null },
  scope: { edition: "standard", platform: "web", region: "US" },
  evidence_state: state,
  citations: state === "unsupported" ? [] : [`${subject}-src-1`],
  paraphrase: state === "unsupported" ? null : "Invented fixture paraphrase.",
  attribution: state === "unsupported" ? "none" : "vendor_documented",
  conflict: false,
  reason_code: state,
  confidence_reason: "fixture",
  freshness_status: "current",
  completeness: "partial",
  injection_quarantined: [],
});

const input = {
  task_id: "manual-smoke",
  lane: "Rental",
  confirmed_set_ref: { path: "results/muse/ci-confirmed-set-2026-10-13.json" },
  feature_taxonomy_ref: { module: "taxonomy.js", dimensions: 12 },
  competitor_source_refs: [],
  forge_base_pin: {
    repo: "onyxgolden/marketplace409",
    commit: "ec995080ec995080ec995080ec995080ec995080",
    tree: "manual-fixture-tree",
  },
  requested_action: "internal_compare",
  as_of_date: "2026-10-13",
};

const out = runPipeline(input, {
  forge: [mkCell("forge", "supported")],
  renta: [mkCell("renta", "supported")],
  yardi: [mkCell("yardi", "unsupported")],
});

console.log(JSON.stringify({
  status: out.status,
  comparisons: out.comparisons?.map((c) => ({ vendor: c.vendor_id, verdict: c.verdict })),
  summary: out.comparison_summary,
}, null, 2));
