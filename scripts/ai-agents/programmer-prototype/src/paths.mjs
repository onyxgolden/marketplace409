/**
 * paths.mjs — path normalization and allowlist validation.
 * Pure module: no I/O. Symlink/hardlink escapes are additionally rejected
 * by the snapshot reader (git mode 120000 entries) and at apply time.
 */

import { REASON } from "./constants.mjs";

const BINARY_EXTS = new Set([
  ".exe", ".dll", ".so", ".dylib", ".bin", ".o", ".a", ".class",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".pdf",
  ".zip", ".tar", ".gz", ".tgz", ".7z", ".mp4", ".mp3",
]);

const SENSITIVE_SEGMENT_RES = [
  /(^|\.)env($|[.-])/i, // .env, .env.local
  /credential/i,
  /secret/i,
  /\.pem$/i,
  /\.key$/i,
];

const DENIED_EXACT = new Set([
  "package.json",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "dockerfile",
]);

const DENIED_PREFIXES = [".git/", ".github/"];
const DENIED_SEGMENTS = new Set([".git", ".github", "node_modules", "test", "tests", "__tests__"]);

function hasLoneSurrogate(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return true;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/** Normalize to posix-style relative path; returns null when unfixable. */
export function normalizePath(p) {
  if (typeof p !== "string" || p.length === 0 || p.length > 512) return null;
  if (p.includes("\0") || hasLoneSurrogate(p)) return null;
  let s = p.replace(/\\/g, "/");
  // Reject absolute / drive / UNC before normalization.
  if (s.startsWith("/") || /^[a-zA-Z]:/.test(s) || s.startsWith("//")) return null;
  const parts = [];
  for (const seg of s.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") return null; // traversal rejected, never resolved
    parts.push(seg);
  }
  if (parts.length === 0) return null;
  return parts.join("/");
}

function extOf(name) {
  const i = name.lastIndexOf(".");
  return i >= 0 ? name.slice(i).toLowerCase() : "";
}

/**
 * Validate a normalized-or-raw candidate target path.
 * Returns { ok:true, path } or { ok:false, reason, detail }.
 * `existingLower` is a Set of lower-cased existing snapshot paths for
 * case-collision detection (pass null to skip).
 */
export function validateTargetPath(raw, existingLower = null) {
  const path = normalizePath(raw);
  if (!path) return { ok: false, reason: REASON.PATH_REJECTED, detail: "not-a-safe-relative-path" };
  const segments = path.split("/");
  for (const seg of segments) {
    if (DENIED_SEGMENTS.has(seg.toLowerCase())) {
      return { ok: false, reason: REASON.PATH_REJECTED, detail: `denied-segment:${seg}` };
    }
  }
  const lower = path.toLowerCase();
  for (const pre of DENIED_PREFIXES) {
    if (lower.startsWith(pre)) return { ok: false, reason: REASON.PATH_REJECTED, detail: `denied-prefix:${pre}` };
  }
  const base = segments[segments.length - 1];
  if (DENIED_EXACT.has(base.toLowerCase())) {
    return { ok: false, reason: REASON.PATH_REJECTED, detail: `denied-file:${base}` };
  }
  for (const re of SENSITIVE_SEGMENT_RES) {
    if (segments.some((s) => re.test(s))) {
      return { ok: false, reason: REASON.PATH_REJECTED, detail: "sensitive-name" };
    }
  }
  if (BINARY_EXTS.has(extOf(base))) {
    return { ok: false, reason: REASON.OPERATION_FORBIDDEN, detail: "binary-content-out-of-scope" };
  }
  // Oracle/test weakening: candidate trees never contain these.
  if (/oracle/i.test(path) || /\.test\.[mc]?js$/i.test(base) || /(^|\/)tests?\//i.test(path)) {
    return { ok: false, reason: REASON.ORACLE_TAMPER, detail: "oracle-or-test-path" };
  }
  if (existingLower && existingLower.has(lower) && !existingLower.has(path)) {
    return { ok: false, reason: REASON.PATH_REJECTED, detail: "case-collision" };
  }
  return { ok: true, path };
}

/**
 * Validate a new file's parent directory: must exist in the snapshot and be
 * on the safe-parent allowlist for the family.
 */
export function validateNewParent(dirPath, existingDirsLower, safeParents) {
  const norm = normalizePath(dirPath);
  if (!norm) return { ok: false, reason: REASON.PATH_REJECTED, detail: "bad-parent" };
  if (!safeParents.includes(norm)) {
    return { ok: false, reason: REASON.PATH_REJECTED, detail: `parent-not-allowlisted:${norm}` };
  }
  if (!existingDirsLower.has(norm.toLowerCase())) {
    return { ok: false, reason: REASON.PATH_REJECTED, detail: `parent-missing:${norm}` };
  }
  return { ok: true, path: norm };
}
