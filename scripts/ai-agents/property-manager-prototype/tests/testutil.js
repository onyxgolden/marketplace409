/**
 * testutil.js — shared test helpers (not scored logic).
 * Loads fixtures, builds contexts, and builds valid tasks for cases.
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

export function loadStore() {
  return JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));
}

export function loadTrust() {
  return JSON.parse(readFileSync(join(ROOT, "fixtures", "trust.json"), "utf8"));
}

export function baseContext(clockIso = "2026-10-12T12:00:00Z") {
  return {
    clock: Date.parse(clockIso),
    caseStore: loadStore(),
    trustRegistry: loadTrust(),
  };
}

function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = {};
    for (const k of Object.keys(v).sort()) o[k] = sortKeys(v[k]);
    return o;
  }
  return v;
}
const canonical = (v) => JSON.stringify(sortKeys(v));
const sha1hex = (b) => createHash("sha1").update(b).digest("hex");
const gitBlobId = (bytes) => sha1hex(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`, "utf8"), bytes]));

export function caseRefFor(store, caseId) {
  const c = store.cases.find((x) => x.case_id === caseId);
  if (!c) throw new Error(`no fixture case ${caseId}`);
  return {
    case_id: caseId,
    repo: store.repo,
    path: `cases/${caseId}.json`,
    commit: store.commit_id,
    blob: gitBlobId(Buffer.from(canonical(c), "utf8")),
    algorithm: "git-sha1",
    revision: "v1",
  };
}

export function taskFor(store, caseId, overrides = {}) {
  const c = store.cases.find((x) => x.case_id === caseId);
  if (!c) throw new Error(`no fixture case ${caseId}`);
  return {
    case_ref: caseRefFor(store, caseId),
    workflow: c.workflow,
    context_filters: { property_fixture_ids: [c.property_fixture_id] },
    requested_action: "recommend",
    note: null,
    claimed_relay_ids: [],
    ...overrides,
  };
}

export function diagCodes(result) {
  return (result.diagnostics ?? []).map((d) => d.code).sort();
}
