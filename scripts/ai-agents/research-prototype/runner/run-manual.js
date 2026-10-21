#!/usr/bin/env node
/**
 * run-manual.js — manual host launcher (NOT part of the scored path).
 * Reads explicitly registered fixtures and saves reports to an explicit
 * scratch directory. The agent itself receives no filesystem capability.
 *
 * Invoke through the separately trusted bootstrap so the manifest is
 * authenticated before any candidate byte executes:
 *   RESEARCH_APPROVED_ROOT=<digest> node /home/hatch/workspace/research-prototype-trust/bootstrap.js <repo-dir> manual <bundle> [outdir]
 *
 * Usage: RESEARCH_APPROVED_ROOT=<digest> node runner/run-manual.js <bundle> [outdir]
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
// S648A-006: the manual host routes through the guarded execution path,
// not the synchronous run() directly.
const { runGuarded } = await import("./run-guarded.js");

const bundleName = process.argv[2] ?? "single-passage";
const outdir = process.argv[3] ?? "/tmp/research-manual";
mkdirSync(outdir, { recursive: true });

const ref = store.bundleRefs[bundleName];
if (!ref) {
  console.error(`unknown bundle: ${bundleName}`);
  process.exit(1);
}
const key = `${ref.repo}|${ref.path}`;
const docs = JSON.parse(store.sources[key].revisions[ref.commit].text);
const n = docs.length;

// Build one requested claim per assertion of the first passage, so the
// manual run exercises the full attribution path.
const requested_claims = [];
outer:
for (const d of docs) {
  for (const p of d.passages || []) {
    for (const a of p.assertions || []) {
      requested_claims.push({
        claim_id: `manual-${d.doc_id}-${p.passage_id}-${a.assertion_id}`,
        atoms: [{
          subject: a.subject, predicate: a.predicate, value: a.value,
          value_type: a.value_type, scope: a.scope, polarity: a.polarity,
        }],
        origin_passage_refs: [{ doc_id: d.doc_id, passage_id: p.passage_id }],
      });
    }
    break outer;
  }
}

const task = {
  schema_version: "1",
  task_id: `manual-${bundleName}`,
  operation: "analyze",
  fixture_refs: { evidence_bundle: ref },
  options: {
    population: { declared_total: n, complete: true },
    requested_claims,
  },
};
// EXEC652-002: per-run host selection — bind this evaluation's registry
// entries to the evaluated bundle's exact source pin. The store keeps
// the full multi-bundle master registry; handing it over whole charges
// every registered entry against the 64-candidate budget at admission
// (296 candidates) and refuses every bundle with BUDGET_EXCEEDED
// (WB-001). Mirrors registryFor() in tests/research.test.js and
// corpus/make-battery.js: only the passages of THIS bundle are bound,
// each with applies_to rebound to this bundle's exact pin.
const provenance_registry = {};
for (const d of docs) {
  for (const p of d.passages || []) {
    const k = `${d.doc_id}|${p.passage_id}`;
    if (store.provenanceRegistry[k]) {
      provenance_registry[k] = { ...store.provenanceRegistry[k], applies_to: [{ ...ref }] };
    }
  }
}

const context = {
  clock: Date.now(),
  sources: { [key]: store.sources[key] },
  readGrants: [{ repo: ref.repo, path: ref.path }],
  principal: store.principals.jason,
  criteria: store.criteriaPresets.standard,
  provenance_registry,
};

const result = await runGuarded(JSON.stringify(task), JSON.stringify(context));
const out = join(outdir, `${bundleName}-report.json`);
writeFileSync(out, JSON.stringify(result, null, 2));
console.log(`status=${result.status} claims=${(result.report?.claims ?? []).length} report -> ${out}`);
