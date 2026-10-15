/**
 * resolver.js — scoped fixture resolver.
 *
 * bundle_refs resolve ONLY through the host-supplied fixture registry
 * (context.fixtureStore). A ref names a real repository but that names
 * nothing: unless (repo, path, commit) matches a registered fixture the ref
 * is denied. The blob pin is recomputed as a Git blob SHA-1 over the
 * canonical JSON bytes of the fixture content (Git blob header, not plain
 * SHA-1). Refs outside the approved fixture roots (e.g. a live-ledger
 * probe) are refused as ACTION_DENIED before any read.
 *
 * FM-005 (round 5): resolveRef performs the registry lookup ONLY. It must
 * not traverse fixture content — no depth measurement, no canonicalization,
 * no blob-pin check. Those integrity traversals inspect candidate records
 * and therefore run in run() AFTER the consultation budget gate, which
 * refuses BUDGET_EXCEEDED before over-budget candidates are ever read.
 * The blob pin is verified by run() after the gate, over the bounded
 * candidate set.
 */

import { createHash } from "node:crypto";

export function gitBlobSha1(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

/**
 * Resolve one SourceRef. Returns {ok:true, fixture, sourceRef} or
 * {ok:false, code, reason}. fixture = {content, registered}.
 */
export function resolveRef(ref, store, approvedRepos) {
  if (!approvedRepos.includes(ref.repo)) {
    return {
      ok: false,
      code: "ACTION_DENIED",
      reason: `repo ${JSON.stringify(ref.repo)} is not an approved synthetic fixture root; live or external ledgers are never readable`,
    };
  }
  const fixtures = store && typeof store === "object" ? store.fixtures : null;
  if (!fixtures || typeof fixtures !== "object") {
    return { ok: false, code: "READ_DENIED", reason: "fixture store unavailable" };
  }
  let found = null;
  for (const id of Object.keys(fixtures)) {
    const f = fixtures[id];
    const sr = f && f.source_ref;
    if (
      sr &&
      sr.repo === ref.repo &&
      sr.path === ref.path &&
      sr.commit === ref.commit
    ) {
      found = { id, fixture: f };
      break;
    }
  }
  if (!found) {
    return {
      ok: false,
      code: "SOURCE_UNVERIFIED",
      reason: `no registered fixture for ${ref.repo} ${ref.path} @ ${ref.commit.slice(0, 12)}`,
    };
  }
  // FM-005 (round 5): return the fixture WITHOUT traversing its content.
  // Depth, byte-cap and blob-pin integrity checks are enforced by run()
  // after the consultation budget gate, over the bounded candidate set.
  return { ok: true, fixture: found.fixture, fixtureId: found.id, sourceRef: ref };
}
