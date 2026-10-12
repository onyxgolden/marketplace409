/**
 * harness.js — battery runner for the architecture-reviewer prototype.
 *
 * verifyManifest(root): checks the pinned manifest (hashes, confined paths,
 * complete membership) and returns the corpus digest. Called only AFTER the
 * entrypoint's pre-import trust authentication.
 *
 * runBattery(root, {timeoutMs}): runs all frozen cases through the
 * reviewer — each in a worker thread under the host watchdog — and
 * compares structural output against the hand-derived expectations.
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

const keyOf = (ref) => `${ref.repo}\0${ref.path}\0${ref.commit}`;

/** Structural projection of a review result for expectation comparison. */
export function structuralOf(result) {
  const findings = (result.findings ?? [])
    .map((f) => ({ check_id: f.check_id, severity: f.severity, validity: f.validity }))
    .sort((a, b) =>
      a.check_id < b.check_id ? -1 : a.check_id > b.check_id ? 1 : a.severity < b.severity ? -1 : 1
    );
  return {
    status: result.status,
    verdict: result.verdict_proposal ? result.verdict_proposal.value : null,
    advisory: result.advisory,
    authorization_granted: result.authorization_granted,
    finding_count: (result.findings ?? []).length,
    findings,
    contradiction_count: (result.contradictions ?? []).length,
    contradiction_checks: [...new Set((result.contradictions ?? []).map((c) => c.check_id))].sort(),
    coverage: {
      required: [...(result.coverage?.required ?? [])].sort(),
      verified: [...(result.coverage?.verified ?? [])].sort(),
      missing: [...(result.coverage?.missing ?? [])].sort(),
      unverifiable: [...(result.coverage?.unverifiable ?? [])].sort(),
    },
    diag_codes: [...new Set((result.diagnostics ?? []).map((d) => d.code))].sort(),
    quarantined: (result.quarantined_sources ?? []).length,
    complete: result.complete,
    gate_sufficient: result.gate ? result.gate.sufficient : null,
    routing_flags: [...(result.routing_flags ?? [])].sort(),
  };
}

export async function runBattery(root, { timeoutMs = 5000 } = {}) {
  const v = await verifyManifest(root);
  const battery = JSON.parse(readFileSync(join(root, "corpus", "battery.json"), "utf8"));
  const outputs = [];
  for (const c of battery) {
    const designs = {};
    if (c.task.design_ref && c.fixture.design != null) {
      designs[keyOf(c.task.design_ref)] = c.fixture.design;
    }
    if (c.fixture.denied === true && c.task.design_ref) {
      designs[keyOf(c.task.design_ref)] = { denied: true };
    }
    const context = {
      clock: c.fixture.clock,
      designs,
      principals: c.fixture.principals ?? [],
      gatePolicy: c.fixture.gatePolicy ?? {},
      verdicts: c.fixture.verdicts ?? [],
      agreements: c.fixture.agreements ?? [],
    };
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
