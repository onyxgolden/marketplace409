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
  },
  "pipeline-pro": {
    product_id: "pipeline-pro",
    product_token: "pipeline-pro",
    benefit_tokens: ["clean-pipeline", "team-visibility"],
    verified: true,
  },
  "unverified-widget": {
    product_id: "unverified-widget",
    product_token: "crm-starter",
    benefit_tokens: ["faster-followup"],
    verified: false,
  },
};

export const PRINCIPAL = {
  principal_id: "jason",
  role: "JASON",
  registered_by: "test-host",
  valid_from: "2026-01-01",
  expires_at: "2027-01-01",
  revoked: false,
};

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
  if (opts.readGrants !== undefined) {
    return {
      clock: Date.parse("2026-10-19T12:00:00Z"),
      sources,
      readGrants: opts.readGrants,
      principal: opts.principal ?? { ...PRINCIPAL },
      criteria: opts.criteria ?? { ...CRITERIA },
      product_registry: opts.productRegistry ?? structuredClone(PRODUCT_REGISTRY),
      ...(opts.testHooks ? { test_hooks: opts.testHooks } : {}),
    };
  }
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
    product_registry: opts.productRegistry ?? structuredClone(PRODUCT_REGISTRY),
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
