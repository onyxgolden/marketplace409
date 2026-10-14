/**
 * run-manual.js — manual smoke run of the CI core on invented fixtures.
 * Usage: node runner/run-manual.js
 * Everything here is synthetic; no real vendors, no network.
 *
 * The corpus is authenticated BEFORE any scored module is imported
 * (dynamic import after verification, CI-006).
 */
import { readFileSync } from "node:fs";
import { verifyCorpusManifest } from "../src/trust.js";

const root = new URL("..", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("corpus/manifest.json", root), "utf8"));
const v = verifyCorpusManifest(manifest, (p) => readFileSync(new URL(p, root), "utf8"));
if (!v.ok) {
  console.error(`corpus authentication failed: ${v.reason}${v.path ? ` (${v.path})` : ""}`);
  process.exit(1);
}
console.error(`corpus authenticated: ${v.files} files`);

const { runPipeline } = await import("../src/index.js");
const { PROPOSITION_IDS, TAXONOMY_DIGEST } = await import("../src/taxonomy.js");
const { confirmedSetDigest } = await import("../src/trust.js");

const fid = PROPOSITION_IDS[0];
const mkCell = (subject, state) => ({
  feature_id: fid,
  proposition: "invented",
  subject_ref: { vendor_id: subject, product_id: `${subject}-p`, edition: null },
  scope: { edition: "standard", platform: "web", region: "US" },
  evidence_state: state,
  citations: state === "unsupported" ? [] : [`${subject}-src-1`],
  paraphrase: state === "unsupported" ? null : "Invented fixture paraphrase.",
  opposing_paraphrase: null,
  attribution: state === "unsupported" ? "none" : "vendor_documented",
  conflict: false,
  reason_code: state,
  confidence_reason: "fixture",
  freshness_status: "unknown", // resolved at admission
  completeness: "partial",
  injection_quarantined: [],
  out_of_scope_evidence: [],
  forge_refs: [],
});

const vendors = [
  { vendor_id: "renta", product_id: "renta-p" },
  { vendor_id: "yardi", product_id: "yardi-p" },
];
const admittedSources = {};
for (const v of [...vendors, { vendor_id: "forge", product_id: "forge-p" }]) {
  const sid = `${v.vendor_id}-src-1`;
  admittedSources[sid] = {
    source_id: sid,
    vendor_id: v.vendor_id,
    product_id: v.product_id,
    url: `https://example.com/${v.vendor_id}/docs`,
    source_type: "vendor_docs",
    accessed_at: "2026-10-13T00:00:00Z",
    content_sha256: "0".repeat(64),
    access_status: "ok",
  };
}

const trusted = {
  confirmedSet: { vendors, digest: confirmedSetDigest(vendors) },
  admittedSources,
  forgeSnapshot: {
    repo: "onyxgolden/marketplace409",
    commit: "ec995080ec995080ec995080ec995080ec995080",
    tree: "manual-fixture-tree",
  },
  clock: "2026-10-13T00:00:00Z",
};

const input = {
  task_id: "manual-smoke",
  lane: "Rental",
  confirmed_set_ref: { digest: trusted.confirmedSet.digest },
  feature_taxonomy_ref: { digest: TAXONOMY_DIGEST },
  competitor_source_refs: [],
  forge_base_pin: { ...trusted.forgeSnapshot },
  requested_action: "internal_compare",
  as_of_date: "2026-10-13",
};

const out = runPipeline(input, {
  forge: [mkCell("forge", "supported")],
  renta: [mkCell("renta", "supported")],
  yardi: [mkCell("yardi", "unsupported")],
}, trusted);

console.log(JSON.stringify({
  status: out.status,
  reason_code: out.reason_code || null,
  comparisons: out.comparisons?.map((c) => ({ vendor: c.vendor_id, verdict: c.verdict })),
  summary: out.comparison_summary,
}, null, 2));
