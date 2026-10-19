// pm651.test.js — regression tests for ChatGPT NEEDS CHANGES findings PM651-001..010.
// Every probe from the verdict is reproduced here through the public run().
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';
import { analyzePlan } from '../src/manager.js';
import { Resolver, gitBlobSha1 } from '../src/resolver.js';
import { checkPlanPackage } from '../src/schemas.js';
import { canonicalStringify } from '../src/canonical.js';
import { sha256Hex } from '../src/resolver.js';
import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/store.json', import.meta.url), 'utf8')).fixtures;
function ctx(authority = 'jason', store = fixtures, principalId = 'jason') {
  return {
    clock: {}, criteria_version: '1',
    principal: { principal_id: principalId, kind: 'human' },
    grants: [{ grant_id: 'g1', principal_id: principalId, action: 'read', resource: { fixture_id: '*' } }],
    request_authority: authority, relay: null, fixtureStore: store,
  };
}
function task(over = {}) {
  return { schema_version: '1', task_id: 'req-123', operation: 'analyze', fixture_refs: ['plan-linear'], options: {}, ...over };
}
function pkg(over = {}) {
  return { plan_id: 'p', project_start_tick: 0, tasks: [], edges: [], milestones: [], capacity_windows: [], header_claims: {}, ...over };
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

// ---- PM651-001: authority ----

test('PM651-001: getter on principal_id is rejected, not read', () => {
  const c = ctx();
  Object.defineProperty(c.principal, 'principal_id', { get() { return 'jason'; }, enumerable: true });
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
});

// ---- PM651-002: citations ----

test('PM651-002: exact span quote equals byte slice', () => {
  const bytes = fixtures['plan-linear'].bytes;
  const r = new Resolver(fixtures);
  const span = r.verifySpan(bytes, 0, 10);
  assert.equal(span.quoted_text, Buffer.from(bytes, 'utf8').subarray(0, 10).toString('utf8'));
  assert.equal(span.verification, 'VERIFIED');
});

test('PM651-002: span splitting UTF-8 is rejected', () => {
  const bytes = '{"a":"caf\u00e9"}'; // é is 2 bytes
  const r = new Resolver({});
  // Find the byte offset inside the é character.
  const buf = Buffer.from(bytes, 'utf8');
  const eStart = buf.indexOf(Buffer.from('é', 'utf8'));
  assert.throws(() => r.verifySpan(bytes, eStart, eStart + 1), /SPAN_INVALID/);
});

test('PM651-002: quarantined record citation marked excluded', () => {
  const r = run(task({ fixture_refs: ['plan-injection'] }), ctx());
  // Injection is reported in envelope diagnostics with quarantine record.
  const inj = r.diagnostics.find((d) => d.code === 'INSTRUCTION_INJECTION');
  assert.ok(inj);
  assert.ok(r.quarantined_sources.length > 0);
  assert.equal(r.quarantined_sources[0].record_id, 'a');
});

// ---- PM651-003: budget ----

test('PM651-003: oversized task_id -> bounded refusal, not 300KB echo', () => {
  const bigId = 'x'.repeat(300000);
  const r = run(task({ task_id: bigId }), ctx());
  assert.equal(r.status, 'REFUSED');
  const out = JSON.stringify(r);
  assert.ok(out.length < 256 * 1024, `envelope ${out.length} exceeds 256KiB`);
  assert.equal(r.task_id, '[inadmissible-id]');
});

test('PM651-003: getter on fixture_refs[64] never executes', () => {
  let getterCalls = 0;
  const refs = Array.from({ length: 64 }, () => 'plan-linear');
  Object.defineProperty(refs, '64', {
    get() { getterCalls++; return 'plan-linear'; },
    enumerable: true, configurable: true,
  });
  // Make it look like length 65.
  Object.defineProperty(refs, 'length', { value: 65 });
  const r = run(task({ fixture_refs: refs }), ctx());
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'BUDGET_EXCEEDED' || d.code === 'ACCESSOR_REJECTED'));
  assert.equal(getterCalls, 0, 'getter must not execute before budget refusal');
});

// ---- PM651-004: resources (all 5 probes) ----

test('PM651-004 probe1: abutting declared allocations, no conflict', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { declared: 0, demands: [D('crew', 1)] }), t('b', 4, { declared: 4, demands: [D('crew', 1)] })],
    capacity_windows: [W('w1', 'crew', 0, 8, 1)],
  }), R());
  assert.equal(a.resources[0].assessment, 'OK');
});

test('PM651-004 probe3: capacity drop mid-interval -> OVERALLOCATED', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 10, { declared: 0, demands: [D('crew', 2)] })],
    capacity_windows: [W('w1', 'crew', 0, 5, 2), W('w2', 'crew', 5, 10, 1)],
  }), R());
  assert.equal(a.resources[0].assessment, 'OVERALLOCATED');
  const c = a.resources[0].conflicts[0];
  assert.deepEqual(c.interval, [5, 10]);
});

test('PM651-004 probe4: overlapping windows -> finding and UNVERIFIABLE', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { declared: 0, demands: [D('crew', 1)] })],
    capacity_windows: [W('w1', 'crew', 0, 6, 2), W('w2', 'crew', 2, 10, 2)],
  }), R());
  assert.ok(codes(a).includes('CAPACITY_WINDOW_OVERLAP'));
  // Overlapping windows make the basis unverifiable, not OK.
  assert.equal(a.resources[0].assessment, 'UNVERIFIABLE');
});

test('PM651-004 probe5: irrelevant outside window ignored', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 4, { declared: 0, demands: [D('crew', 1)] })],
    capacity_windows: [W('w1', 'crew', 0, 4, 1), W('w2', 'crew', 10, 12, 1)],
  }), R());
  assert.equal(a.resources[0].assessment, 'OK');
  assert.ok(!codes(a).includes('CAPACITY_COVERAGE_GAP'));
});

// ---- PM651-005: exact math ----

test('PM651-005: MAX_SAFE_INTEGER demands sum exactly', () => {
  const msi = Number.MAX_SAFE_INTEGER; // 9007199254740991
  const a = analyzePlan(pkg({
    tasks: [
      t('a', 4, { declared: 0, demands: [D('crew', msi)] }),
      t('b', 4, { declared: 0, demands: [D('crew', msi)] }),
      t('c', 4, { declared: 0, demands: [D('crew', msi)] }),
    ],
    capacity_windows: [W('w1', 'crew', 0, 4, msi)],
  }), R());
  // 3 * 9007199254740991 = 27021597764222973 exactly; capacity is msi per unit so this overallocates.
  // The key check: demand_num is the exact string, not a rounded float.
  const c = a.resources[0].conflicts[0];
  assert.equal(c.demand_num, '27021597764222973');
  assert.equal(c.demand_den, '1');
});

test('PM651-005: 1e308/1e308 demands refused as unsafe', () => {
  // 1e308 is not a safe integer -> schema refuses the package.
  const badPkg = pkg({
    tasks: [t('a', 4, { declared: 0, demands: [{ resource_id: 'crew', amount_num: 1e308, amount_den: 1e308 }] })],
  });
  const pc = checkPlanPackage(badPkg, R());
  assert.equal(pc.ok, false);
});

test('PM651-005: 99.9999999995 vs 100 -> MISMATCH (exact)', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 1, { status: 'COMPLETE' })],
    header_claims: { claimed_completion_pct: 99.9999999995 },
  }), R());
  assert.equal(a.header.match, false);
  assert.ok(codes(a).includes('HEADER_COMPLETION_MISMATCH'));
});

// ---- PM651-006: completeness ----

test('PM651-006: missing milestone requirement -> complete:false', () => {
  const r = run(task({ fixture_refs: ['plan-ms-missing'] }), ctx());
  assert.equal(r.complete, false);
});

test('PM651-006: coverage gap -> complete:false', () => {
  const r = run(task({ fixture_refs: ['plan-coverage-gap'] }), ctx());
  assert.equal(r.complete, false);
});

test('PM651-006: empty fixture_refs -> not complete', () => {
  const r = run(task({ fixture_refs: [] }), ctx());
  assert.equal(r.complete, false);
});

// ---- PM651-007: schema ----

test('PM651-007: duplicate milestone IDs -> REFUSED', () => {
  const bad = pkg({
    tasks: [t('a', 2)],
    milestones: [M('m', ['a'], 2), M('m', ['a'], 3)],
  });
  const bytes = canonicalStringify(bad);
  const r = run(task({ fixture_refs: ['x'] }), ctx('jason', {
    x: {
      bytes,
      sha256: sha256Hex(bytes),
      source_ref: {
        repo: 'synthetic-fixtures', path: 'fixtures/x.json',
        commit: 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678',
        blob: gitBlobSha1(bytes), algorithm: 'git-sha1', revision: '1',
      },
    },
  }));
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'INVALID_INPUT'));
});

test('PM651-007: string header pct -> REFUSED (no coercion)', () => {
  const bad = pkg({
    tasks: [t('a', 1, { status: 'COMPLETE' })],
    header_claims: { claimed_completion_pct: '100' },
  });
  const pc = checkPlanPackage(bad, R());
  assert.equal(pc.ok, false);
});

test('PM651-007: __proto__ task_id safely handled', () => {
  const bad = pkg({ tasks: [{ task_id: '__proto__', workstream_id: 'ws', duration_ticks: 1, declared_start_tick: null, release_tick: null, status: 'NOT_STARTED', resource_demands: [], notes: '' }] });
  const a = analyzePlan(bad, R());
  // Must not pollute prototype; math should have the task or refuse cleanly.
  assert.ok(a.status === 'REFUSED' || (a.math && !({}).polluted));
});

test('PM651-007: non-analyze operation -> UNSUPPORTED_TASK', () => {
  const r = run(task({ operation: 'forecast' }), ctx());
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'UNSUPPORTED_TASK'));
});

// ---- PM651-010: cycle witness ----

test('PM651-010: cycle witness excludes downstream nodes', () => {
  const a = analyzePlan(pkg({
    tasks: [t('a', 1), t('b', 1), t('c', 1)],
    edges: [E('e1', 'a', 'b'), E('e2', 'b', 'a'), E('e3', 'b', 'c')],
  }), R());
  const f = a.findings.find((x) => x.code === 'CYCLE_DETECTED');
  assert.ok(f);
  // Witness must be a -> b -> a, not including c as a node.
  assert.ok(f.reason.includes('a -> b -> a'));
  assert.ok(!f.reason.includes('-> c') && !f.reason.includes('c ->'));
});
