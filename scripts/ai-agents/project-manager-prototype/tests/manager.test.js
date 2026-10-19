// manager.test.js — focused domain-rule tests.
// PM651-008: inline builtins-only trust verification BEFORE any agent import.
// This code uses ONLY node:fs, node:crypto, node:path, node:url (builtins).
// It verifies the manifest digest against the host-supplied PM_TRUST_ROOT
// and every listed file hash. On failure, exits nonzero before any in-corpus
// module is evaluated. Agent imports below are DYNAMIC (await import) so
// they only execute after verification passes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, dirname } from 'node:path';
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

// Dynamic imports AFTER verification (PM651-008).
const { analyzePlan } = await import('../src/manager.js');
const { Resolver } = await import('../src/resolver.js');

function pkg(over = {}) {
  return {
    plan_id: 'p', project_start_tick: 0,
    tasks: [], edges: [], milestones: [], capacity_windows: [],
    header_claims: {}, ...over,
  };
}
function t(id, dur, o = {}) {
  return {
    task_id: id, workstream_id: 'ws', duration_ticks: dur,
    declared_start_tick: o.declared ?? null, release_tick: o.release ?? null,
    status: o.status || 'NOT_STARTED', resource_demands: o.demands || [], notes: o.notes || '',
  };
}
const E = (id, a, b, lag = 0) => ({ edge_id: id, from_task: a, to_task: b, lag_ticks: lag });
const M = (id, req, claimed = null) => ({ milestone_id: id, required_tasks: req, claimed_tick: claimed });
const W = (id, res, s, e, cap) => ({ window_id: id, resource_id: res, start_tick: s, end_tick: e, capacity: cap });
const D = (res, n, d = 1) => ({ resource_id: res, amount_num: n, amount_den: d });
const R = () => new Resolver({});

function codes(a) { return a.findings.map((f) => f.code); }

test('linear forward pass', () => {
  const a = analyzePlan(pkg({ tasks: [t('a', 4), t('b', 3)], edges: [E('e1', 'a', 'b')] }), R());
  assert.equal(a.status, 'REPORT_READY');
  assert.deepEqual(a.math.a, { es: 0, ef: 4 });
  assert.deepEqual(a.math.b, { es: 4, ef: 7 });
});

test('positive and negative lag', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4), t('b', 3), t('c', 2)],
    edges: [E('e1', 'a', 'b', 2), E('e2', 'b', 'c', -1)],
  }), R());
  assert.deepEqual(a.math.b, { es: 6, ef: 9 });
  assert.deepEqual(a.math.c, { es: 8, ef: 10 });
});

test('release_tick is a lower bound', () => {
  const a = analyzePlan(pkg({ tasks: [t('a', 4, { release: 10 })] }), R());
  assert.deepEqual(a.math.a, { es: 10, ef: 14 });
});

test('cycle -> PARTIAL, math null, BLOCKING_MATH', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 1), t('b', 1)], edges: [E('e1', 'a', 'b'), E('e2', 'b', 'a')],
  }), R());
  assert.equal(a.status, 'PARTIAL');
  assert.equal(a.math, null);
  assert.ok(codes(a).includes('CYCLE_DETECTED'));
  assert.equal(a.findings[0].severity, 'BLOCKING_MATH');
});

test('dangling edge -> PARTIAL, math null', () => {
  const a = analyzePlan(pkg({ tasks: [t('a', 1)], edges: [E('e1', 'a', 'ghost')] }), R());
  assert.equal(a.status, 'PARTIAL');
  assert.equal(a.math, null);
  assert.ok(codes(a).includes('DANGLING_DEPENDENCY'));
});

test('duplicate task id -> REFUSED', () => {
  const a = analyzePlan(pkg({ tasks: [t('a', 1), t('a', 2)] }), R());
  assert.equal(a.status, 'REFUSED');
});

test('duplicate edge id -> REFUSED', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 1), t('b', 1)], edges: [E('e1', 'a', 'b'), E('e1', 'a', 'b')],
  }), R());
  assert.equal(a.status, 'REFUSED');
});

test('orphan task reported with exact id', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 1), t('lonely', 1)], edges: [],
    milestones: [M('m1', ['a'], 1)],
  }), R());
  assert.deepEqual(a.orphans, ['lonely']);
  assert.ok(codes(a).includes('ORPHAN_TASKS'));
});

test('milestone earlier than feasible -> MISMATCH', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 6)], milestones: [M('m1', ['a'], 5)],
  }), R());
  assert.equal(a.milestones[0].assessment, 'MISMATCH');
  assert.equal(a.milestones[0].earliest_feasible_tick, 6);
});

test('milestone equal/later -> FEASIBLE', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 6)], milestones: [M('m1', ['a'], 6), M('m2', ['a'], 99)],
  }), R());
  assert.equal(a.milestones[0].assessment, 'FEASIBLE');
  assert.equal(a.milestones[1].assessment, 'FEASIBLE');
});

test('empty required_tasks -> UNVERIFIABLE', () => {
  const a = analyzePlan(pkg({ tasks: [t('a', 1)], milestones: [M('m1', [])] }), R());
  assert.equal(a.milestones[0].assessment, 'UNVERIFIABLE');
  assert.equal(a.milestones[0].earliest_feasible_tick, null);
});

test('claimed start violating predecessor bound flagged', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4), t('b', 2, { declared: 1 })],
    edges: [E('e1', 'a', 'b')],
  }), R());
  assert.ok(codes(a).includes('CLAIMED_START_VIOLATION'));
  assert.deepEqual(a.math.b, { es: 4, ef: 6 }); // network unchanged
});

test('resource overallocation detected', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { declared: 0, demands: [D('crew', 2)] }), t('b', 4, { declared: 0, demands: [D('crew', 2)] })],
    milestones: [M('m1', ['a', 'b'], 4)],
    capacity_windows: [W('w1', 'crew', 0, 10, 3)],
  }), R());
  assert.ok(codes(a).includes('RESOURCE_OVERALLOCATION'));
  assert.equal(a.resources[0].assessment, 'OVERALLOCATED');
});

test('abutting demands never overlap', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { declared: 0, demands: [D('crew', 3)] }), t('b', 4, { declared: 4, demands: [D('crew', 3)] })],
    edges: [E('e1', 'a', 'b')],
    milestones: [M('m1', ['b'], 8)],
    capacity_windows: [W('w1', 'crew', 0, 10, 3)],
  }), R());
  assert.ok(!codes(a).includes('RESOURCE_OVERALLOCATION'));
  assert.equal(a.resources[0].assessment, 'OK');
});

test('rational demands summed exactly', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { demands: [D('crew', 1, 2)] }), t('b', 4, { demands: [D('crew', 1, 2)] })],
    milestones: [M('m1', ['a', 'b'], 4)],
    capacity_windows: [W('w1', 'crew', 0, 10, 1)],
  }), R());
  assert.ok(!codes(a).includes('RESOURCE_OVERALLOCATION')); // 1/2+1/2 = 1 <= 1
});

test('overlapping capacity windows -> UNVERIFIABLE', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { demands: [D('crew', 1)] })],
    milestones: [M('m1', ['a'], 4)],
    capacity_windows: [W('w1', 'crew', 0, 6, 2), W('w2', 'crew', 4, 10, 2)],
  }), R());
  assert.ok(codes(a).includes('CAPACITY_WINDOW_OVERLAP'));
});

test('coverage gap -> UNVERIFIABLE', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 8, { declared: 0, demands: [D('crew', 1)] })],
    milestones: [M('m1', ['a'], 8)],
    capacity_windows: [W('w1', 'crew', 0, 4, 2)],
  }), R());
  assert.ok(codes(a).includes('CAPACITY_COVERAGE_GAP'));
});

test('missing declared start -> UNVERIFIABLE resource basis (PM651-004)', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { demands: [D('crew', 1)] })],
    milestones: [M('m1', ['a'], 4)],
    capacity_windows: [W('w1', 'crew', 0, 10, 1)],
  }), R());
  assert.ok(codes(a).includes('RESOURCE_NO_DECLARED_START'));
  assert.equal(a.resources[0].assessment, 'UNVERIFIABLE');
});

test('zero-duration milestone carries no demand; nonzero demand invalid', () => {
  const a = analyzePlan(pkg({
    tasks: [t('ms', 0, { demands: [D('crew', 1)] })],
    milestones: [M('m1', ['ms'], 0)],
  }), R());
  assert.ok(codes(a).includes('ZERO_DURATION_DEMAND'));
});

test('completion 6/10 and header 100% mismatch', () => {
  const tasks = Array.from({ length: 10 }, (_, i) =>
    t(`t${i}`, 1, { status: i < 6 ? 'COMPLETE' : 'NOT_STARTED' }));
  const a = analyzePlan(pkg({ tasks, header_claims: { claimed_completion_pct: 100 } }), R());
  assert.equal(a.completion.complete, 6);
  assert.equal(a.completion.total, 10);
  assert.ok(codes(a).includes('HEADER_COMPLETION_MISMATCH'));
});

test('empty complete population -> undefined ratio', () => {
  const a = analyzePlan(pkg({ tasks: [t('a', 1)] }), R());
  assert.equal(a.completion.complete, 0);
  assert.equal(a.completion.ratio, 0);
  assert.equal(a.completion.ratio_defined, true);
});

test('empty task list -> ratio null', () => {
  const a = analyzePlan(pkg({ tasks: [] }), R());
  assert.equal(a.completion.ratio, null);
  assert.equal(a.completion.ratio_defined, false);
});

test('budget charged before inspection: 65th task candidate refuses', () => {
  const tasks = Array.from({ length: 65 }, (_, i) => t(`t${i}`, 1));
  const resolver = R();
  assert.throws(() => analyzePlan(pkg({ tasks }), resolver), /BUDGET_EXCEEDED/);
  assert.equal(resolver.objectsCharged, 65);
});

test('sentinel: 65th candidate untouched (no fields read)', () => {
  const tasks = Array.from({ length: 64 }, (_, i) => t(`t${i}`, 1));
  let touched = false;
  const evil = {};
  Object.defineProperty(evil, 'task_id', { get() { touched = true; return 'evil'; } });
  Object.defineProperty(evil, 'duration_ticks', { get() { touched = true; return 1; } });
  tasks.push(evil);
  const resolver = R();
  assert.throws(() => analyzePlan(pkg({ tasks }), resolver), /BUDGET_EXCEEDED/);
  assert.equal(touched, false);
});
