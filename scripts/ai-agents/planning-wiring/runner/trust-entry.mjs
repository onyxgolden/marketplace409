/**
 * Trust entry for the planning closure. Verifies the closure with
 * builtins ONLY (node:crypto, node:fs) before importing any
 * candidate module: every listed file must exist and hash to its
 * manifest entry, and the manifest itself must hash to the
 * host-supplied trust root. A missing file, a changed byte, or an
 * unlisted nested executable fails closed — nothing candidate runs.
 *
 * Manifest format (shared with the drop-owned launcher): `files` is
 * an OBJECT keyed by wiring-root-relative paths. This verifier
 * resolves them against the wiring root, same as the launcher.
 *
 * The supported first verifier is the drop-owned launcher OUTSIDE
 * the candidate tree (tools/trusted-launcher/launch.mjs), because
 * this file's own top-level code would execute before verification
 * if it were the entry point. This module is the in-tree verifier
 * for tests and the battery, which run under the drop launcher's
 * authentication.
 *
 * Usage: node runner/trust-entry.mjs <trust-root-sha256> <entry-path> [args...]
 * The entry path must be one of the manifest's listed keys.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING = resolve(HERE, "..");

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

export function verifyClosure(trustRoot) {
  const manifestText = readFileSync(join(HERE, "manifest.json"), "utf8");
  if (sha256(manifestText) !== trustRoot) {
    throw new Error(`trust root mismatch: manifest.json does not hash to the host-supplied trust root`);
  }
  const manifest = JSON.parse(manifestText);
  for (const [rel, expected] of Object.entries(manifest.files ?? {})) {
    const bytes = readFileSync(join(WIRING, rel));
    if (sha256(bytes) !== expected) {
      throw new Error(`closure file changed: ${rel}`);
    }
  }
  return manifest;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const [trustRoot, entry, ...rest] = process.argv.slice(2);
  if (!trustRoot || !entry) {
    console.error("usage: node runner/trust-entry.mjs <trust-root-sha256> <entry-path> [args...]");
    process.exit(2);
  }
  const manifest = verifyClosure(trustRoot);
  if (!Object.hasOwn(manifest.files ?? {}, entry)) {
    console.error(`entry not in authenticated closure: ${entry}`);
    process.exit(3);
  }
  const mod = await import(pathToFileURL(join(WIRING, entry)).href);
  if (typeof mod.main === "function") await mod.main(rest);
}
