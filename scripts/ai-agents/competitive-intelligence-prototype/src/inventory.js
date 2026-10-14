/**
 * inventory.js — FORGE repository grounding helpers per contract §6.
 *
 * Pure functions over a caller-supplied snapshot description. The core never
 * touches git itself; the host provides the pinned snapshot and the resolver
 * verifies paths. Statuses: implemented_on_main, reachable_in_code,
 * fixture_only, flag_disabled, migration_pending, runtime_verified,
 * deployment_verified, unknown.
 */

export const FORGE_STATUSES = [
  "implemented_on_main",
  "reachable_in_code",
  "fixture_only",
  "flag_disabled",
  "migration_pending",
  "runtime_verified",
  "deployment_verified",
  "unknown",
];

/**
 * Build a FORGE evidence record. All fields required except line_span.
 * repo/path/commit/blob must be exact; no moving refs.
 */
export function forgeEvidence({ repo, path, commit, blob, line_span = null, note = null }) {
  const errors = [];
  for (const [k, v] of Object.entries({ repo, path, commit, blob })) {
    if (typeof v !== "string" || v.length === 0) errors.push(`missing ${k}`);
  }
  if (commit && !/^[0-9a-f]{40}$/.test(commit)) errors.push("commit must be full 40-hex SHA");
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, evidence: { repo, path, commit, blob, line_span, note, attribution: "forge_code" } };
}

/**
 * Classify a FORGE finding. A "not found in searched paths" result is
 * unsupported/no-evidence, never verified-absent — unless the caller supplies
 * an explicit negative proof (incompatible behavior, complete bounded
 * inventory, or a behavior test supporting the negative).
 */
export function classifyForgeFinding({ searched_paths, found, negative_proof = null }) {
  if (found) {
    return { status: "implemented_on_main", basis: "exact path evidence supplied" };
  }
  if (negative_proof && negative_proof.type && negative_proof.detail) {
    return { status: "implemented_on_main", basis: null, negative: true, negative_proof };
  }
  return {
    status: "unknown",
    basis: `searched ${searched_paths?.length || 0} path(s); no evidence found is not verified absent`,
  };
}

/** The snapshot pin every report must carry. */
export function snapshotPin({ repo, commit, tree, pinned_at }) {
  if (!repo || !/^[0-9a-f]{40}$/.test(commit || "")) {
    return { ok: false, errors: ["repo and full commit SHA required"] };
  }
  return { ok: true, pin: { repo, commit, tree: tree || null, pinned_at: pinned_at || new Date().toISOString() } };
}
