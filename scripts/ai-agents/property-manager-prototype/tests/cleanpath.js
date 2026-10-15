/**
 * cleanpath.js — platform-independent clean relative path check.
 *
 * Rejects absolute paths, backslashes, dot segments, and empty segments.
 * Unlike node:path.normalize, this does not rewrite forward slashes on
 * Windows, so pinned manifest paths stay valid on every platform.
 * Test infrastructure only (not scored logic); node builtins only.
 */

export function isCleanRelPath(p) {
  if (typeof p !== "string" || p.length === 0) return false;
  if (p.startsWith("/") || p.includes("\\")) return false;
  if (p === ".." || p.startsWith("../") || p.includes("/../")) return false;
  return p.split("/").every((s) => s.length > 0 && s !== "." && s !== "..");
}
