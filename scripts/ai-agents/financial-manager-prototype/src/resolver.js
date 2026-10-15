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
 */

import { createHash } from "node:crypto";
import { canonicalBytes } from "./canonical.js";

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
  const bytes = canonicalBytes(found.fixture.content);
  const recomputed = gitBlobSha1(bytes);
  if (recomputed !== ref.blob) {
    return {
      ok: false,
      code: "HASH_MISMATCH",
      reason: `blob pin mismatch for fixture ${found.id}: expected ${ref.blob.slice(0, 12)}, recomputed ${recomputed.slice(0, 12)}`,
    };
  }
  return { ok: true, fixture: found.fixture, fixtureId: found.id, sourceRef: ref };
}
