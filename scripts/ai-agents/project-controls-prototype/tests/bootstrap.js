// bootstrap.js — builtins-only trust bootstrap for the test entrypoints.
// Requires an externally supplied approved manifest digest (PC_APPROVED_DIGEST),
// authenticates package.json, the manifest and every listed file BEFORE any
// in-corpus import, rejects unlisted executables, then spawns the requested
// entrypoint as a child process. Both unit tests and the battery go through
// this gate; direct `node --test` or `node tests/run-battery.js` is not an
// authenticated entrypoint.
//
// Usage: PC_APPROVED_DIGEST=<sha256> node tests/bootstrap.js --unit
//        PC_APPROVED_DIGEST=<sha256> node tests/bootstrap.js --battery

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256File = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

function refuse(msg) {
  console.error(`BOOTSTRAP REFUSAL: ${msg}`);
  process.exit(3);
}

// 1. Externally supplied approved digest is mandatory.
const approved = process.env.PC_APPROVED_DIGEST;
if (!approved || !/^[0-9a-f]{64}$/.test(approved)) {
  refuse('PC_APPROVED_DIGEST must be a 64-hex sha256 supplied by the host');
}

// 2. The manifest itself must match the host-approved digest.
const manifestPath = join(root, 'corpus', 'manifest.json');
let manifest;
try {
  manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
} catch {
  refuse('cannot read corpus/manifest.json');
}
if (sha256File(manifestPath) !== approved) {
  refuse('manifest digest does not match host-approved root');
}

// 3. package.json must be listed and authenticated before delegation.
if (!manifest.files || typeof manifest.files['package.json'] !== 'string') {
  refuse('package.json not pinned in manifest');
}
if (sha256File(join(root, 'package.json')) !== manifest.files['package.json']) {
  refuse('package.json hash mismatch');
}

// 4. Every manifest-listed file must match its pin.
for (const [rel, pinned] of Object.entries(manifest.files)) {
  const full = join(root, rel);
  let st;
  try { st = statSync(full); } catch { refuse(`listed file missing: ${rel}`); }
  if (!st.isFile()) refuse(`listed path not a file: ${rel}`);
  if (sha256File(full) !== pinned) refuse(`hash mismatch: ${rel}`);
}

// 5. Reject unlisted executable files: walk the tree; any .js file not in the
// manifest is unlisted. (Non-js data files are covered by the manifest too,
// but executables are the refusal trigger per the brief.)
const listed = new Set(Object.keys(manifest.files));
const unlistedJs = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git') continue;
    const full = join(dir, name);
    const rel = relative(root, full).split(sep).join('/');
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (st.isFile() && rel.endsWith('.js') && !listed.has(rel)) unlistedJs.push(rel);
  }
}
walk(root);
if (unlistedJs.length > 0) {
  refuse(`unlisted executable files present: ${unlistedJs.join(', ')}`);
}

console.log(`bootstrap: trust verified (${listed.size} files, root ${approved.slice(0, 12)}…)`);

// 6. Spawn the requested entrypoint as a child process.
const mode = process.argv[2];
let child;
if (mode === '--unit') {
  // Note: bootstrap.test.js is excluded (it spawns this bootstrap; recursion).
  child = spawnSync(process.execPath, ['--test', 'tests/admission.test.js', 'tests/canonical.test.js', 'tests/controls.test.js', 'tests/determinism.test.js', 'tests/findings.test.js', 'tests/injection.test.js', 'tests/resolver.test.js', 'tests/schemas.test.js', 'tests/spans.test.js', 'tests/watchdog.test.js'],
    { cwd: root, stdio: 'inherit', env: process.env });
} else if (mode === '--battery') {
  child = spawnSync(process.execPath, ['tests/run-battery.js'],
    { cwd: root, stdio: 'inherit', env: process.env });
} else {
  refuse('usage: node tests/bootstrap.js --unit | --battery');
}
process.exit(child.status ?? 1);
