/**
 * harness.js — battery runner for the engineering-manager prototype.
 *
 * verifyManifest(root): checks the pinned manifest (hashes, confined paths,
 * complete membership) and returns the corpus digest. Called only AFTER the
 * entrypoint's pre-import trust authentication.
 *
 * runBattery(root): runs all 100 frozen cases through the planner and
 * compares structural output against the hand-derived expectations.
 * Returns {outputs, corpusDigest}.
 */

import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

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

function briefKey(ref) {
  return `${ref.repo}\0${ref.path}\0${ref.commit}`;
}

/** Structural projection of a planner result for expectation comparison. */
export function structuralOf(result) {
  const keyOf = new Map(result.nodes.map((n) => [n.task_id, n.local_key]));
  const nodes = {};
  for (const n of result.nodes) {
    nodes[n.local_key] = {
      state: n.state,
      blocking_codes: [...n.blocking_codes].sort(),
      routing_clearance: n.routing_clearance,
      dep_keys: n.dependencies.map((d) => keyOf.get(d) ?? `!unknown:${d.slice(0, 12)}`).sort(),
      assignment_authorized: n.assignment_authorized,
    };
  }
  return {
    status: result.status,
    planning_state: result.planning_state,
    approval_record_id: result.approval_ref ? result.approval_ref.record_id : null,
    node_count: result.nodes.length,
    edge_count: result.edges.length,
    nodes,
    edges: result.edges
      .map((e) => [keyOf.get(e.from) ?? "!unknown", keyOf.get(e.to) ?? "!unknown"])
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1)),
    gate_count: result.gate_status.length,
    gates_unresolved: result.gate_status.length === 0 ? undefined : result.gate_status.every((g) => g.status === "UNRESOLVED"),
    conflict_count: result.conflicts.length,
    diag_codes: [...new Set(result.diagnostics.map((d) => d.code))].sort(),
    quarantined: result.quarantined_sources.length,
    complete: result.complete,
  };
}

/** Check that the output node order is a valid topological order. */
export function isTopoValid(result) {
  const pos = new Map(result.nodes.map((n, i) => [n.task_id, i]));
  for (const e of result.edges) {
    if (!pos.has(e.from) || !pos.has(e.to)) return false;
    if (pos.get(e.from) >= pos.get(e.to)) return false;
  }
  return true;
}

export async function runBattery(root, plannerModule) {
  const v = await verifyManifest(root);
  const battery = JSON.parse(readFileSync(join(root, "corpus", "battery.json"), "utf8"));
  const outputs = [];
  for (const c of battery) {
    const briefs = {};
    if (c.fixture.brief) {
      briefs[briefKey(c.task.brief_ref)] = { brief: c.fixture.brief, blob: c.task.brief_ref.blob };
    }
    for (const r of c.fixture.related_briefs ?? []) {
      briefs[briefKey(r.brief_ref)] = { brief: r.brief, blob: r.brief_ref.blob };
    }
    const context = {
      clock: c.fixture.clock,
      briefs,
      approvals: c.fixture.approvals ?? [],
      owners: c.fixture.owners ?? [],
    };
    const t0 = Date.now();
    const result = plannerModule.run(c.task, context);
    const elapsed = Date.now() - t0;
    outputs.push({
      case_id: c.case_id,
      category: c.category,
      expected: c.expected,
      result,
      structural: structuralOf(result),
      topoValid: isTopoValid(result),
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
  const norm = (v) => JSON.stringify(sortKeys(JSON.parse(JSON.stringify(v, (k, x) => (x === undefined ? undefined : x)))));
  for (const o of outputs) {
    if (norm(o.structural) === norm(o.expected)) match++;
    else mismatches.push(o.case_id);
  }
  return { total: outputs.length, match, mismatches };
}

export { pathToFileURL };
