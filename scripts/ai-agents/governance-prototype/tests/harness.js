/**
 * harness.js — battery runner for the governance prototype.
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

/** Structural projection of a governance result for expectation comparison. */
export function structuralOf(result) {
  const srt = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  return {
    status: result.status,
    validity: result.validity,
    classification: result.classification,
    complete: result.complete === true,
    diagnostic_codes: (result.diagnostics ?? []).map((d) => d.code).sort(srt),
    satisfied_req_ids: ((result.requirements ?? {}).satisfied ?? []).map((r) => r.requirement_id).sort(srt),
    outstanding_req_ids: ((result.requirements ?? {}).outstanding ?? []).map((r) => r.requirement_id).sort(srt),
    responsible_actor: result.responsible_actor ?? null,
    quarantined_count: (result.quarantined_sources ?? []).length,
    cited_rule_ids: (result.policy_rule_cited ?? []).map((c) => `${c.policy_id}@${c.version}#${c.rule_id}`).sort(srt),
    registration_refs: (result.registration_refs ?? []).slice().sort(srt),
    authorization_granted: result.authorization_granted === true,
    execution_performed: result.execution_performed === true,
  };
}

/** Deterministic shuffle (mulberry32) for order-independence checks. */
function shuffled(arr, seed) {
  const a = arr.slice();
  let s = seed >>> 0;
  const rnd = () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Base context from fixtures, with per-case overrides applied. */
export function buildContext(root, c) {
  const store = JSON.parse(readFileSync(join(root, "fixtures", "store.json"), "utf8"));
  const context = {
    clock: null, // set from values.json below
    principals: store.principals,
    policies: store.policies,
    registrations: store.registrations,
    verdicts: store.verdicts,
    agreements: store.agreements,
    relays: store.relays,
    heads: store.heads,
    readGrants: store.readGrants,
    blobs: store.blobs,
    evidence: store.evidence,
  };
  const values = JSON.parse(readFileSync(join(root, "fixtures", "values.json"), "utf8"));
  context.clock = values.clock;
  const ov = c.contextOverrides ?? c.mutate ?? null;
  if (ov) {
    if (ov.clock !== undefined) context.clock = ov.clock;
    if (ov.replacePolicies) context.policies = ov.replacePolicies;
    if (ov.replaceRegistrations) context.registrations = ov.replaceRegistrations;
    if (ov.addRegistrations) context.registrations = [...context.registrations, ...ov.addRegistrations];
    if (ov.removeRegistrationIds) context.registrations = context.registrations.filter((r) => !ov.removeRegistrationIds.includes(r.record_id));
    if (ov.replaceVerdicts) context.verdicts = ov.replaceVerdicts;
    if (ov.addVerdicts) context.verdicts = [...context.verdicts, ...ov.addVerdicts];
    if (ov.replaceAgreements) context.agreements = ov.replaceAgreements;
    if (ov.addAgreements) context.agreements = [...context.agreements, ...ov.addAgreements];
    if (ov.replaceRelays) context.relays = ov.replaceRelays;
    if (ov.addRelays) context.relays = [...context.relays, ...ov.addRelays];
    if (ov.replaceHeads) context.heads = ov.replaceHeads;
    if (ov.addHeads) context.heads = [...context.heads, ...ov.addHeads];
    if (ov.replaceBlobs) for (const [k, content] of Object.entries(ov.replaceBlobs)) context.blobs[k] = { content };
    if (ov.addBlobs) for (const [k, content] of Object.entries(ov.addBlobs)) context.blobs[k] = { content };
    if (ov.removeGrantPaths) context.readGrants = context.readGrants.filter((g) => !ov.removeGrantPaths.includes(g.path));
    if (ov.replaceGrants) context.readGrants = ov.replaceGrants;
    if (ov.replaceEvidence) context.evidence = ov.replaceEvidence;
    if (ov.addEvidence) context.evidence = { ...context.evidence, ...ov.addEvidence };
    if (ov.removePrincipalIds) context.principals = context.principals.filter((p) => !ov.removePrincipalIds.includes(p.principal_id));
    if (ov.reorder) {
      context.policies = shuffled(context.policies, 7);
      context.registrations = shuffled(context.registrations, 13);
      context.verdicts = shuffled(context.verdicts, 29);
      context.agreements = shuffled(context.agreements, 37);
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
      canonical: JSON.stringify(sortKeys(result)),
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
