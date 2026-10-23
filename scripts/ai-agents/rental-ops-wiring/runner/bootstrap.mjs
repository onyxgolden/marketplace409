/**
 * Manifest verification helpers for the rental-ops wiring.
 *
 * HISTORICAL NOTE (P666-004A): this module used to be the trust
 * entry — tests/run-tests.js, runner/run-job.mjs and
 * battery/run-battery.js imported it BEFORE verification, so a
 * canary appended to this very file executed before the digest
 * mismatch was noticed. It is NO LONGER an entry point:
 * runner/trust-entry.mjs (builtins only, host-supplied trust root)
 * authenticates the whole closure before any candidate module —
 * including this one — is imported. These helpers remain for
 * in-process re-verification only; they must never be statically
 * imported by an entry point.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING_ROOT = join(HERE, "..");
const REPO_ROOT = normalize(join(WIRING_ROOT, "..", "..", ".."));

export function verifyManifest() {
  const manifest = JSON.parse(readFileSync(join(HERE, "manifest.json"), "utf8"));
  const failures = [];
  for (const [rel, expected] of Object.entries(manifest.files)) {
    const path = normalize(join(WIRING_ROOT, rel));
    if (!path.startsWith(REPO_ROOT)) {
      failures.push(`${rel}: escapes the repository`);
      continue;
    }
    let actual;
    try {
      actual = createHash("sha256").update(readFileSync(path)).digest("hex");
    } catch {
      failures.push(`${rel}: unreadable`);
      continue;
    }
    if (actual !== expected) failures.push(`${rel}: digest mismatch`);
  }
  return { ok: failures.length === 0, failures, manifest };
}

export function assertManifest() {
  const { ok, failures } = verifyManifest();
  if (!ok) {
    console.error(`bootstrap: trust authentication failed — ${failures.join("; ")}`);
    process.exit(3);
  }
  console.log("bootstrap: trust authentication OK (manifest verified)");
}
