/**
 * canonical.js — deterministic JSON canonicalization and hashing helpers.
 * Pure Node 24 ESM, node:crypto only. No model calls, no I/O.
 */

import { createHash } from "node:crypto";

function sortValue(v) {
  if (Array.isArray(v)) return v.map(sortValue);
  if (v !== null && typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortValue(v[k]);
    return out;
  }
  return v;
}

/** Canonical JSON: sorted keys, no whitespace. Throws on undefined. */
export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

/** SHA-256 hex of the UTF-8 canonical JSON of value. */
export function sha256HexUtf8(value) {
  return createHash("sha256").update(Buffer.from(canonicalJson(value), "utf8")).digest("hex");
}

/** SHA-256 hex of raw UTF-8 text (not JSON-canonicalized). */
export function sha256HexText(text) {
  return createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");
}

/** Canonical JSON byte length (UTF-8). */
export function canonicalByteLength(value) {
  return Buffer.byteLength(canonicalJson(value), "utf8");
}

/** Git blob object ID: sha1("blob <byteLength>\0" + bytes). Returns 40 lowercase hex. */
export function gitBlobId(bytes) {
  const header = Buffer.from(`blob ${bytes.length}\0`, "utf8");
  return createHash("sha1").update(header).update(bytes).digest("hex");
}

/**
 * Deterministic fixture commit ID: sha1 of a namespaced seed.
 * These are fixture identifiers, NOT real Git commit objects — the
 * fixture store never claims Git commit semantics, only content
 * addressing of revision bytes. Returns 40 lowercase hex.
 */
export function fixtureCommitId(repo, path, bytes) {
  return createHash("sha1")
    .update(Buffer.from("tax-fixture-commit-v1|", "utf8"))
    .update(Buffer.from(repo, "utf8"))
    .update(Buffer.from("|", "utf8"))
    .update(Buffer.from(path, "utf8"))
    .update(Buffer.from("|", "utf8"))
    .update(bytes)
    .digest("hex");
}

/** Deep-clone via canonical JSON (detached snapshots). */
export function detached(value) {
  return JSON.parse(canonicalJson(value));
}

export const HEX40 = /^[0-9a-f]{40}$/;
export const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Canonical registry-entry digest: SHA-256 of the entry's full approved
 * content (topic identity, jurisdiction, steward/registration/review
 * bindings, and every claim's text/template/source pin under both
 * coverage blocks) — everything EXCEPT `entry_digest` itself (which would
 * be self-referential) and `registry_ref` (the entry's own provenance
 * pointer, verified separately by resolving it). Any change to scope,
 * jurisdiction, year ranges, intervals, or any claim's source/text/
 * template changes this digest, so the registration's bound digest
 * commits to the exact approved entry, not just matching ID strings.
 */
export function registryEntryDigest(entry) {
  const { entry_digest, registry_ref, ...content } = entry;
  return sha256HexUtf8(content);
}

/**
 * Canonical digest of a SourceRef's full six-field identity (repo, path,
 * commit, blob, algorithm, revision). Used to bind a registry entry's
 * `registry_ref` into its authenticated registration (TAX-002 residual):
 * `registryEntryDigest` deliberately excludes `registry_ref` from the
 * content it commits to, so without this separate binding a structurally
 * valid entry could swap its provenance pointer to a different, otherwise
 * legitimate, hash-correct fixture source while keeping the same
 * `entry_digest` and registration untouched. The registration must pin
 * exactly which source the entry is allowed to point to, not merely that
 * the entry's own digest is internally self-consistent.
 */
export function sourceRefDigest(ref) {
  return sha256HexUtf8(ref);
}
