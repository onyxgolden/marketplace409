/**
 * harness.js — battery runner for the Document Agent prototype.
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
  const inv = (r.inventory ?? [])
    .map((d) => ({
      doc_id: d.doc_id,
      logical_id: d.logical_id,
      revision: d.revision,
      quarantined: d.quarantined,
      content_sha256: d.content_sha256,
      metadata_verification: [...(d.metadata_verification ?? [])].map((m) => ({ key: m.key, evidence_state: m.evidence_state })).sort((a, b) => (a.key < b.key ? -1 : 1)),
    }))
    .sort((a, b) => (a.doc_id < b.doc_id ? -1 : a.doc_id > b.doc_id ? 1 : 0));
  const dup = [...(r.duplicate_groups ?? [])].map((g) => ({ content_sha256: g.content_sha256, doc_ids: [...g.doc_ids].sort() })).sort((a, b) => (a.content_sha256 < b.content_sha256 ? -1 : 1));
  const ver = [...(r.version_conflicts ?? [])].map((v) => ({ type: v.type, logical_id: v.logical_id, doc_ids: [...v.doc_ids].sort() })).sort((a, b) => (a.logical_id < b.logical_id ? -1 : a.logical_id > b.logical_id ? 1 : a.type < b.type ? -1 : 1));
  const cl = r.checklist_results ?? {};
  const checklist = {
    overall: cl.overall,
    required_sections: [...(cl.required_sections ?? [])].map((s) => ({ section_id: s.section_id, present: s.present, evidence_state: s.evidence_state })).sort((a, b) => (a.section_id < b.section_id ? -1 : 1)),
    required_companions: [...(cl.required_companions ?? [])].map((s) => ({ logical_id: s.logical_id, present: s.present, evidence_state: s.evidence_state })).sort((a, b) => (a.logical_id < b.logical_id ? -1 : 1)),
  };
  const edges = [...(r.reference_edges ?? [])].map((e) => ({ ref_id: e.ref_id, status: e.status, evidence_state: e.evidence_state })).sort((a, b) => (a.ref_id < b.ref_id ? -1 : 1));
  const cycles = [...(r.cycles ?? [])].map((c) => ({ kind: c.kind, doc_ids: c.doc_ids, status: c.status })).sort((a, b) => (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : a.doc_ids.join(">") < b.doc_ids.join(">") ? -1 : 1));
  const conflicts = [...(r.cross_document_conflicts ?? [])]
    .map((c) => ({ subject: c.subject, property: c.property, scope: c.scope, assertion_ids: c.assertions.map((a) => a.assertion_id).sort() }))
    .sort((a, b) => `${a.subject}|${a.property}|${a.scope}` < `${b.subject}|${b.property}|${b.scope}` ? -1 : 1);
  return {
    status: result.status,
    complete: result.complete,
    diagnostic_codes: (result.diagnostics ?? []).map((d) => d.code).sort(),
    quarantined_doc_ids: (result.quarantined_sources ?? []).map((q) => q.doc_id).filter((x) => x !== undefined).sort(),
    quarantined_other: (result.quarantined_sources ?? []).filter((q) => q.doc_id === undefined).map((q) => `${q.repo}|${q.path}`).sort(),
    source_ref_count: (result.source_refs ?? []).length,
    inventory: inv,
    duplicate_groups: dup,
    version_conflicts: ver,
    checklist_results: checklist,
    reference_edges: edges,
    cycles,
    cross_document_conflicts: conflicts,
    excluded_ids: [...(r.excluded_ids ?? [])].map((e) => ({ doc_id: e.doc_id, reason: e.reason })).sort((a, b) => (a.doc_id < b.doc_id ? -1 : 1)),
    excluded_assertions: [...(r.excluded_assertions ?? [])].map((e) => ({ assertion_id: e.assertion_id, reason: e.reason })).sort((a, b) => (a.assertion_id < b.assertion_id ? -1 : 1)),
    coverage: r.coverage ?? {},
    population: r.population ?? {},
  };
}

/**
 * Minimal source/grant registry containing ONLY the given refs — not
 * the whole shared fixture store. DOC-002R fix: context validation is
 * now itself object-charged (one charge per registered source, per
 * revision, per read grant, plus the principal and criteria records),
 * so an always-identical dump of every fixture document-set ever
 * authored for the whole battery would exhaust the 64-object budget
 * before a single document is ever reached. A real host scopes context
 * to what one request needs; this mirrors that. (Same pattern as this
 * program's Customer Success CS-001 fix in the same review wave.)
 */
export function minimalRegistry(store, refs) {
  const sources = {};
  const readGrants = [];
  const seen = new Set();
  for (const ref of refs) {
    if (!ref) continue;
    const key = `${ref.repo}|${ref.path}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const entry = store.sources[key];
    if (entry) sources[key] = entry;
    readGrants.push({ repo: ref.repo, path: ref.path });
  }
  return { sources, readGrants };
}

/**
 * Discover the per-document content SourceRefs a document-set actually
 * names, by reading the document-set's OWN registered bytes directly
 * from the store (a plain dict lookup — this is test-harness setup, not
 * the scored agent path, so it is not itself budget-charged). Returns
 * [] if the document-set isn't resolvable or isn't valid JSON — in
 * that case the task will refuse before ever reaching per-document
 * content resolution anyway, so no content refs are needed in context.
 */
function discoverContentRefs(store, documentSetRef) {
  if (!documentSetRef) return [];
  const key = `${documentSetRef.repo}|${documentSetRef.path}`;
  const rev = store.sources[key]?.revisions?.[documentSetRef.commit];
  if (!rev || typeof rev.text !== "string") return [];
  try {
    const parsed = JSON.parse(rev.text);
    const docs = Array.isArray(parsed.documents) ? parsed.documents : [];
    return docs.map((d) => d && typeof d === "object" && d.content_ref).filter(Boolean);
  } catch {
    return [];
  }
}

/** Context for one case: minimal registry for the task's own checklist +
 *  document-set + each referenced document's content (plus any
 *  case-declared `extraRefs`), named principal/criteria, clock, and
 *  optional overrides (for permission/mutation/tamper/budget cases). */
export function buildContext(root, c) {
  const store = JSON.parse(readFileSync(join(root, "fixtures", "store.json"), "utf8"));
  const criteria = store.criteria[c.criteria ?? "standard"];
  const documentSetRef = c.task?.fixture_refs?.document_set ?? c.documentSetRef ?? null;
  const contentRefs = discoverContentRefs(store, documentSetRef);
  const neededRefs = [criteria.checklist_ref, documentSetRef, ...contentRefs, ...(c.extraRefs ?? [])];
  const { sources, readGrants } = minimalRegistry(store, neededRefs);
  const context = {
    clock: Date.parse(c.clock),
    sources,
    readGrants,
    principal: store.principals[c.principal ?? "jasonActive"],
    criteria,
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
    if (ov.addSources) context.sources = { ...context.sources, ...ov.addSources };
    if (ov.addReadGrants) context.readGrants = [...context.readGrants, ...ov.addReadGrants];
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
