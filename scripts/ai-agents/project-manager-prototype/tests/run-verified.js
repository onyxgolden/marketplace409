#!/usr/bin/env node
/**
 * run-verified.js — PM651-008 trusted entrypoint wrapper (fix round 6).
 *
 * Builtins-only. Authenticates the manifest against the host-supplied
 * PM_TRUST_ROOT, then verifies tests/run-tests.js bytes against the
 * authenticated manifest, BEFORE importing or executing any candidate code.
 *
 * This wrapper itself must be pinned in the manifest. Its own integrity
 * is established by the host invoking it from a trusted location.
 *
 * Usage: PM_TRUST_ROOT=<64-hex> node tests/run-verified.js
 */

import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const TRUST_ROOT = process.env.PM_TRUST_ROOT;
if (!TRUST_ROOT || !/^[0-9a-f]{64}$/.test(TRUST_ROOT)) {
  console.error('run-verified: PM_TRUST_ROOT must be a 64-hex manifest digest');
  process.exit(1);
}

// 1. Load and authenticate the manifest itself FIRST.
// No manifest entry is trusted until the manifest digest matches the host root.
let manifest;
try {
  manifest = JSON.parse(readFileSync(join(ROOT, 'corpus', 'manifest.json'), 'utf8'));
} catch (e) {
  console.error(`run-verified: cannot read manifest: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(manifest)) {
  console.error('run-verified: manifest must be an array of {path, sha256}');
  process.exit(1);
}

const manifestDigest = createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');
if (manifestDigest !== TRUST_ROOT) {
  console.error('run-verified: manifest digest mismatch — refusing before any candidate code');
  process.exit(1);
}

// 2. Verify the launcher bytes against the AUTHENTICATED manifest.
// The manifest is now trusted (digest matched the host root), so its
// entries can be used. No candidate code has executed yet.
const manifestMap = new Map();
for (const entry of manifest) {
  if (entry && typeof entry.path === 'string' && typeof entry.sha256 === 'string') {
    manifestMap.set(entry.path, entry.sha256);
  }
}

const launcherRel = 'tests/run-tests.js';
const expectedHash = manifestMap.get(launcherRel);
if (!expectedHash) {
  console.error(`run-verified: REFUSED — launcher not pinned: ${launcherRel}`);
  process.exit(1);
}

const launcherBytes = readFileSync(join(ROOT, launcherRel));
const actualHash = createHash('sha256').update(launcherBytes).digest('hex');
if (actualHash !== expectedHash) {
  console.error('run-verified: REFUSED — launcher hash mismatch before execution');
  process.exit(1);
}

// 3. Only now import the authenticated launcher. No candidate code ran before this point.
const launcherUrl = pathToFileURL(join(ROOT, launcherRel)).href;
await import(launcherUrl);
