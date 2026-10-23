/**
 * Authenticated runtime bootstrap for the rental-ops wiring.
 *
 * Before any wiring byte is imported for execution, every source file
 * is hashed and compared against the host-pinned manifest
 * (runner/manifest.json). A mismatch — tampered source, helper or
 * manifest — stops the run before a single candidate executes. In
 * production the manifest root itself is pinned outside the repo by
 * the host (the same pattern as the Research prototype's external
 * approved root); this in-repo copy is the slice's testable form.
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
