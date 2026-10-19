// bootstrap.test.js — trust-root bootstrap mutation canaries (PC650-002).
// Spawns the bootstrap as a child; verifies refusal on tampering.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const digest = readFileSync(join(root, 'corpus', 'corpus_digest.txt'), 'utf8').trim();

function runBootstrap(args, envDigest) {
  return spawnSync(process.execPath, ['tests/bootstrap.js', ...args], {
    cwd: root,
    env: { ...process.env, PC_APPROVED_DIGEST: envDigest || digest },
    encoding: 'utf8',
  });
}

test('bootstrap refuses absent digest', () => {
  const r = spawnSync(process.execPath, ['tests/bootstrap.js', '--unit'], {
    cwd: root,
    env: { ...process.env, PC_APPROVED_DIGEST: '' },
    encoding: 'utf8',
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /PC_APPROVED_DIGEST/);
});

test('bootstrap refuses wrong digest', () => {
  const r = runBootstrap(['--unit'], '0'.repeat(64));
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /REFUSAL/);
});

test('bootstrap refuses tampered package.json', () => {
  const pkgPath = join(root, 'package.json');
  const orig = readFileSync(pkgPath, 'utf8');
  try {
    writeFileSync(pkgPath, orig.replace('"version":"1.0.0"', '"version":"9.9.9"'));
    const r = runBootstrap(['--unit']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /REFUSAL/);
  } finally {
    writeFileSync(pkgPath, orig);
  }
});

test('bootstrap refuses unlisted executable', () => {
  const evilPath = join(root, 'src', 'evil.js');
  try {
    writeFileSync(evilPath, 'console.log("evil");');
    const r = runBootstrap(['--unit']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unlisted/);
  } finally {
    try { unlinkSync(evilPath); } catch {}
  }
});
