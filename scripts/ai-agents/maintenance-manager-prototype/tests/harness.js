/**
 * harness.js — battery runner for the Maintenance Manager Agent prototype.
 *
 * verifyManifest(root): checks the pinned manifest (hashes, confined
 * paths, complete membership) and returns the corpus digest. Called only
 * AFTER the entrypoint's pre-import trust authentication.
 *
 * runBattery(root, {timeoutMs}): runs all frozen cases through the agent
 * — each in a worker thread under the host watchdog — and compares
 * structural output against the hand-derived expectations.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { normalize } from "node:path/posix";
import { pathToFileURL } from "node:url";
import { runCaseWithWatchdog, watchdogRefusal } from "./watchdog.js";

export class ManifestError extends Error {
  constructor(reason) {
    super(`manifest: ${reason}`);
    this.name = "ManifestError";
  }
}

const sha = (b) => createHash("sha256").update(b).digest("hex");

export async function verifyManifest(root) {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(root, "corpus", "manifest.json"), "utf8"));
  } catch {
    throw new ManifestError("corpus/manifest.json unreadable");
  }
  const files = manifest.files;
  if (!Array.isArray(files)) throw new ManifestError("manifest shape invalid");
  const seen = new Set();
  for (const e of files) {
    const p = e?.path;
    if (
      typeof p !== "string" || p.length === 0 || p.startsWith("/") || p.includes("\\") ||
      normalize(p) !== p || p.startsWith("..") || p.includes("../") || seen.has(p)
    ) {
      throw new ManifestError(`bad manifest entry: ${String(p)}`);
    }
    seen.add(p);
    let bytes;
    try {
      bytes = readFileSync(join(root, p));
    } catch {
      throw new ManifestError(`missing pinned file: ${p}`);
    }
    if (sha(bytes) !== e.sha256) throw new ManifestError(`hash mismatch: ${p}`);
  }
  const want = ["package.json", "README.md"];
  for (const dir of ["corpus", "src", "runner", "fixtures", "tests"]) {
    let names = [];
    try {
      names = readdirSync(join(root, dir)).filter((x) => !x.startsWith("."));
    } catch {
      throw new ManifestError(`missing directory: ${dir}`);
    }
    for (const f of names) {
      const p2 = `${dir}/${f}`;
      if (p2 === "corpus/manifest.json" || p2 === "corpus/corpus_digest.txt") continue;
      if (dir === "fixtures" || dir === "corpus") {
        if (f.endsWith(".json") || f.endsWith(".js")) want.push(p2);
      } else if (f.endsWith(".js")) {
        want.push(p2);
      }
    }
  }
  for (const p of want.sort()) {
    if (!seen.has(p)) throw new ManifestError(`unlisted file: ${p}`);
  }
  const canonical = JSON.stringify(
    files.filter((e) => e.path !== "package.json").map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha(Buffer.from(canonical, "utf8"));
  if (digest !== manifest.corpus_digest) throw new ManifestError("manifest corpus_digest does not match recomputed digest");
  const recorded = readFileSync(join(root, "corpus", "corpus_digest.txt"), "utf8").trim();
  if (recorded !== manifest.corpus_digest) throw new ManifestError("corpus_digest.txt does not match manifest digest");
  return { ok: true, corpusDigest: digest };
}

/** Structural projection of a result for expectation comparison. */
export function structuralOf(result) {
  const r = result.report ?? {};
  return {
    status: result.status,
    complete: result.complete,
    diagnostic_codes: (result.diagnostics ?? []).map((d) => d.code).sort(),
    quarantined_work_order_ids: (result.quarantined_sources ?? []).map((q) => q.work_order_id).sort(),
    source_ref_count: (result.source_refs ?? []).length,
    population: r.population ?? {},
    backlog: r.backlog ?? {},
    overdue: r.overdue ?? {},
    cancelled_count: r.cancelled_count ?? 0,
    pm_compliance: r.pm_compliance ?? {},
    integrity_findings: [...(r.integrity_findings ?? [])].map((f) => ({ code: f.code, record_type: f.record_type, record_id: f.record_id, citation_verification: f.citation?.verification ?? null })).sort((a, b) => (a.record_id < b.record_id ? -1 : 1)),
    header_comparisons: [...(r.header_comparisons ?? [])].map((h) => ({ claim_id: h.claim_id, metric: h.metric, claimed_value: h.claimed_value, computed_value: h.computed_value, evidence_state: h.evidence_state })).sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)),
    excluded_ids: r.excluded_ids ?? {},
    coverage: r.coverage ?? {},
  };
}

/** Context for one case: base fixture store + named principal/criteria +
 *  clock + optional overrides (for permission/mutation/tamper cases). */
export function buildContext(root, c) {
  const store = JSON.parse(readFileSync(join(root, "fixtures", "store.json"), "utf8"));
  const context = {
    clock: Date.parse(c.clock),
    sources: store.sourcesBySet[c.sourcesKey ?? c.set],
    readGrants: store.readGrantsBySet[c.grantsKey ?? c.set],
    principal: store.principals[c.principal ?? "jasonActive"],
    criteria: store.criteria[c.criteria ?? "standard"],
  };
  const ov = c.contextOverrides;
  if (ov) {
    if (ov.replaceSources) context.sources = ov.replaceSources;
    if (ov.replaceReadGrants) context.readGrants = ov.replaceReadGrants;
    if (ov.replacePrincipal) context.principal = ov.replacePrincipal;
    if (ov.replaceCriteria) context.criteria = ov.replaceCriteria;
    if (ov.removeGrants) {
      context.readGrants = context.readGrants.filter((g) => !ov.removeGrants.includes(`${g.repo}|${g.path}`));
    }
  }
  return context;
}

export async function runBattery(root, { timeoutMs = 5000 } = {}) {
  const v = await verifyManifest(root);
  const battery = JSON.parse(readFileSync(join(root, "corpus", "battery.json"), "utf8"));
  const outputs = [];
  for (const c of battery) {
    const context = buildContext(root, c);
    const t0 = Date.now();
    const outcome = await runCaseWithWatchdog(root, c.task, context, { timeoutMs, hang: c.hang === true });
    const elapsed = Date.now() - t0;
    let result;
    if (outcome.timeout) {
      result = watchdogRefusal(c.task, timeoutMs);
    } else if (outcome.ok) {
      result = outcome.result;
    } else {
      throw new Error(`worker failed for case ${c.case_id}: ${outcome.error}`);
    }
    outputs.push({
      case_id: c.case_id,
      category: c.category,
      expected: c.expected,
      result,
      structural: structuralOf(result),
      elapsedMs: elapsed,
    });
  }
  return { outputs, corpusDigest: v.corpusDigest };
}

/** Recursively sort object keys so JSON comparison ignores key order. */
export function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
    return out;
  }
  return v;
}

export function acceptanceMetrics(outputs) {
  let match = 0;
  const mismatches = [];
  const perClass = {};
  const norm = (v) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(v))));
  for (const o of outputs) {
    const ok = norm(o.structural) === norm(o.expected);
    if (ok) match++;
    else mismatches.push(o.case_id);
    const cls = perClass[o.category] ?? (perClass[o.category] = { total: 0, match: 0, mismatches: [] });
    cls.total++;
    if (ok) cls.match++;
    else cls.mismatches.push(o.case_id);
  }
  return { total: outputs.length, match, mismatches, perClass };
}

export { pathToFileURL };
