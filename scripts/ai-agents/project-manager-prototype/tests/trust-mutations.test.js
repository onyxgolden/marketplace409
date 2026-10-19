// trust-mutations.test.js — PM651-008 mutation tests.
// Proves the trust bootstrap exits nonzero BEFORE any agent code runs
// for each tamper class. Uses a scratch copy to avoid touching the real tree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROTO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');

function scratch() {
  const dir = join(tmpdir(), `pm-trust-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  cpSync(PROTO, dir, { recursive: true, filter: (p) => !p.includes('node_modules') });
  return dir;
}

function runBootstrap(dir) {
  return spawnSync(process.execPath, [join(dir, 'corpus', 'trust-bootstrap.js'), '--verify-only'], {
    cwd: dir, encoding: 'utf8', timeout: 10000,
  });
}

test('PM651-008: clean tree passes bootstrap', () => {
  const dir = scratch();
  try {
    // --verify-only isn't a real entrypoint; use a no-op that just verifies.
    // Instead, call verify() directly via a tiny script.
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { verify } from './corpus/trust-bootstrap.js';
      verify();
      console.log('VERIFY_OK');
    `], { cwd: dir, encoding: 'utf8', timeout: 10000 });
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
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { verify } from './corpus/trust-bootstrap.js';
      verify();
    `], { cwd: dir, encoding: 'utf8', timeout: 10000 });
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
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { verify } from './corpus/trust-bootstrap.js';
      verify();
    `], { cwd: dir, encoding: 'utf8', timeout: 10000 });
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
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', `
      import { verify } from './corpus/trust-bootstrap.js';
      verify();
    `], { cwd: dir, encoding: 'utf8', timeout: 10000 });
    // The removed file is now unlisted -> should fail.
    assert.notEqual(r.status, 0, 'bootstrap must fail when manifest drops a file');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
