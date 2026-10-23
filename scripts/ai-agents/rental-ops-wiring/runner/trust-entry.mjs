#!/usr/bin/env node
/**
 * trust-entry.mjs — the ONLY supported way to execute wiring code.
 *
 * Builtins only (node:crypto, node:fs, node:path, node:url): this
 * module never imports candidate code, so importing it cannot execute
 * anything untrusted. It authenticates the ENTIRE executable closure
 * before a single candidate byte is imported:
 *
 *   1. The host supplies a trust root OUTSIDE the candidate tree
 *      (RENTAL_OPS_TRUST_ROOT env, or --trust-root <hex>): the
 *      SHA-256 of the canonical runner/manifest.json bytes. A missing
 *      or mismatched root fails closed (exit 3) — the in-repo
 *      manifest is self-attesting and is never trusted on its own.
 *   2. Every file pinned in the manifest is hashed and compared.
 *      The requested entry itself must be a manifest-listed file:
 *      only authenticated members are ever discovered or executed.
 *   3. Only then is the entry dynamically imported, with the
 *      remaining argv forwarded.
 *
 * Why this exists (P666-004A): the previous entry imported
 * runner/bootstrap.mjs — candidate code — BEFORE verification, so a
 * canary appended to bootstrap.mjs executed before the digest
 * mismatch was ever noticed. Static pre-auth imports are the defect;
 * dynamic post-auth imports are the fix.
 *
 * Usage:
 *   RENTAL_OPS_TRUST_ROOT=<sha256 of runner/manifest.json> \
 *     node runner/trust-entry.mjs --entry tests/run-tests.js
 *   node runner/trust-entry.mjs --trust-root <hex> --entry runner/run-job.mjs \
 *     -- --config <host-config.json> --request <job-request.json>
 */
import { createHash, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, normalize, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const WIRING_ROOT = join(HERE, "..");
const REPO_ROOT = normalize(join(WIRING_ROOT, "..", "..", ".."));

export const TRUST_FAILURE_EXIT = 3;

function failClosed(reason) {
  return { ok: false, failures: [reason] };
}

/**
 * Authenticate the wiring closure rooted at `wiringRoot` against the
 * host-supplied `trustRoot` (hex SHA-256 of the canonical
 * manifest.json bytes). Reads files only; imports nothing.
 */
export function authenticateWiring({ wiringRoot = WIRING_ROOT, trustRoot } = {}) {
  if (typeof trustRoot !== "string" || trustRoot.length === 0) {
    return failClosed(
      "no host trust root: RENTAL_OPS_TRUST_ROOT is not set (or --trust-root was not given); " +
      "refusing to authenticate a self-attested manifest",
    );
  }
  const manifestPath = join(wiringRoot, "runner", "manifest.json");
  let manifestBytes;
  try {
    manifestBytes = readFileSync(manifestPath);
  } catch {
    return failClosed(`trust manifest unreadable: ${manifestPath}`);
  }
  const manifestDigest = createHash("sha256").update(manifestBytes).digest("hex");
  const presented = Buffer.from(String(trustRoot).trim().toLowerCase(), "utf8");
  const expected = Buffer.from(manifestDigest, "utf8");
  if (presented.length !== expected.length || !timingSafeEqual(presented, expected)) {
    return failClosed(
      "host trust root mismatch: runner/manifest.json does not match the host-pinned root — " +
      "the manifest (or the root) was tampered with or is stale",
    );
  }
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    return failClosed("trust manifest is not valid JSON");
  }
  const failures = [];
  for (const [rel, expectedDigest] of Object.entries(manifest.files ?? {})) {
    const path = normalize(join(wiringRoot, rel));
    if (path !== REPO_ROOT && !path.startsWith(REPO_ROOT + sep)) {
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
    if (actual !== expectedDigest) failures.push(`${rel}: digest mismatch`);
  }
  return { ok: failures.length === 0, failures, manifest };
}

function usage() {
  console.error("usage: node runner/trust-entry.mjs [--trust-root <hex>] --entry <manifest-relative-path> [-- args...]");
  console.error("       RENTAL_OPS_TRUST_ROOT=<sha256 of runner/manifest.json> also supplies the host root");
}

const invokedAsMain = process.argv[1] !== undefined
  && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (invokedAsMain) {
  const argv = process.argv.slice(2);
  const entryFlag = argv.indexOf("--entry");
  const rootFlag = argv.indexOf("--trust-root");
  const trustRoot = rootFlag >= 0 ? argv[rootFlag + 1] : process.env.RENTAL_OPS_TRUST_ROOT;
  const entry = entryFlag >= 0 ? argv[entryFlag + 1] : undefined;
  if (!entry) { usage(); process.exit(2); }
  const rest = entryFlag >= 0 ? argv.slice(entryFlag + 2) : [];
  const { ok, failures, manifest } = authenticateWiring({ trustRoot });
  if (!ok) {
    console.error(`trust-entry: trust authentication failed — ${failures.join("; ")}`);
    process.exit(TRUST_FAILURE_EXIT);
  }
  if (!Object.hasOwn(manifest.files ?? {}, entry)) {
    console.error(`trust-entry: entry '${entry}' is not an authenticated manifest member — refusing to execute`);
    process.exit(TRUST_FAILURE_EXIT);
  }
  const entryAbs = normalize(join(WIRING_ROOT, entry));
  if (entryAbs !== REPO_ROOT && !entryAbs.startsWith(REPO_ROOT + sep)) {
    console.error(`trust-entry: entry '${entry}' escapes the repository — refusing to execute`);
    process.exit(TRUST_FAILURE_EXIT);
  }
  process.argv = [process.argv[0], entryAbs, ...rest];
  await import(pathToFileURL(entryAbs).href);
}
