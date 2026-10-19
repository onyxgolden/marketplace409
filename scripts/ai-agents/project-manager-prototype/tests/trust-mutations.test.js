// trust-mutations.test.js — PM651-008 mutation tests.
// Proves the trust bootstrap exits nonzero BEFORE any agent code runs
// for each tamper class. Uses a scratch copy to avoid touching the real tree.
// PM651-008: inline builtins-only trust verification BEFORE any agent import.
// Agent imports are DYNAMIC (await import).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const __PM_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function __pmVerifyTrust() {
  const hostRoot = process.env.PM_TRUST_ROOT;
  if (!hostRoot || !/^[0-9a-f]{64}$/.test(hostRoot)) {
    console.error('TRUST-BOOTSTRAP FAILED: no host trust root (set PM_TRUST_ROOT)');
    process.exit(1);
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(join(__PM_ROOT, 'corpus', 'manifest.json'), 'utf8'));
  } catch (e) {
    console.error(`TRUST-BOOTSTRAP FAILED: cannot read manifest: ${e.message}`);
    process.exit(1);
  }
  const canon = (v) => {
    if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
    if (v !== null && typeof v === 'object') {
      return '{' + Object.keys(v).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
    }
    return JSON.stringify(v);
  };
  const digest = createHash('sha256').update(canon(manifest), 'utf8').digest('hex');
  if (digest !== hostRoot) {
    console.error('TRUST-BOOTSTRAP FAILED: manifest digest mismatch');
    process.exit(1);
  }
  for (const entry of manifest) {
    if (!entry.path || !entry.sha256) {
      console.error('TRUST-BOOTSTRAP FAILED: manifest entry missing path/sha256');
      process.exit(1);
    }
    let data;
    try {
      data = readFileSync(join(__PM_ROOT, entry.path));
    } catch (e) {
      console.error(`TRUST-BOOTSTRAP FAILED: cannot read ${entry.path}`);
      process.exit(1);
    }
    const actual = createHash('sha256').update(data).digest('hex');
    if (actual !== entry.sha256) {
      console.error(`TRUST-BOOTSTRAP FAILED: hash mismatch ${entry.path}`);
      process.exit(1);
    }
  }
}
__pmVerifyTrust();

const PROTO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
// PM651-008: the host root must be propagated to scratch subprocesses.
const HOST_ROOT = process.env.PM_TRUST_ROOT;
if (!HOST_ROOT) throw new Error('PM_TRUST_ROOT must be set to run trust-mutation tests');

function scratch() {
  const dir = join(tmpdir(), `pm-trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  cpSync(PROTO, dir, { recursive: true, filter: (p) => !p.includes('node_modules') });
  return dir;
}

function runVerify(dir) {
  // Run verify() in the scratch dir with the host root supplied.
  return spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { verify } from './corpus/trust-bootstrap.js';
    verify(${JSON.stringify(HOST_ROOT)});
    console.log('VERIFY_OK');
  `], { cwd: dir, encoding: 'utf8', timeout: 10000 });
}

test('PM651-008: clean tree passes bootstrap', () => {
  const dir = scratch();
  try {
    // --verify-only isn't a real entrypoint; use a no-op that just verifies.
    // Instead, call verify() directly via a tiny script.
    const r = runVerify(dir);
    assert.equal(r.status, 0, `bootstrap failed on clean tree: ${r.stderr}`);
    assert.ok(r.stderr.includes('TRUST-BOOTSTRAP OK') || r.stdout.includes('VERIFY_OK'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PM651-008: tampered source file -> nonzero exit', () => {
  const dir = scratch();
  try {
    const p = join(dir, 'src', 'manager.js');
    writeFileSync(p, readFileSync(p, 'utf8') + '\n// tampered\n');
    const r = runVerify(dir);
    assert.notEqual(r.status, 0, 'bootstrap must fail on tampered file');
    assert.ok(r.stderr.includes('TRUST-BOOTSTRAP FAILED'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PM651-008: unlisted executable file -> nonzero exit', () => {
  const dir = scratch();
  try {
    writeFileSync(join(dir, 'src', 'evil.js'), 'console.log("evil");\n');
    const r = runVerify(dir);
    assert.notEqual(r.status, 0, 'bootstrap must fail on unlisted file');
    assert.ok(r.stderr.includes('unlisted file'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PM651-008: missing manifest entry -> nonzero exit', () => {
  const dir = scratch();
  try {
    const mp = join(dir, 'corpus', 'manifest.json');
    const m = JSON.parse(readFileSync(mp, 'utf8'));
    m.pop(); // remove last entry
    writeFileSync(mp, JSON.stringify(m, null, 2));
    const r = runVerify(dir);
    // The removed file is now unlisted -> should fail.
    assert.notEqual(r.status, 0, 'bootstrap must fail when manifest drops a file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PM651-008: canary in src/index.js does not execute via unit path', () => {
  // Verdict probe 1: append canary to src/index.js. The unit entrypoint
  // (via bootstrap) must fail BEFORE the canary executes.
  const dir = scratch();
  try {
    const p = join(dir, 'src', 'index.js');
    writeFileSync(p, readFileSync(p, 'utf8') + '\nconsole.log("PM651_REVIEW_CANARY");\n');
    const r = runVerify(dir);
    assert.notEqual(r.status, 0, 'bootstrap must fail on canaried file');
    assert.ok(!r.stdout.includes('PM651_REVIEW_CANARY'), 'canary must not execute');
    assert.ok(r.stderr.includes('TRUST-BOOTSTRAP FAILED'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PM651-008: manifest SHA updated without host root -> battery refuses', () => {
  // Verdict probe 2: update the file's SHA in the local manifest but leave
  // the digest. Without a host root, the battery must refuse. With the
  // (now-stale) host root, the digest mismatch must also refuse.
  const dir = scratch();
  try {
    const srcP = join(dir, 'src', 'index.js');
    writeFileSync(srcP, readFileSync(srcP, 'utf8') + '\n// canary\n');
    // Update the manifest SHA for src/index.js.
    const mp = join(dir, 'corpus', 'manifest.json');
    const m = JSON.parse(readFileSync(mp, 'utf8'));
    const entry = m.find((e) => e.path === 'src/index.js');
    entry.sha256 = createHash('sha256').update(readFileSync(srcP)).digest('hex');
    writeFileSync(mp, JSON.stringify(m, null, 2));
    // The manifest digest no longer matches the host root -> verify fails.
    const r = runVerify(dir);
    assert.notEqual(r.status, 0, 'bootstrap must fail when manifest digest != host root');
    assert.ok(r.stderr.includes('does not match host-approved root'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('PM651-008: battery without host root refuses to run', () => {
  // The battery must not run without a separately supplied host approval.
  const r = spawnSync(process.execPath, [join(PROTO, 'tests', 'run-battery.js')], {
    cwd: PROTO, encoding: 'utf8', timeout: 10000,
    env: { ...process.env, PM_TRUST_ROOT: '' },
  });
  assert.notEqual(r.status, 0, 'battery must refuse without host root');
  assert.ok(r.stderr.includes('no host trust root supplied'));
});

// PM651-008 (round 3): The verdict's canary probe (append console.log to
// corpus/trust-bootstrap.js, run node --test tests/index.test.js) is verified
// manually: the inline builtins-only verification in each test file detects
// the hash mismatch and exits before any in-corpus import. The canary never
// executes because trust-bootstrap.js is never imported (test files use
// inline verification + dynamic imports). See manual probe results in the
// fix-round report.
