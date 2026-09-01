// FB-UI-1 requirement 7: manifest must record a screenshot hash. Hashes the FINAL screenshot buffer
// -- after redaction has been applied and verified -- never the pre-redaction pixels, so the hash
// recorded in the manifest is always a hash of exactly what a reviewer would see if they opened the
// stored file, with no way for an unredacted intermediate to be the thing actually fingerprinted.

import { createHash } from "node:crypto";

export function hashScreenshotBuffer(buffer) {
  if (!Buffer.isBuffer(buffer)) throw new TypeError("hashScreenshotBuffer requires a Buffer");
  return `sha256:${createHash("sha256").update(buffer).digest("hex")}`;
}
