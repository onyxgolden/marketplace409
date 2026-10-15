/**
 * harness.js — battery runner for the documentation prototype.
 *
 * verifyManifest(root): checks the pinned manifest (hashes, confined
 * paths, complete membership) and returns the corpus digest. Called only
 * AFTER the entrypoint's pre-import trust authentication.
 *
 * runBattery(root, {timeoutMs}): runs all 200 frozen cases through the
 * agent — each in a worker thread under the host watchdog — and compares
 * structural output against the hand-derived expectations. Cases flagged
 * diff_bound_check additionally get their proposed_diff applied by this
 * HOST validator to an in-memory copy of the pinned fixture doc: the
 * before lines must match exactly, only cited doc lines may change, and
 * every drifted claim's cited line must be covered by a hunk.
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

/** Structural projection of a drift result for expectation comparison. */
export function structuralOf(result) {
  const byId = (a, b) => (a.claim_id < b.claim_id ? -1 : a.claim_id > b.claim_id ? 1 : 0);
  return {
    status: result.status,
    proposal_id: result.proposal_id,
    claims: (result.claims ?? [])
      .map((c) => ({
        claim_id: c.claim_id,
        support_status: c.support_status,
        before: c.before,
        after: c.after,
        citations: (c.citations ?? []).map((x) => ({
          repo: x.repo,
          path: x.path,
          commit: String(x.commit).slice(0, 8),
          verification: x.verification,
          quoted_span: x.quoted_span,
        })),
        usage_citations: (c.usage_citations ?? []).map((x) => x.quoted_span),
      }))
      .sort(byId),
    excluded_claims: (result.excluded_claims ?? [])
      .map((e) => ({ claim_id: e.claim_id, reason_head: String(e.reason).split(":")[0] }))
      .sort(byId),
    diagnostic_codes: [...new Set((result.diagnostics ?? []).map((d) => d.code))].sort(),
    quarantined_paths: (result.quarantined_sources ?? []).map((q) => `${q.repo}|${q.path}`).sort(),
    uncertainty_codes: [...new Set((result.uncertainty_flags ?? []).map((u) => u.code))].sort(),
    diff: result.proposed_diff
      ? {
          hunks: result.proposed_diff.hunks.map((h) => ({
            start_line: h.start_line, end_line: h.end_line, before: h.before, after: h.after,
          })),
          no_change: result.proposed_diff.no_change === true,
        }
      : null,
    complete: result.complete === true,
  };
}

/**
 * Host-side diff-bound validator (host-only; the agent never applies diffs).
 * Applies proposed_diff hunks to an in-memory copy of the pinned fixture
 * doc text and verifies: before lines match exactly; only cited doc lines
 * change; every drifted claim's cited line is covered by a hunk; no file
 * is written. Returns {ok, reason?}.
 */
export function validateDiffBounds(result, task, fixtureDocText) {
  const diff = result.proposed_diff;
  if (!diff) return { ok: true };
  const lines = fixtureDocText.split("\n");
  const citedLines = new Set();
  for (const c of result.claims ?? []) {
    if (c.support_status !== "DRIFTED") continue;
    const cit = (c.citations ?? [])[0];
    void cit;
    // The cited doc line is the line containing the claim's before text.
    const idx = lines.findIndex((l) => l.includes(c.before));
    if (idx < 0) return { ok: false, reason: `drifted claim ${c.claim_id}: before text not found in fixture doc` };
    citedLines.add(idx);
  }
  const changedLines = new Set();
  const working = lines.slice();
  const hunks = [...diff.hunks].sort((a, b) => b.start_line - a.start_line); // descending: offsets stay valid
  for (const h of hunks) {
    const slice = working.slice(h.start_line, h.end_line);
    if (JSON.stringify(slice) !== JSON.stringify(h.before)) {
      return { ok: false, reason: `hunk [${h.start_line},${h.end_line}): before lines do not match fixture doc` };
    }
    for (let i = h.start_line; i < h.start_line + h.after.length; i++) changedLines.add(i);
    working.splice(h.start_line, h.end_line - h.start_line, ...h.after);
  }
  for (const idx of citedLines) {
    if (!changedLines.has(idx)) return { ok: false, reason: `drifted claim line ${idx + 1} not covered by any hunk` };
  }
  for (const idx of changedLines) {
    if (!citedLines.has(idx)) return { ok: false, reason: `hunk changed uncited line ${idx + 1}; diff exceeds cited bounds` };
  }
  return { ok: true };
}

/** Base context from fixtures, with per-case overrides applied. */
export function buildContext(root, c) {
  const store = JSON.parse(readFileSync(join(root, "fixtures", "store.json"), "utf8"));
  const grants = [];
  for (const k of Object.keys(store.sources)) {
    const [repo, path] = k.split("|");
    grants.push({ repo, path });
  }
  const context = { clock: Date.parse(c.clock), store, readGrants: grants };
  const ov = c.contextOverrides;
  if (ov && ov.removeGrants) {
    context.readGrants = context.readGrants.filter((g) => !ov.removeGrants.includes(`${g.repo}|${g.path}`));
  }
  return { context, store };
}

export async function runBattery(root, { timeoutMs = 5000 } = {}) {
  const v = await verifyManifest(root);
  const battery = JSON.parse(readFileSync(join(root, "corpus", "battery.json"), "utf8"));
  const outputs = [];
  for (const c of battery) {
    const { context, store } = buildContext(root, c);
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
    let diffBound = null;
    if (c.expected.diff_bound_check === true && result.status === "READY") {
      const ref = c.task.doc_ref;
      const text = store.sources[`${ref.repo}|${ref.path}`]?.revisions[ref.commit]?.text;
      if (typeof text !== "string") throw new Error(`fixture doc text missing for ${c.case_id}`);
      diffBound = validateDiffBounds(result, c.task, text);
    }
    outputs.push({
      case_id: c.case_id,
      category: c.category,
      expected: c.expected,
      result,
      structural: structuralOf(result),
      diffBound,
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
  const diffBoundFailures = [];
  const norm = (v) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(v))));
  for (const o of outputs) {
    const expectedStructural = {
      status: o.expected.status,
      proposal_id: o.expected.proposal_id,
      claims: o.expected.claims ?? [],
      excluded_claims: o.expected.excluded_claims ?? [],
      diagnostic_codes: o.expected.diagnostic_codes ?? [],
      quarantined_paths: o.expected.quarantined_paths ?? [],
      uncertainty_codes: o.expected.uncertainty_codes ?? [],
      diff: o.expected.diff ?? null,
      complete: o.expected.complete === true,
    };
    const ok = norm(o.structural) === norm(expectedStructural);
    if (ok) match++;
    else mismatches.push(o.case_id);
    if (o.diffBound && !o.diffBound.ok) diffBoundFailures.push({ case_id: o.case_id, reason: o.diffBound.reason });
    const cls = perClass[o.category] ?? (perClass[o.category] = { total: 0, match: 0, mismatches: [] });
    cls.total++;
    if (ok) cls.match++;
    else cls.mismatches.push(o.case_id);
  }
  return { total: outputs.length, match, mismatches, diffBoundFailures, perClass };
}

export { pathToFileURL };
