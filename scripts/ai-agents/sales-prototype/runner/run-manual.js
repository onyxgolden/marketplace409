#!/usr/bin/env node
/**
 * run-manual.js — manual host launcher for the SALES prototype.
 * (S653-010: rewritten; the previous revision was copied Research code and
 * crashed. This builds a real Sales task/context and routes through the
 * guarded execution path.)
 *
 * The agent itself receives no filesystem capability: this launcher is the
 * host. It reads explicitly registered fixtures and saves the report to
 * an explicit scratch directory.
 *
 * Trust: the corpus digest is recomputed with node builtins only and
 * compared against SALES_APPROVED_ROOT BEFORE the guarded runner (or any
 * candidate module) is imported. Missing/wrong root refuses (exit 3)
 * before candidate execution.
 *
 * Usage: SALES_APPROVED_ROOT=<digest> node runner/run-manual.js [bundle] [outdir]
 *   bundle defaults to "main"; outdir defaults to /tmp/sales-manual.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// ---- trust authentication BEFORE any candidate import ----
{
  const APPROVED_ROOT = process.env.SALES_APPROVED_ROOT;
  if (typeof APPROVED_ROOT !== "string" || !/^[0-9a-f]{64}$/.test(APPROVED_ROOT)) {
    console.error("run-manual: missing separately trusted approval root (SALES_APPROVED_ROOT) — refusing to run");
    process.exit(3);
  }
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(ROOT, "corpus", "manifest.json"), "utf8"));
  } catch {
    console.error("run-manual: corpus/manifest.json unreadable — refusing to run");
    process.exit(3);
  }
  let bad = null;
  for (const e of manifest.files ?? []) {
    let bytes;
    try { bytes = readFileSync(join(ROOT, e.path)); } catch { bad = `missing pinned file: ${e.path}`; break; }
    if (sha(bytes) !== e.sha256) { bad = `hash mismatch: ${e.path}`; break; }
  }
  if (!bad) {
    const digest = sha(JSON.stringify(manifest));
    if (digest !== APPROVED_ROOT) bad = "corpus digest mismatch vs SALES_APPROVED_ROOT";
  }
  if (bad) {
    console.error(`run-manual: trust authentication failed — ${bad} — refusing to run`);
    process.exit(3);
  }
}

// Only now is the (authenticated) runner imported.
const { runGuarded } = await import("./run-guarded.js");

const bundleName = process.argv[2] ?? "main";
const outdir = resolve(process.argv[3] ?? "/tmp/sales-manual");
if (outdir.length === 0) {
  console.error("run-manual: outdir must be a non-empty path");
  process.exit(1);
}
mkdirSync(outdir, { recursive: true });

const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
const ref = store.bundleRefs[bundleName];
if (!ref) {
  console.error(`run-manual: unknown bundle '${bundleName}'. Known: ${Object.keys(store.bundleRefs).join(", ")}`);
  process.exit(1);
}
const key = `${ref.repo}|${ref.path}`;
const rev = store.sources[key]?.revisions?.[ref.commit];
if (!rev || typeof rev.text !== "string") {
  console.error(`run-manual: bundle '${bundleName}' has no registered revision text`);
  process.exit(1);
}
const leads = JSON.parse(rev.text);
const leadIds = leads.map((l) => l.lead_id);

// ---- host-supplied Sales task (real schema, not copied Research shapes) ----
const task = {
  schema_version: "1",
  task_id: `manual-${bundleName}`,
  operation: "analyze",
  fixture_refs: [
    {
      repo: ref.repo,
      path: ref.path,
      commit: ref.commit,
      blob: rev.blob,
      algorithm: "git-sha1",
      revision: rev.label,
    },
  ],
  options: {
    include_drafts: true,
    report_interval_start: "2026-10-01",
    report_interval_end: "2026-10-31",
    as_of: "2026-10-19",
  },
  // Declared-complete against the bundle's HOST-REGISTERED dataset identity.
  population: {
    declared_complete: true,
    dataset_id: rev.dataset_id,
    dataset_version: rev.dataset_version,
    expected_lead_ids: leadIds,
    expected_count: leads.length,
  },
};

// ---- host-supplied context (fixture-only; invented values) ----
const context = {
  clock: Date.parse("2026-10-19T12:00:00Z"),
  sources: { [key]: store.sources[key] },
  readGrants: [{ repo: ref.repo, path: ref.path }],
  principal: {
    principal_id: "manual-host",
    role: "JASON",
    registered_by: "run-manual",
    valid_from: "2026-01-01",
    expires_at: "2027-01-01",
    revoked: false,
  },
  criteria: {
    criteria_id: "sales-v1",
    criteria_version: "2026-10-19",
    fit_high_timing_days: 90,
    allowlisted_product_tokens: ["crm-starter", "pipeline-pro", "forecast-plus"],
    allowlisted_benefit_tokens: ["faster-followup", "clean-pipeline", "accurate-forecast", "team-visibility"],
  },
  product_registry: {
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
  },
};

const result = await runGuarded(JSON.stringify(task), JSON.stringify(context));
const out = join(outdir, `${bundleName}-report.json`);
writeFileSync(out, JSON.stringify(result, null, 2) + "\n");
const n = result.report ? result.report.classifications.length : 0;
console.log(`status=${result.status} complete=${result.complete} classifications=${n} report -> ${out}`);
process.exit(result.status === "REFUSED" ? 1 : 0);
