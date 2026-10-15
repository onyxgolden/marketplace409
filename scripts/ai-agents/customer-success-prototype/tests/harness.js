/**
 * harness.js — battery runner for the Customer Success Agent prototype.
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
  const tr = (r.ticket_results ?? [])
    .map((t) => ({
      ticket_id: t.ticket_id,
      category: t.classification.category,
      secondary_categories: [...t.classification.secondary_categories].sort(),
      unknown_tags: [...t.classification.unknown_tags].sort(),
      priority: t.classification.priority,
      draft_count: t.drafts.length,
      suppression_reason: t.suppression_reason,
      routing_flag_codes: t.drafts.flatMap((d) => d.routing_flags.map((f) => f.code)).sort(),
    }))
    .sort((a, b) => (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0));
  const metricProj = (m) => ({ numerator: m.numerator, denominator: m.denominator, display: m.display, evidence_state: m.evidence_state });
  return {
    status: result.status,
    complete: result.complete,
    diagnostic_codes: (result.diagnostics ?? []).map((d) => d.code).sort(),
    quarantined_ticket_ids: (result.quarantined_sources ?? []).map((q) => q.ticket_id).filter((x) => x !== undefined).sort(),
    quarantined_other: (result.quarantined_sources ?? []).filter((q) => q.ticket_id === undefined).map((q) => `${q.repo}|${q.path}`).sort(),
    routing_flag_count: (result.routing_flags ?? []).length,
    source_ref_count: (result.source_refs ?? []).length,
    ticket_results: tr,
    metrics: {
      response_time: metricProj(r.metrics?.response_time ?? {}),
      resolution_time: metricProj(r.metrics?.resolution_time ?? {}),
      sla_compliance: metricProj(r.metrics?.sla_compliance ?? {}),
      csat_mean: metricProj(r.metrics?.csat_mean ?? {}),
      csat_positive_share: metricProj(r.metrics?.csat_positive_share ?? {}),
    },
    header_comparisons: [...(r.header_comparisons ?? [])].map((h) => ({ metric: h.metric, evidence_state: h.evidence_state })).sort((a, b) => (a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0)),
    pending_ids: [...(r.pending_ids ?? [])].sort(),
    excluded: [...(r.excluded_ids ?? [])].map((e) => ({ ticket_id: e.ticket_id, reason: e.reason })).sort((a, b) => (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0)),
    coverage: r.coverage ?? {},
    population: r.population ?? {},
  };
}

/** Context for one case: base fixture store + named principal/criteria +
 *  clock + optional overrides (for permission/mutation/tamper cases). */
export function buildContext(root, c) {
  const store = JSON.parse(readFileSync(join(root, "fixtures", "store.json"), "utf8"));
  const context = {
    clock: Date.parse(c.clock),
    sources: store.sources,
    readGrants: store.readGrants,
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
