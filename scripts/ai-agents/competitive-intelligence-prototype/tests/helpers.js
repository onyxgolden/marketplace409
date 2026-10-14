/**
 * Fixture helpers shared across CI prototype tests.
 * All competitor/vendor text here is INVENTED for testing — never real claims.
 */
import { PROPOSITION_IDS } from "../src/taxonomy.js";
import { evaluateCell } from "../src/cells.js";

export function srcRef(vendor_id, n = 1) {
  return {
    source_id: `${vendor_id}-src-${n}`,
    vendor_id,
    product_id: `${vendor_id}-product`,
    edition: null,
    url: `https://example.com/${vendor_id}/docs/${n}`,
    final_url: `https://example.com/${vendor_id}/docs/${n}`,
    source_type: "vendor_docs",
    accessed_at: "2026-10-13T00:00:00Z",
    published_at: null,
    page_version: null,
    content_sha256: "abc123",
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

/** Build a supported cell for a feature. */
export function supportedCell(feature_id, vendor_id, text = "Vendor documents this capability.") {
  return evaluateCell({
    feature_id,
    subject_ref: subj(vendor_id),
    scope: scope(),
    evidence: [ev(text, "vendor_documented", true, vendor_id)],
  });
}

export function taskInput(overrides = {}) {
  return {
    task_id: "test-task-1",
    lane: "Rental",
    confirmed_set_ref: { path: "results/muse/ci-confirmed-set-2026-10-13.json", digest: "x" },
    feature_taxonomy_ref: { module: "taxonomy.js", dimensions: 12 },
    competitor_source_refs: [],
    forge_base_pin: {
      repo: "onyxgolden/marketplace409",
      commit: "ec995080ec995080ec995080ec995080ec995080",
      tree: "treex",
    },
    requested_action: "internal_compare",
    as_of_date: "2026-10-13",
    ...overrides,
  };
}

export { PROPOSITION_IDS, evaluateCell };
