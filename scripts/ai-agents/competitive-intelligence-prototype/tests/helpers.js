/**
 * Fixture helpers shared across CI prototype tests.
 * All competitor/vendor text here is INVENTED for testing — never real claims.
 *
 * The trusted context below is the TEST host's injection: confirmed vendors,
 * admitted sources, the verified FORGE snapshot, and a fixed clock. Tests that
 * exercise runComparison must go through runAdmitted() — calling
 * runComparison without a trusted context must refuse.
 */
import { createHash } from "node:crypto";
import { PROPOSITION_IDS, TAXONOMY_DIGEST } from "../src/taxonomy.js";
import { evaluateCell } from "../src/cells.js";
import { runComparison } from "../src/compare.js";
import { confirmedSetDigest } from "../src/trust.js";

const sha = (s) => createHash("sha256").update(String(s), "utf8").digest("hex");

export function srcRef(vendor_id, n = 1) {
  const url = `https://example.com/${vendor_id}/docs/${n}`;
  return {
    source_id: `${vendor_id}-src-${n}`,
    vendor_id,
    product_id: `${vendor_id}-product`,
    edition: null,
    url,
    final_url: url,
    source_type: "vendor_docs",
    accessed_at: "2026-10-13T00:00:00Z",
    published_at: null,
    page_version: null,
    content_sha256: sha(url), // real 64-hex integrity field, never "abc123"
    locator: { kind: "section", page_number: null, section_index: n, dom_selector: null },
    access_status: "ok",
    verification: "host_verified",
  };
}

export function ev(paraphrase, attribution, supports, vendor_id) {
  return { paraphrase, attribution, supports, source_ref: srcRef(vendor_id) };
}

export function subj(vendor_id, edition = null) {
  return { vendor_id, product_id: `${vendor_id}-product`, edition };
}

export function scope(edition = "standard", platform = "web", region = "US") {
  return { edition, platform, region, version: "2026", as_of: "2026-10-13" };
}

/** Build a supported cell for a feature (freshness resolved at admission). */
export function supportedCell(feature_id, vendor_id, text = "Vendor documents this capability.") {
  return evaluateCell({
    feature_id,
    subject_ref: subj(vendor_id),
    scope: scope(),
    evidence: [ev(text, "vendor_documented", true, vendor_id)],
  });
}

/** The confirmed competitor set for tests (mirrors the real confirmed set shape). */
export const CONFIRMED_VENDORS = [
  { vendor_id: "compa", product_id: "compa-product" },
  { vendor_id: "compb", product_id: "compb-product" },
];
export const CONFIRMED_SET_DIGEST = confirmedSetDigest(CONFIRMED_VENDORS);

export const FORGE_PIN = {
  repo: "onyxgolden/marketplace409",
  commit: "ec995080ec995080ec995080ec995080ec995080",
  tree: "treex",
};

/** Build a valid trusted context, with per-test overrides. */
export function trustedContext(overrides = {}) {
  const admittedSources = {};
  for (const v of ["compa", "compb", "forge"]) {
    for (const n of [1, 2]) {
      const r = srcRef(v, n);
      admittedSources[r.source_id] = r;
    }
  }
  // Difference-evidence fixtures.
  for (const sid of ["s1", "s2"]) {
    admittedSources[sid] = {
      source_id: sid,
      vendor_id: "compa",
      product_id: "compa-product",
      url: `https://example.com/compa/diff/${sid}`,
      source_type: "vendor_docs",
      accessed_at: "2026-10-13T00:00:00Z",
      content_sha256: sha(sid),
      access_status: "ok",
    };
  }
  return {
    confirmedSet: { vendors: CONFIRMED_VENDORS, digest: CONFIRMED_SET_DIGEST },
    admittedSources,
    forgeSnapshot: { ...FORGE_PIN },
    clock: "2026-10-13T00:00:00Z",
    ...overrides,
  };
}

export function taskInput(overrides = {}) {
  return {
    task_id: "test-task-1",
    lane: "Rental",
    confirmed_set_ref: { digest: CONFIRMED_SET_DIGEST },
    feature_taxonomy_ref: { digest: TAXONOMY_DIGEST },
    competitor_source_refs: [],
    forge_base_pin: { ...FORGE_PIN },
    requested_action: "internal_compare",
    as_of_date: "2026-10-13",
    ...overrides,
  };
}

/** runComparison through the trusted test host. */
export function runAdmitted(input, cellsBySubject, tOverrides = {}) {
  return runComparison(input, cellsBySubject, trustedContext(tOverrides));
}

export { PROPOSITION_IDS, evaluateCell, TAXONOMY_DIGEST };
