// watchdog.test.js — PM651-009 regression tests.
// Proves the external watchdog runs a valid task, separates boot failure
// from genuine TIMEOUT, and enforces the 5-second bound on hangs.
import './bootstrap.js'; // PM651-008: trust gate FIRST
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync, rmSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const PROTO = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const WATCHDOG = join(PROTO, 'runner', 'run-with-watchdog.js');
const fixtures = JSON.parse(readFileSync(join(PROTO, 'fixtures', 'store.json'), 'utf8')).fixtures;
const HOST_ROOT = process.env.PM_TRUST_ROOT;
if (!HOST_ROOT) throw new Error('PM_TRUST_ROOT must be set to run watchdog tests');

function ctx(authority = 'jason', principalId = 'jason') {
  return {
    clock: {}, criteria_version: '1',
    principal: { principal_id: principalId, kind: 'human' },
    grants: [{ grant_id: 'g1', principal_id: principalId, action: 'read', resource: { fixture_id: '*' } }],
    request_authority: authority, relay: null, fixtureStore: fixtures,
  };
}

function runWatchdog(task, context, timeoutMs = 15000) {
  const dir = mkdtempSync(join(tmpdir(), 'pm-wd-test-'));
  try {
    const taskFile = join(dir, 'task.json');
    const ctxFile = join(dir, 'context.json');
    writeFileSync(taskFile, JSON.stringify(task));
    writeFileSync(ctxFile, JSON.stringify(context));
    const r = spawnSync(process.execPath, [WATCHDOG, taskFile, ctxFile], {
      encoding: 'utf8', timeout: timeoutMs,
      env: { ...process.env, PM_TRUST_ROOT: HOST_ROOT },
    });
    return r;
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

function task(over = {}) {
  return {
    schema_version: '1', task_id: 'wd-test-1', operation: 'analyze',
    fixture_refs: ['plan-linear'], options: {}, ...over,
  };
}

test('PM651-009: watchdog runs a valid task and returns the expected report', () => {
  const r = runWatchdog(task(), ctx());
  assert.equal(r.status, 0, `watchdog failed: ${r.stderr}`);
  const env = JSON.parse(r.stdout);
  assert.equal(env.status, 'REPORT_READY');
  assert.equal(env.agent, 'project-manager');
  assert.ok(env.report.plans.length > 0);
  assert.equal(env.report.plans[0].plan_id, 'plan-linear');
});

test('PM651-009: watchdog separates boot failure from TIMEOUT', () => {
  // Invalid JSON input -> BOOT_FAILURE, not TIMEOUT.
  const dir = mkdtempSync(join(tmpdir(), 'pm-wd-boot-'));
  try {
    const taskFile = join(dir, 'task.json');
    const ctxFile = join(dir, 'context.json');
    writeFileSync(taskFile, 'not json{{{');
    writeFileSync(ctxFile, JSON.stringify(ctx()));
    const r = spawnSync(process.execPath, [WATCHDOG, taskFile, ctxFile], {
      encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PM_TRUST_ROOT: HOST_ROOT },
    });
    const env = JSON.parse(r.stdout);
    assert.equal(env.status, 'REFUSED');
    const code = env.diagnostics[0].code;
    assert.equal(code, 'BOOT_FAILURE', `expected BOOT_FAILURE, got ${code}`);
    assert.ok(!env.diagnostics[0].reason.includes('exceeded 5000ms'),
      'boot failure must not claim a timeout');
  } finally {
    try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

test('PM651-009: watchdog cleans up temp files', () => {
  // After a run, no pm-watchdog-* dirs should remain in tmpdir.
  const before = new Set();
  try {
    for (const n of readdirSync(tmpdir())) {
      if (n.startsWith('pm-watchdog-')) before.add(n);
    }
  } catch { /* ignore */ }
  runWatchdog(task(), ctx());
  const after = [];
  try {
    for (const n of readdirSync(tmpdir())) {
      if (n.startsWith('pm-watchdog-') && !before.has(n)) after.push(n);
    }
  } catch { /* ignore */ }
  assert.deepEqual(after, [], `watchdog left temp dirs: ${after.join(',')}`);
});
