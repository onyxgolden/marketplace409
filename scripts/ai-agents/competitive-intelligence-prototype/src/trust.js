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
 *    digest (the approved root) is embedded below as APPROVED_ROOT_DIGEST.
 *    trust.js itself is the trust anchor and is NOT listed in the manifest —
 *    it is deployed by the trusted host, not authenticated by the corpus.
 *    verifyCorpusManifest must pass before any scored import in the runner.
 */

import { createHash } from "node:crypto";

/**
 * Approved root digest of corpus/manifest.json, set at freeze time by
 * corpus/freeze.js. Any edit to the corpus without re-freezing fails
 * verification. Placeholder fails closed: verification never passes with it.
 */
export const APPROVED_ROOT_DIGEST =
  "4048d9ef908965276928701dbb491b40ad055076e66296c7e43e0d6c009b89de";

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
export function createTrustedContext({ confirmedSet, admittedSources, forgeSnapshot, clock }) {
  return { confirmedSet, admittedSources, forgeSnapshot, clock };
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
  return errors;
}

/** Is this subject admitted? "forge" always; vendors must be confirmed. */
export function admitSubject(ctx, subject) {
  if (subject === "forge") return { ok: true };
  const vendors = ctx.confirmedSet.vendors.map((v) => v.vendor_id);
  if (!vendors.includes(subject)) {
    return { ok: false, reason: "SUBJECT_UNCONFIRMED", detail: `${subject} is not in the confirmed set` };
  }
  return { ok: true };
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
export function resolveCitation(ctx, source_id, vendor_id = null) {
  const source = ctx.admittedSources?.[source_id];
  if (!source) return { ok: false, reason: "SOURCE_UNVERIFIED", detail: `${source_id} is not an admitted source` };
  if (vendor_id !== null && source.vendor_id !== vendor_id) {
    return { ok: false, reason: "VENDOR_MISMATCH", detail: `${source_id} belongs to ${source.vendor_id}, not ${vendor_id}` };
  }
  if (source.access_status !== "ok") {
    return { ok: false, reason: "ACCESS_RESTRICTED", detail: `${source_id} access_status=${source.access_status}` };
  }
  return { ok: true, source, freshness: sourceFreshness(ctx, source) };
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
export function verifyCorpusManifest(manifest, readFile) {
  if (!isPlainObject(manifest) || !isPlainObject(manifest.files)) {
    return { ok: false, reason: "manifest_malformed" };
  }
  if (!HEX64.test(APPROVED_ROOT_DIGEST)) {
    return { ok: false, reason: "root_not_frozen", detail: "APPROVED_ROOT_DIGEST is a placeholder" };
  }
  const digest = manifestDigest(manifest.files);
  if (digest !== APPROVED_ROOT_DIGEST) {
    return {
      ok: false,
      reason: "root_digest_mismatch",
      detail: { expected: APPROVED_ROOT_DIGEST, got: digest },
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
