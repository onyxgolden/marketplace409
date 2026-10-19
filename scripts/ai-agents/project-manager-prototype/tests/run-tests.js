#!/usr/bin/env node
/**
 * run-tests.js — PM651-008 trusted test launcher.
 *
 * Authenticates the manifest against the host-supplied PM_TRUST_ROOT,
 * rejects unlisted executable files in tests/, then runs the explicit
 * authenticated test list. An unlisted tests/*.test.js file can never
 * execute because we never use shell glob expansion.
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

// Load manifest and verify digest
const manifestPath = join(ROOT, 'corpus', 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch (e) {
  console.error(`run-tests: cannot read manifest: ${e.message}`);
  process.exit(1);
}

const manifestDigest = createHash('sha256')
  .update(JSON.stringify(manifest))
  .digest('hex');
if (manifestDigest !== TRUST_ROOT) {
  console.error(`run-tests: manifest digest mismatch`);
  process.exit(1);
}

// Get the authenticated test list from the manifest
const listedTests = manifest.tests || [];
if (!Array.isArray(listedTests) || listedTests.length === 0) {
  console.error('run-tests: manifest has no test list');
  process.exit(1);
}

// PM651-008: reject unlisted executable files BEFORE test discovery.
// List actual .test.js files and compare against the manifest.
const actualFiles = readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.test.js'))
  .sort();
const listedSet = new Set(listedTests);
const unlisted = actualFiles.filter(f => !listedSet.has(f));
if (unlisted.length > 0) {
  console.error(`run-tests: REFUSED — unlisted test files present: ${unlisted.join(', ')}`);
  process.exit(1);
}

// Also check for unlisted .js helpers that could be imported
const actualHelpers = readdirSync(TESTS_DIR)
  .filter(f => f.endsWith('.js') && !f.endsWith('.test.js') && f !== 'run-tests.js' && f !== 'run-battery.js' && f !== 'bootstrap.js');
const listedHelpers = new Set(manifest.testHelpers || []);
const unlistedHelpers = actualHelpers.filter(f => !listedHelpers.has(f));
if (unlistedHelpers.length > 0) {
  console.error(`run-tests: REFUSED — unlisted helper files present: ${unlistedHelpers.join(', ')}`);
  process.exit(1);
}

// Run the explicit authenticated list (no glob expansion)
const testPaths = listedTests.map(t => join(TESTS_DIR, t));
console.log(`run-tests: authenticated ${listedTests.length} tests, launching...`);
const result = spawnSync(process.execPath, ['--test', ...testPaths], {
  stdio: 'inherit',
  cwd: ROOT,
});
process.exit(result.status ?? 1);
