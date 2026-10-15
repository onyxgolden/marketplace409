/**
 * trust.js — separately trusted host context and corpus authentication.
 *
 * Two jobs, both required before any scoring:
 *
 * 1. Trusted admission context (CI-001). The comparison core never trusts
 *    caller-supplied pins, subjects, or citations on their own. The host
 *    injects a trusted context carrying:
 *      - confirmedSet: the Jason-confirmed competitor set (vendors + digest)
 *      - admittedSources: the host's admitted source store (source_id -> ref)
 *      - forgeSnapshot: the host-verified FORGE repo pin (repo/commit/tree)
 *      - clock: the host's fixed "now" for freshness checks
 *    runComparison refuses without a valid trusted context.
 *
 * 2. Corpus authentication (CI-006). The fixture + expected-oracle + scorer +
 *    official-runner corpus is frozen into corpus/manifest.json. The manifest
 *    digest (the approved root) is HOST INPUT — it is passed to
 *    verifyCorpusManifest, never embedded in the corpus. The builtins-only
 *    launcher (runner/launch.js) authenticates every corpus byte before any
 *    corpus import executes. trust.js itself is IN the manifest: executable
 *    verifier code is never exempt from authentication by declaration.
 */

import { createHash } from "node:crypto";
import { LIMITS } from "./schemas.js";

export function sha256Hex(s) {
  return createHash("sha256").update(String(s), "utf8").digest("hex");
}

function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HEX64 = /^[0-9a-f]{64}$/;
const HEX40 = /^[0-9a-f]{40}$/;

/* ------------------------------------------------------------------ */
/* Trusted admission context (CI-001)                                  */
/* ------------------------------------------------------------------ */

/**
 * Build the host-injected trusted context. Pure data; the host vouches for
 * every field. Shape:
 *   {
 *     confirmedSet: { vendors: [{vendor_id, product_id}], digest: <64hex> },
 *     admittedSources: { <source_id>: <source ref> },
 *     forgeSnapshot: { repo, commit: <40hex>, tree },
 *     clock: <ISO date-time>
 *   }
 */
export function createTrustedContext({ confirmedSet, admittedSources, forgeSnapshot, forgeFileResolver = null, clock }) {
  return { confirmedSet, admittedSources, forgeSnapshot, forgeFileResolver, clock };
}

/** Canonical digest the confirmed set must carry (self-checking). */
export function confirmedSetDigest(vendors) {
  const canon = [...vendors]
    .map((v) => [v.vendor_id, v.product_id])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  return sha256Hex(JSON.stringify(canon));
}

/** Structural validation of the trusted context itself. Returns errors. */
export function validateTrustedContext(ctx) {
  const errors = [];
  if (!isPlainObject(ctx)) return ["trusted context must be an object"];
  const cs = ctx.confirmedSet;
  if (!isPlainObject(cs) || !Array.isArray(cs.vendors) || cs.vendors.length === 0) {
    errors.push("confirmedSet.vendors must be a non-empty array");
  } else {
    for (const v of cs.vendors) {
      if (!isPlainObject(v) || typeof v.vendor_id !== "string" || !v.vendor_id) {
        errors.push("confirmedSet vendor must carry vendor_id");
      }
    }
    if (typeof cs.digest !== "string" || !HEX64.test(cs.digest)) {
      errors.push("confirmedSet.digest must be 64-hex");
    } else if (cs.digest !== confirmedSetDigest(cs.vendors)) {
      errors.push("confirmedSet.digest does not match vendors (untrusted set)");
    }
  }
  if (!isPlainObject(ctx.admittedSources)) {
    errors.push("admittedSources must be an object");
  } else {
    // CI-006 round 4: fail fast on trusted-context shape BEFORE any
    // per-source enumeration or serialization. An oversized store
    // short-circuits here — the per-source loop below never runs on it.
    const sourceIds = Object.keys(ctx.admittedSources);
    if (sourceIds.length > LIMITS.maxTrustedSources) {
      return [...errors, `too many trusted sources: ${sourceIds.length} > ${LIMITS.maxTrustedSources}`];
    }
    // Bounded incremental byte accounting: per-source serialization with an
    // early abort, so total work stays within the byte budget instead of one
    // unbounded whole-store stringify before validation.
    let bytes = 2; // "{}"
    for (const sid of sourceIds) {
      let chunk;
      try {
        chunk =
          Buffer.byteLength(JSON.stringify(ctx.admittedSources[sid]), "utf8") +
          Buffer.byteLength(sid, "utf8") + 4;
      } catch {
        return [...errors, "admittedSources not serializable"];
      }
      bytes += chunk + (bytes > 2 ? 1 : 0);
      if (bytes > LIMITS.maxTrustedBytes) {
        return [...errors, `trusted sources exceed byte budget: > ${LIMITS.maxTrustedBytes}`];
      }
    }
    for (const [sid, ref] of Object.entries(ctx.admittedSources)) {
      if (!isPlainObject(ref) || ref.source_id !== sid) errors.push(`admitted source ${sid}: key/source_id mismatch`);
      if (typeof ref?.content_sha256 !== "string" || !HEX64.test(ref.content_sha256)) {
        errors.push(`admitted source ${sid}: content_sha256 must be 64-hex`);
      }
      if (!["ok", "restricted", "expired", "unverified"].includes(ref?.access_status)) {
        errors.push(`admitted source ${sid}: unknown access_status`);
      }
    }
  }
  const snap = ctx.forgeSnapshot;
  if (
    !isPlainObject(snap) ||
    typeof snap.repo !== "string" ||
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(snap.repo) ||
    typeof snap.commit !== "string" ||
    !HEX40.test(snap.commit) ||
    typeof snap.tree !== "string" ||
    !snap.tree
  ) {
    errors.push("forgeSnapshot must carry repo (owner/name), 40-hex commit, and tree");
  }
  if (typeof ctx.clock !== "string" || Number.isNaN(Date.parse(ctx.clock))) {
    errors.push("clock must be an ISO date-time string");
  }
  // CI-001: a supplied resolver must be a function; if absent, FORGE refs are
  // unsupported via resolveForgeRef (never silently admitted).
  if (ctx.forgeFileResolver != null && typeof ctx.forgeFileResolver !== "function") {
    errors.push("forgeFileResolver must be a function when provided");
  }
  return errors;
}

/** Is this subject admitted? "forge" always; vendors must be confirmed. */
export function admitSubject(ctx, subject) {
  if (subject === "forge") return { ok: true, vendor: null };
  const vendor = ctx.confirmedSet.vendors.find((v) => v.vendor_id === subject);
  if (!vendor) {
    return { ok: false, reason: "SUBJECT_UNCONFIRMED", detail: `${subject} is not in the confirmed set` };
  }
  // CI-001: return the confirmed vendor record so callers bind the exact
  // confirmed product/scope, not just vendor identity.
  return { ok: true, vendor };
}

/* ------------------------------------------------------------------ */
/* Exact scope contract (CI-001 round 4)                                */
/* ------------------------------------------------------------------ */

/**
 * The exact scope contract. A capability claim is scoped to a product in a
 * specific edition/platform/region/version. The product travels on the
 * cell's subject_ref (already bound to the confirmed vendor); the four
 * dimensions are required on the cell's scope. A scope that names a
 * product_id must agree with the subject binding — scope.product_id is
 * never optional-when-truthy. Unknown source applicability on any dimension
 * never becomes an exact scoped claim.
 */
export const SCOPE_DIMENSIONS = ["edition", "platform", "region", "version"];
export const SCOPE_FIELDS = ["product_id", ...SCOPE_DIMENSIONS];

/** The effective exact scope: all five fields, non-empty strings. */
export function validateExactScope(scope) {
  const errors = [];
  if (!isPlainObject(scope)) return ["scope must be an object"];
  for (const f of SCOPE_FIELDS) {
    if (typeof scope[f] !== "string" || !scope[f]) {
      errors.push(`scope.${f} is required (exact scope contract)`);
    }
  }
  return errors;
}

/**
 * Compare a source's applicability against an exact claimed scope.
 * Returns null when applicable, or {reason, detail}:
 *   APPLICABILITY_UNKNOWN — the source does not state this dimension, so it
 *     cannot ground an exact claim about it.
 *   APPLICABILITY_MISMATCH — the source states a different value.
 */
export function checkSourceApplicability(source, scope) {
  for (const dim of SCOPE_DIMENSIONS) {
    const v = source ? source[dim] : undefined;
    if (v === null || v === undefined || v === "") {
      return {
        reason: "APPLICABILITY_UNKNOWN",
        detail: `source ${source?.source_id ?? "?"} does not state ${dim}; unknown applicability cannot ground an exact ${scope[dim]} claim`,
      };
    }
    if (v !== scope[dim]) {
      return {
        reason: "APPLICABILITY_MISMATCH",
        detail: `source ${source?.source_id ?? "?"} is about ${dim}=${v}, not the claimed ${dim}=${scope[dim]}`,
      };
    }
  }
  return null;
}

/** The caller's forge_base_pin must exactly match the host-verified snapshot. */
export function admitForgePin(ctx, pin) {
  if (!isPlainObject(pin)) return { ok: false, reason: "FORGE_PIN_UNVERIFIED", detail: "pin must be an object" };
  const snap = ctx.forgeSnapshot;
  if (pin.repo !== snap.repo || pin.commit !== snap.commit || pin.tree !== snap.tree) {
    return { ok: false, reason: "FORGE_PIN_UNVERIFIED", detail: "pin does not match the host-verified snapshot" };
  }
  return { ok: true };
}

/**
 * Resolve a citation against the admitted source store.
 * vendor_id (optional): when given, the source's vendor must match.
 * Returns {ok, source, freshness} or {ok:false, reason}.
 * Reasons: SOURCE_UNVERIFIED | ACCESS_RESTRICTED | VENDOR_MISMATCH.
 */
/**
 * Resolve a citation against the admitted source store.
 *
 * CI-001: when the confirmed vendor record is supplied (or an expected
 * product_id), the admitted source must match BOTH the vendor_id and the
 * confirmed product_id. Vendor match alone does not prove the citation is
 * about the confirmed product/scope.
 *
 * CI-001 round 4: when expectedScope (the cell's exact claimed scope) is
 * supplied, the source's edition/platform/region/version applicability must
 * match it. A source about a different edition does not ground the cell;
 * unknown applicability never becomes an exact scoped claim.
 *
 * @param ctx trusted context
 * @param source_id the cited source
 * @param vendor_id expected vendor (string) or null
 * @param product_id expected confirmed product_id (string) or null
 * @param expectedScope exact claimed scope {product_id,edition,platform,region,version} or null
 */
export function resolveCitation(ctx, source_id, vendor_id = null, product_id = null, expectedScope = null) {
  const source = ctx.admittedSources?.[source_id];
  if (!source) return { ok: false, reason: "SOURCE_UNVERIFIED", detail: `${source_id} is not an admitted source` };
  if (vendor_id !== null && source.vendor_id !== vendor_id) {
    return { ok: false, reason: "VENDOR_MISMATCH", detail: `${source_id} belongs to ${source.vendor_id}, not ${vendor_id}` };
  }
  if (product_id !== null && product_id !== undefined && source.product_id !== product_id) {
    return {
      ok: false, reason: "PRODUCT_MISMATCH",
      detail: `${source_id} is about ${source.product_id ?? "unknown product"}, not confirmed product ${product_id}`,
    };
  }
  if (expectedScope !== null && expectedScope !== undefined) {
    const scopeErrors = validateExactScope(expectedScope);
    if (scopeErrors.length > 0) {
      return { ok: false, reason: "SCOPE_INVALID", detail: scopeErrors.join("; ") };
    }
    const appl = checkSourceApplicability(source, expectedScope);
    if (appl) return { ok: false, reason: appl.reason, detail: appl.detail };
  }
  if (source.access_status !== "ok") {
    return { ok: false, reason: "ACCESS_RESTRICTED", detail: `${source_id} access_status=${source.access_status}` };
  }
  return { ok: true, source, freshness: sourceFreshness(ctx, source) };
}

/**
 * Resolve one FORGE reference (path/blob/span) against the host's verified
 * repo-file resolver at the pinned tree (CI-001).
 *
 * A pin (repo+commit+tree) is snapshot IDENTITY, not proof the file exists.
 * The ref is verified only when:
 *   1. its repo and commit exactly match the trusted forgeSnapshot pin,
 *   2. the host-injected forgeFileResolver function confirms path/blob/span
 *      exist at that pinned tree.
 * A missing resolver, a pin mismatch, or a negative resolution all yield
 * ok:false — the FORGE grounding is unsupported/undetermined, never admitted.
 *
 * @param ctx trusted context (carries forgeSnapshot + forgeFileResolver)
 * @param ref { repo, path, commit, blob, line_span? }
 */
export function resolveForgeRef(ctx, ref) {
  const snap = ctx.forgeSnapshot;
  if (typeof ctx.forgeFileResolver !== "function") {
    return { ok: false, reason: "FORGE_RESOLVER_REQUIRED", detail: "no trusted forge file resolver on the context" };
  }
  if (!ref || typeof ref !== "object") {
    return { ok: false, reason: "FORGE_REF_INVALID", detail: "ref must be an object" };
  }
  if (ref.repo !== snap.repo || ref.commit !== snap.commit) {
    return {
      ok: false, reason: "FORGE_PIN_MISMATCH",
      detail: `ref pins ${ref.repo}@${ref.commit}, trusted snapshot is ${snap.repo}@${snap.commit}`,
    };
  }
  if (typeof ref.path !== "string" || !ref.path) {
    return { ok: false, reason: "FORGE_REF_INVALID", detail: "ref.path required" };
  }
  let resolved;
  try {
    resolved = ctx.forgeFileResolver({ repo: ref.repo, commit: ref.commit, path: ref.path, blob: ref.blob ?? null, line_span: ref.line_span ?? null });
  } catch (err) {
    return { ok: false, reason: "FORGE_RESOLVER_ERROR", detail: String(err && err.message ? err.message : err) };
  }
  if (!resolved || typeof resolved !== "object" || resolved.ok !== true) {
    return {
      ok: false, reason: "FORGE_REF_UNVERIFIED",
      detail: `resolver could not verify ${ref.path} at ${ref.commit.slice(0, 12)}: ${resolved && resolved.reason ? resolved.reason : "not found"}`,
    };
  }
  return { ok: true, ref };
}

/** Freshness of an admitted source against the trusted clock. */
export function sourceFreshness(ctx, source) {
  const accessed = Date.parse(source.accessed_at);
  const now = Date.parse(ctx.clock);
  if (Number.isNaN(accessed) || Number.isNaN(now)) return "unknown";
  const ageDays = (now - accessed) / 86400000;
  if (ageDays < 0) return "unknown"; // accessed in the future: unverifiable
  return ageDays > 180 ? "stale" : "fresh";
}

/* ------------------------------------------------------------------ */
/* Corpus authentication (CI-006)                                      */
/* ------------------------------------------------------------------ */

/** Canonical JSON with sorted keys, so digests are stable. */
export function canonicalize(v) {
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  if (isPlainObject(v)) {
    return `{${Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalize(v[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

/** Digest of a {path: sha256} file map — the approved root. */
export function manifestDigest(filesMap) {
  return sha256Hex(canonicalize(filesMap));
}

/**
 * Verify the corpus before any scored import.
 * manifest: parsed corpus/manifest.json ({files: {path: sha256}})
 * readFile: (path) -> file content string (throws or returns non-string on failure)
 * Fails closed on: placeholder digest, manifest tamper, missing/tampered file.
 */
/**
 * Verify the frozen corpus against a HOST-SUPPLIED approved root digest.
 *
 * CI-006: the digest is trusted host input (runner/launch.js reads it from
 * CI_APPROVED_ROOT_DIGEST), never a constant embedded in the corpus itself.
 * Without a 64-hex host digest, verification fails closed.
 */
export function verifyCorpusManifest(manifest, readFile, approvedRootDigest) {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.files)) {
    return { ok: false, reason: "manifest_malformed" };
  }
  if (typeof approvedRootDigest !== "string" || !HEX64.test(approvedRootDigest)) {
    return { ok: false, reason: "host_root_required", detail: "approved root digest is host input (CI_APPROVED_ROOT_DIGEST), not corpus content" };
  }
  const digest = manifestDigest(manifest.files);
  if (digest !== approvedRootDigest) {
    return {
      ok: false,
      reason: "root_digest_mismatch",
      detail: { expected: approvedRootDigest, got: digest },
    };
  }
  for (const [path, expected] of Object.entries(manifest.files)) {
    let content;
    try {
      content = readFile(path);
    } catch (e) {
      return { ok: false, reason: "read_failed", path };
    }
    if (typeof content !== "string") return { ok: false, reason: "missing_file", path };
    if (sha256Hex(content) !== expected) return { ok: false, reason: "file_tampered", path };
  }
  return { ok: true, files: Object.keys(manifest.files).length };
}
