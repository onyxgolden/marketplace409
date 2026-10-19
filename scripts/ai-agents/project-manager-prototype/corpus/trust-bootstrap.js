// trust-bootstrap.js — PM651-008 trust root.
// Authenticates the manifest + all transitive bytes BEFORE any agent import.
// Builtins only (node:fs, node:crypto, node:path). Rejects unlisted
// executable files. Exits nonzero on any authentication failure, before
// any agent code is loaded.
//
// Usage: node trust-bootstrap.js <entrypoint> [args...]
//   Verifies manifest, then execs the entrypoint via a child process with
//   the verified files. The entrypoint itself must not import agent code
//   before calling verify().

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(new URL('..', import.meta.url).pathname);
const MANIFEST_PATH = join(ROOT, 'corpus', 'manifest.json');

function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

function fail(msg) {
  console.error(`TRUST-BOOTSTRAP FAILED: ${msg}`);
  process.exit(1);
}

/** Verify manifest + all listed files. Returns the manifest.
 * PM651-008: the manifest digest is compared against a separately supplied
 * host approval (PM_TRUST_ROOT env var). The local corpus_digest.txt is
 * NOT trusted — it is replaceable. Absent or mismatched root fails closed
 * before any agent code is imported.
 */
export function verify(expectedRoot) {
  const hostRoot = expectedRoot || process.env.PM_TRUST_ROOT;
  if (!hostRoot || typeof hostRoot !== 'string' || !/^[0-9a-f]{64}$/.test(hostRoot)) {
    fail('no host trust root supplied (set PM_TRUST_ROOT to the approved 64-hex manifest digest)');
  }
  let manifest;
  let manifestRaw;
  try {
    manifestRaw = readFileSync(MANIFEST_PATH, 'utf8');
    manifest = JSON.parse(manifestRaw);
  } catch (e) {
    fail(`cannot read manifest: ${e.message}`);
  }
  if (!Array.isArray(manifest)) fail('manifest is not an array');

  // Authenticate the manifest itself against the host root BEFORE trusting
  // any entry in it. The digest is sha256(canonical JSON of manifest),
  // computed with the same key-sorted canonicalization as freeze-corpus.js.
  // Implemented inline to keep the bootstrap builtins-only (no agent imports
  // before authentication).
  function canon(v) {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v !== null && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  }
  const actualDigest = sha256Hex(canon(manifest));
  if (actualDigest !== hostRoot) {
    fail(`manifest digest ${actualDigest} does not match host-approved root`);
  }

  const seen = new Set();
  for (const entry of manifest) {
    if (!entry.path || !entry.sha256) fail(`manifest entry missing path/sha256: ${JSON.stringify(entry)}`);
    if (seen.has(entry.path)) fail(`duplicate manifest path: ${entry.path}`);
    seen.add(entry.path);
    const fullPath = join(ROOT, entry.path);
    let data;
    try {
      data = readFileSync(fullPath);
    } catch (e) {
      fail(`cannot read listed file ${entry.path}: ${e.message}`);
    }
    const actual = sha256Hex(data);
    if (actual !== entry.sha256) {
      fail(`hash mismatch for ${entry.path}: expected ${entry.sha256}, got ${actual}`);
    }
  }

  // Reject unlisted executable files (.js) under src/, tests/, runner/, fixtures/, corpus/.
  const allowedDirs = ['src', 'tests', 'runner', 'fixtures', 'corpus'];
  const allowedExts = new Set(['.js', '.json', '.txt', '.md']);
  function walk(dir) {
    const out = [];
    for (const name of readdirSync(dir).sort()) {
      if (name === 'node_modules') continue;
      const p = join(dir, name);
      const st = statSync(p);
      if (st.isDirectory()) out.push(...walk(p));
      else out.push(p);
    }
    return out;
  }
  for (const d of allowedDirs) {
    const dirPath = join(ROOT, d);
    try {
      for (const f of walk(dirPath)) {
        const rel = relative(ROOT, f).replace(/\\/g, '/');
        // Skip the manifest itself and digest (they're verified separately).
        if (rel === 'corpus/manifest.json' || rel === 'corpus/corpus_digest.txt') continue;
        if (!seen.has(rel)) {
          fail(`unlisted file: ${rel} (not in manifest)`);
        }
        const ext = rel.slice(rel.lastIndexOf('.'));
        if (!allowedExts.has(ext)) {
          fail(`unlisted executable type: ${rel}`);
        }
      }
    } catch (e) {
      if (e.message.startsWith('TRUST-BOOTSTRAP')) throw e;
      // Directory doesn't exist — skip.
    }
  }

  console.error(`TRUST-BOOTSTRAP OK: ${manifest.length} files authenticated`);
  return manifest;
}

// If run directly: verify, then exec the entrypoint.
if (process.argv[1] && process.argv[1].endsWith('trust-bootstrap.js')) {
  const [, , entrypoint, ...args] = process.argv;
  if (!entrypoint) {
    console.error('Usage: node trust-bootstrap.js <entrypoint> [args...]');
    process.exit(1);
  }
  verify();
  // Exec the entrypoint in a child process. The entrypoint must call
  // verify() itself before importing agent code (defense in depth).
  const result = spawnSync(process.execPath, [resolve(ROOT, entrypoint), ...args], {
    stdio: 'inherit',
    cwd: ROOT,
  });
  process.exit(result.status ?? 1);
}
