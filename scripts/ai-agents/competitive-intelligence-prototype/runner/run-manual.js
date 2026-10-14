/**
 * run-manual.js — manual smoke run of the CI core on invented fixtures.
 *
 * Official usage: CI_APPROVED_ROOT_DIGEST=<64-hex> node runner/launch.js
 * Everything here is synthetic; no real vendors, no network.
 *
 * CI-006: corpus authentication is owned ENTIRELY by runner/launch.js, which
 * verifies every corpus byte with builtins only BEFORE this file is
 * imported. This file performs no self-verification (a self-check that
 * imports the code it verifies cannot authenticate a tampered verifier).
 * Direct invocation without the launcher is refused: the launcher sets
 * CI_CORPUS_AUTHENTICATED=1 after successful authentication, and this file
 * checks it before any corpus import executes (dynamic imports only).
 */
if (process.env.CI_CORPUS_AUTHENTICATED !== "1") {
  console.error("refused: run-manual.js must be launched via runner/launch.js (corpus not authenticated)");
  process.exit(1);
}

const { runPipeline } = await import("../src/index.js");
const { PROPOSITION_IDS, TAXONOMY_DIGEST } = await import("../src/taxonomy.js");
const { confirmedSetDigest, createTrustedContext } = await import("../src/trust.js");

const fid = PROPOSITION_IDS[0];
const mkCell = (subject, state) => ({
  feature_id: fid,
  proposition: "invented",
  subject_ref: { vendor_id: subject, product_id: `${subject}-p`, edition: null },
  scope: { product_id: `${subject}-p`, edition: "standard", platform: "web", region: "US", version: "2026.1" },
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

const trusted = createTrustedContext({
  confirmedSet: { vendors, digest: confirmedSetDigest(vendors) },
  admittedSources,
  forgeSnapshot: {
    repo: "onyxgolden/marketplace409",
    commit: "ec995080ec995080ec995080ec995080ec995080",
    tree: "manual-fixture-tree",
  },
  forgeFileResolver: null, // no FORGE refs in this fixture; refs would be unsupported
  clock: "2026-10-13T00:00:00Z",
});

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
