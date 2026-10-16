/**
 * harness.js — battery runner for the marketing prototype.
 *
 * verifyManifest(root): checks the pinned manifest (hashes, confined
 * paths, complete membership) and returns the corpus digest. Called only
 * AFTER the entrypoint's pre-import trust authentication.
 *
 * project(result): structural projection of a run result, mirroring the
 * shape corpus/oracle.js derives for the frozen expectations.
 *
 * runBattery(root, {timeoutMs}): runs all 120 frozen cases — each in a
 * worker thread under the host watchdog — and returns structural outputs.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, normalize } from "node:path";
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
    files.map((e) => ({ path: e.path, sha256: e.sha256 }))
  );
  const digest = sha(Buffer.from(canonical, "utf8"));
  if (digest !== manifest.corpus_digest) throw new ManifestError("manifest corpus_digest does not match recomputed digest");
  const recorded = readFileSync(join(root, "corpus", "corpus_digest.txt"), "utf8").trim();
  if (recorded !== manifest.corpus_digest) throw new ManifestError("corpus_digest.txt does not match manifest digest");
  return { ok: true, corpusDigest: digest };
}

/** Structural projection of a run result — same shape as oracle.derive(). */
export function project(result) {
  const diagCodes = [...new Set(result.diagnostics.map((d) => d.code))].sort();
  if (result.status === "REFUSED") {
    return {
      status: "REFUSED",
      complete: false,
      diag_codes: diagCodes,
      campaigns: {},
      metrics: {},
      pooled: [],
      header: {},
      duplicates: {},
      exclusions_total: 0,
      quarantined: 0,
      quarantine_families: [],
      source_ref_count: 0,
      coverage: { campaigns: 0, events_seen: 0, events_used: 0 },
      unattached_drafts: 0,
    };
  }
  const r = result.report ?? {};
  const campaigns = {};
  for (const c of r.campaigns ?? []) {
    campaigns[c.campaign_id] = {
      classification: c.classification,
      currency: c.currency,
      draft_count: c.drafts.length,
      drafts_labeled: c.drafts.every((d) => typeof d.text === "string" && d.text.includes("DRAFT — NOT PUBLISHED")),
    };
  }
  const metrics = {};
  for (const m of r.metrics ?? []) {
    metrics[m.campaign_id] = {
      mode: m.mode,
      impressions: m.impressions,
      clicks: m.clicks,
      conversions: m.conversions,
      spend_minor: m.spend_minor,
      revenue_minor: m.revenue_minor,
      integrity: [...m.integrity_flags].sort(),
      metric_status: m.status,
      population_complete: m.population_complete,
      ctr: m.ctr.display,
      conv_rate: m.conversion_rate.display,
      roas: m.roas.display,
    };
  }
  const pooled = (r.pooled ?? []).map((p) => ({
    pool_id: p.pool_id,
    members: [...p.members].sort(),
    currency: p.currency,
    ctr: p.ctr.display,
    roas: p.roas.display,
    status: p.status,
  }));
  const header = {};
  for (const h of r.header_comparisons ?? []) header[h.claim_id] = { status: h.status, match: h.match };
  const duplicates = {};
  for (const g of r.duplicate_groups ?? []) duplicates[g.conversion_id] = { resolution: g.resolution, counted: g.counted };
  return {
    status: result.status,
    complete: result.complete,
    diag_codes: diagCodes,
    campaigns,
    metrics,
    pooled,
    header,
    duplicates,
    exclusions_total: (r.exclusions ?? []).reduce((n, e) => n + e.count, 0),
    quarantined: result.quarantined_sources.length,
    quarantine_families: [...new Set(result.quarantined_sources.map((q) => q.family))].sort(),
    source_ref_count: result.source_refs.length,
    coverage: {
      campaigns: r.coverage.campaigns,
      events_seen: r.coverage.events_seen,
      events_used: r.coverage.events_used,
    },
    unattached_drafts: (r.unattached_drafts ?? []).length,
  };
}

function contextFor(c) {
  // M640-007: the harness is the host. It injects the synthetic
  // registered source-membership table from the fixture store's own
  // source_refs (the host's separate registration record). The registry
  // carries the COMPLETE source identity tuple
  // (repo,path,commit,blob,algorithm,revision) — never a subset.
  const source_registry = {};
  for (const [fid, entry] of Object.entries(c.fixture.fixtures || {})) {
    if (entry?.source_ref) {
      const sr = entry.source_ref;
      source_registry[fid] = {
        repo: sr.repo,
        path: sr.path,
        commit: sr.commit,
        blob: sr.blob,
        algorithm: sr.algorithm,
        revision: sr.revision,
      };
    }
  }
  return {
    clock: c.fixture.clock,
    principal: c.fixture.principal,
    relays: c.fixture.relays ?? [],
    grants: c.fixture.grants,
    fixtures: c.fixture.fixtures,
    source_registry,
  };
}

export async function runBattery(root, { timeoutMs = 5000 } = {}) {
  const v = await verifyManifest(root);
  const battery = JSON.parse(readFileSync(join(root, "corpus", "battery.json"), "utf8"));
  const outputs = [];
  for (const c of battery) {
    const t0 = Date.now();
    const outcome = await runCaseWithWatchdog(root, c.task, contextFor(c), { timeoutMs });
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
      structural: project(result),
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
  const norm = (v) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(v))));
  for (const o of outputs) {
    if (norm(o.structural) === norm(o.expected)) match++;
    else mismatches.push(o.case_id);
  }
  return { total: outputs.length, match, mismatches };
}
