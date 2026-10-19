#!/usr/bin/env node
/**
 * run-tests.js — PM651-008 trusted test launcher (fix round 5).
 *
 * Works with the actual manifest format: an array of {path, sha256}.
 * 
 * 1. Authenticates the manifest digest against host-supplied PM_TRUST_ROOT.
 * 2. Verifies every tests/*.test.js file is listed in the manifest with
 *    a matching SHA-256 hash (builtins-only, before any test imports).
 * 3. Rejects unlisted .test.js files.
 * 4. Runs the authenticated test list explicitly (no shell glob).
 *
 * Usage: PM_TRUST_ROOT=<64-hex> node tests/run-tests.js
 */

import { readdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TESTS_DIR = join(ROOT, 'tests');

const TRUST_ROOT = process.env.PM_TRUST_ROOT;
if (!TRUST_ROOT || !/^[0-9a-f]{64}$/.test(TRUST_ROOT)) {
  console.error('run-tests: PM_TRUST_ROOT must be a 64-hex manifest digest');
  process.exit(1);
}

// Load manifest (array of {path, sha256}) and verify digest.
// Use canonical JSON serialization for the digest.
const manifestPath = join(ROOT, 'corpus', 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`run-tests: cannot read manifest: ${e.message}`);
  process.exit(1);
}
if (!Array.isArray(manifest)) {
  console.error('run-tests: manifest must be an array of {path, sha256}');
  process.exit(1);
}

const manifestDigest = createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');
if (manifestDigest !== TRUST_ROOT) {
  console.error('run-tests: manifest digest mismatch');
  process.exit(1);
}

// Build path -> sha256 map from the manifest.
const manifestMap = new Map();
for (const entry of manifest) {
  if (entry && typeof entry.path === 'string' && typeof entry.sha256 === 'string') {
    manifestMap.set(entry.path, entry.sha256);
  }
}

const sha256File = (absPath) => {
  return createHash('sha256').update(readFileSync(absPath)).digest('hex');
};

// PM651-008: authenticate every tests/*.test.js file BEFORE execution.
// Each must be listed in the manifest with a matching hash.
const actualTests = readdirSync(TESTS_DIR)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

const authenticatedTests = [];
for (const f of actualTests) {
  const relPath = `tests/${f}`;
  const expectedHash = manifestMap.get(relPath);
  if (!expectedHash) {
    console.error(`run-tests: REFUSED — unlisted test file: ${relPath}`);
    process.exit(1);
  }
  const actualHash = sha256File(join(TESTS_DIR, f));
  if (actualHash !== expectedHash) {
    console.error(`run-tests: REFUSED — hash mismatch: ${relPath}`);
    process.exit(1);
  }
  authenticatedTests.push(f);
}

if (authenticatedTests.length === 0) {
  console.error('run-tests: no authenticated tests found');
  process.exit(1);
}

// Also verify tests/run-tests.js itself is pinned (self-authentication).
const selfRel = 'tests/run-tests.js';
const selfExpected = manifestMap.get(selfRel);
if (!selfExpected) {
  console.error(`run-tests: REFUSED — launcher not pinned in manifest: ${selfRel}`);
  process.exit(1);
}
if (sha256File(join(TESTS_DIR, 'run-tests.js')) !== selfExpected) {
  console.error('run-tests: REFUSED — launcher hash mismatch');
  process.exit(1);
}

// Run the authenticated list explicitly (no glob expansion).
const testPaths = authenticatedTests.map((t) => join(TESTS_DIR, t));
console.log(`run-tests: authenticated ${authenticatedTests.length} tests, launching...`);
const result = spawnSync(process.execPath, ['--test', ...testPaths], {
  stdio: 'inherit',
  cwd: ROOT,
});
process.exit(result.status ?? 1);
