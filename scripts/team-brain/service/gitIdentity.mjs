// Team Brain slice 4 — Git identity primitives.
//
// Pure functions, no I/O. Git blob identity is SHA-1 over the header
// `blob <byte-length>\0` followed by the exact bytes; every readback in
// this slice recomputes it from the bytes actually returned, never from
// a blob hash a writer or adapter claims. Commit/head/blob pointers in
// P4 bindings are full 40-hex identities (brief Section 3); short or
// non-hex pointers are refused at the P4 boundary, even though the
// slice-1 machine itself accepts any nonempty string.

import { createHash } from "node:crypto";
import { fail, P4_CODES } from "./errors.mjs";

export const EMPTY_BLOB = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const FULL_HEX_40 = /^[0-9a-f]{40}$/;

export function isFullHex40(value) {
  return typeof value === "string" && FULL_HEX_40.test(value);
}

export function assertFullHex40(value, fieldName) {
  if (!isFullHex40(value)) {
    fail(P4_CODES.INVALID_GIT_IDENTITY, `P4 Git identity for ${fieldName} must be a full 40-hex SHA-1: ${JSON.stringify(value)}`, {
      field: fieldName,
      value,
    });
  }
  return value;
}

function toBuffer(bytes) {
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  fail(P4_CODES.INVALID_GIT_IDENTITY, "Git bytes must be a string, Buffer, or Uint8Array", {});
  return null;
}

// Recompute a Git blob SHA-1 from the exact bytes. The byte length in
// the header is the byte length, not the character count: multibyte
// UTF-8 content hashes differently from its JS string length.
export function gitBlobSha1(bytes) {
  const body = toBuffer(bytes);
  const header = Buffer.from(`blob ${body.length}\0`, "utf8");
  return createHash("sha1").update(Buffer.concat([header, body])).digest("hex");
}

export function sha256Hex(text) {
  return createHash("sha256").update(String(text), "utf8").digest("hex");
}

// Full artifact binding for a P4-published outcome: every pointer present
// and every hash pointer a full 40-hex identity. Repo/path stay the
// slice-1 nonempty-string rule; hashes get the strict rule.
export function assertFullArtifactBinding(artifact) {
  if (!artifact || typeof artifact !== "object") {
    fail(P4_CODES.INVALID_GIT_IDENTITY, "Artifact binding must be an object", {});
  }
  for (const field of ["repo", "path"]) {
    if (typeof artifact[field] !== "string" || artifact[field].trim() === "") {
      fail(P4_CODES.INVALID_GIT_IDENTITY, `Artifact binding missing required field: ${field}`, { field });
    }
  }
  for (const field of ["commit", "blob", "head"]) {
    assertFullHex40(artifact[field], `artifact.${field}`);
  }
  return artifact;
}
