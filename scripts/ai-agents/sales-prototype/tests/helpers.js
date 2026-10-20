/**
 * helpers.js — shared test host for the Sales Agent prototype.
 * Builds deterministic task/context pairs from the fixture store.
 * The context is the separately trusted host injection; the task is
 * the request under test.
 */

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadStore() {
  return JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
}

export const CRITERIA = {
  criteria_id: "sales-v1",
  criteria_version: "2026-10-19",
  fit_high_timing_days: 90,
  allowlisted_product_tokens: ["crm-starter", "pipeline-pro", "forecast-plus"],
  allowlisted_benefit_tokens: ["faster-followup", "clean-pipeline", "accurate-forecast", "team-visibility"],
};

export const PRODUCT_REGISTRY = {
  "crm-starter": {
    product_id: "crm-starter",
    product_token: "crm-starter",
    benefit_tokens: ["faster-followup", "clean-pipeline"],
    verified: true,
    // S653-002 (fix round 2): registered product/benefit evidence. Draft
    // eligibility requires VERIFIED evidence; absent evidence defaults to
    // UNAVAILABLE and withholds drafts.
    evidence: { state: "VERIFIED", detail: "host product_registry (separately trusted context; not source bytes)" },
  },
  "pipeline-pro": {
    product_id: "pipeline-pro",
    product_token: "pipeline-pro",
    benefit_tokens: ["clean-pipeline", "team-visibility"],
    verified: true,
    evidence: { state: "VERIFIED", detail: "host product_registry (separately trusted context; not source bytes)" },
  },
  "unverified-widget": {
    product_id: "unverified-widget",
    product_token: "crm-starter",
    benefit_tokens: ["faster-followup"],
    verified: false,
  },
};

/**
 * S653-002 (fix round 3): build the product registry with PINNED
 * evidence. Each VERIFIED evidence record carries the versioned
 * evidence_ref tuple from the fixture store's registered product evidence
 * catalog (store.evidenceCatalogRef); run() resolves the pin against the
 * host registration before any draft may assert VERIFIED.
 */
export function makeProductRegistry(store) {
  const pin = store.evidenceCatalogRef ? { ...store.evidenceCatalogRef } : undefined;
  const pinned = (entry) => {
    if (!pin) return structuredClone(entry);
    const e = structuredClone(entry);
    e.evidence = { ...e.evidence, evidence_ref: { ...pin } };
    return e;
  };
  return {
    "crm-starter": pinned({
      product_id: "crm-starter",
      product_token: "crm-starter",
      benefit_tokens: ["faster-followup", "clean-pipeline"],
      verified: true,
      evidence: { state: "VERIFIED", detail: "pinned product evidence catalog (sales-fixtures/products/catalog.json)" },
    }),
    "pipeline-pro": pinned({
      product_id: "pipeline-pro",
      product_token: "pipeline-pro",
      benefit_tokens: ["clean-pipeline", "team-visibility"],
      verified: true,
      evidence: { state: "VERIFIED", detail: "pinned product evidence catalog (sales-fixtures/products/catalog.json)" },
    }),
    "unverified-widget": {
      product_id: "unverified-widget",
      product_token: "crm-starter",
      benefit_tokens: ["faster-followup"],
      verified: false,
    },
  };
}

// S653-002 (fix round 3): the registered product evidence source key. Its
// read grant lets run() resolve product evidence pins.
export const EVIDENCE_SOURCE_KEY = "sales-fixtures|products/catalog.json";

export const PRINCIPAL = {
  principal_id: "jason",
  role: "JASON",
  registered_by: "test-host",
  valid_from: "2026-01-01",
  expires_at: "2027-01-01",
  revoked: false,
};

// S653-001: the host-registered dataset identity (mirrors
// fixtures/store.json revisions). Population completeness declarations
// must bind to this; caller claims alone never establish coverage.
export const DATASET = {
  dataset_id: "sales-fixtures",
  dataset_version: "2026-10-19",
};

/** Population declaration bound to the registered dataset identity. */
export function boundPopulation(store, bundleName, ids) {
  const ref = store.bundleRefs[bundleName];
  const key = `${ref.repo}|${ref.path}`;
  const rev = store.sources[key].revisions[ref.commit];
  const text = rev.text;
  const leads = JSON.parse(text);
  return {
    declared_complete: true,
    dataset_id: rev.dataset_id,
    dataset_version: rev.dataset_version,
    expected_lead_ids: ids ?? leads.map((l) => l.lead_id),
    expected_count: leads.length,
  };
}

/**
 * Build a context. opts: {bundleNames, criteria, productRegistry,
 * principal, extraSources, testHooks}.
 */
export function makeContext(store, opts = {}) {
  const bundleNames = opts.bundleNames ?? ["main"];
  const sources = {};
  const readGrants = [];
  for (const name of bundleNames) {
    const ref = store.bundleRefs[name];
    const key = `${ref.repo}|${ref.path}`;
    sources[key] = store.sources[key];
    readGrants.push({ repo: ref.repo, path: ref.path });
  }
  // S653-002 (fix round 3): the registered product evidence source is
  // always present in the host context (its read grant is added to the
  // default grants; an explicit readGrants override controls grants).
  if (store.sources[EVIDENCE_SOURCE_KEY]) {
    sources[EVIDENCE_SOURCE_KEY] = store.sources[EVIDENCE_SOURCE_KEY];
  }
  if (opts.readGrants !== undefined) {
    return {
      clock: Date.parse("2026-10-19T12:00:00Z"),
      sources,
      readGrants: opts.readGrants,
      principal: opts.principal ?? { ...PRINCIPAL },
      criteria: opts.criteria ?? { ...CRITERIA },
      product_registry: opts.productRegistry ?? makeProductRegistry(store),
      ...(opts.testHooks ? { test_hooks: opts.testHooks } : {}),
    };
  }
  readGrants.push({ repo: "sales-fixtures", path: "products/catalog.json" });
  if (opts.extraSources) {
    for (const [key, entry] of Object.entries(opts.extraSources)) {
      sources[key] = entry;
    }
  }
  return {
    clock: Date.parse("2026-10-19T12:00:00Z"),
    sources,
    readGrants,
    principal: opts.principal ?? { ...PRINCIPAL },
    criteria: opts.criteria ?? { ...CRITERIA },
    product_registry: opts.productRegistry ?? makeProductRegistry(store),
    ...(opts.testHooks ? { test_hooks: opts.testHooks } : {}),
  };
}

/**
 * Build a task. opts: {bundleNames, taskId, options, population,
 * headerClaims, sourceRefOverrides}.
 */
export function makeTask(store, opts = {}) {
  const bundleNames = opts.bundleNames ?? ["main"];
  const fixture_refs = bundleNames.map((name) => {
    const ref = store.bundleRefs[name];
    const key = `${ref.repo}|${ref.path}`;
    const commit = ref.commit;
    const rev = store.sources[key].revisions[commit];
    const ov = (opts.sourceRefOverrides && opts.sourceRefOverrides[name]) || {};
    return {
      repo: ref.repo,
      path: ref.path,
      commit: ov.commit ?? commit,
      blob: ov.blob ?? rev.blob,
      algorithm: "git-sha1",
      revision: ov.revision ?? rev.label,
    };
  });
  const task = {
    schema_version: "1",
    task_id: opts.taskId ?? "test-task-001",
    operation: "analyze",
    fixture_refs,
    options: {
      include_drafts: true,
      report_interval_start: "2026-10-01",
      report_interval_end: "2026-10-31",
      as_of: "2026-10-19",
      ...(opts.options || {}),
    },
  };
  if (opts.population !== undefined) task.population = opts.population;
  if (opts.headerClaims !== undefined) task.header_claims = opts.headerClaims;
  return task;
}

/** Standard valid task+context over the main bundle. */
export function makeStandard(store, taskOpts = {}, ctxOpts = {}) {
  const bundleNames = taskOpts.bundleNames ?? ["main"];
  return {
    task: makeTask(store, { ...taskOpts, bundleNames }),
    context: makeContext(store, { ...ctxOpts, bundleNames }),
  };
}
