/**
 * harness.js — battery runner for the knowledge-vault prototype.
 *
 * verifyManifest(root): checks the pinned manifest (hashes, confined
 * paths, complete membership) and returns the corpus digest. Called only
 * AFTER the entrypoint's pre-import trust authentication.
 *
 * runBattery(root, {timeoutMs}): runs all 120 frozen cases through the
 * agent — each in a worker thread under the host watchdog — and compares
 * structural output against the hand-derived expectations.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, normalize } from "node:path";
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

/** Structural projection of an answer result for expectation comparison. */
export function structuralOf(result) {
  const byId = (a, b) => (a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0);
  return {
    status: result.status,
    confidence: result.confidence,
    claims: (result.claims ?? [])
      .map((c) => ({
        claim_id: c.claim_id,
        text: c.text,
        validity: c.validity,
        citation: {
          repo: c.citations[0]?.repo ?? null,
          path: c.citations[0]?.path ?? null,
          commit: c.citations[0]?.commit ?? null,
          verification: c.citations[0]?.verification ?? null,
          quoted_span: c.citations[0]?.quoted_span ?? null,
        },
      }))
      .sort(byId),
    contradiction_count: result.contradiction_count ?? 0,
    diagnostic_codes: (result.diagnostics ?? []).map((d) => d.code).sort(),
    quarantined_count: (result.quarantined_sources ?? []).length,
    quarantined_paths: (result.quarantined_sources ?? []).map((q) => `${q.repo}|${q.path}`).sort(),
    supersession_record_ids: (result.supersession_notes ?? []).map((n) => n.record_id).sort(),
    steward_flag_records: (result.steward_flags ?? []).map((f) => f.record_id).sort(),
  };
}

/** Base context from fixtures, with per-case overrides applied. */
export function buildContext(root, c) {
  const store = JSON.parse(readFileSync(join(root, "fixtures", "store.json"), "utf8"));
  const vocabulary = JSON.parse(readFileSync(join(root, "fixtures", "vocabulary.json"), "utf8"));
  const context = {
    clock: Date.parse(c.clock),
    vocabulary,
    sources: store.sources,
    readGrants: store.readGrants,
    stewards: store.stewards,
    registrations: store.registrations,
    supersessionRecords: store.supersessionRecords,
  };
  const ov = c.contextOverrides;
  if (ov) {
    if (ov.replaceSupersessionRecords) context.supersessionRecords = ov.replaceSupersessionRecords;
    if (ov.replaceVocabulary) context.vocabulary = ov.replaceVocabulary;
    if (ov.removeGrants) {
      context.readGrants = context.readGrants.filter(
        (g) => !ov.removeGrants.includes(`${g.repo}|${g.path}`)
      );
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
    const outcome = await runCaseWithWatchdog(root, c.task, context, { timeoutMs });
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
