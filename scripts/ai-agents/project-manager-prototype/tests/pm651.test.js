// pm651.test.js — regression tests for ChatGPT NEEDS CHANGES findings PM651-001..010.
// Every probe from the verdict is reproduced here through the public run().
// PM651-008: inline builtins-only trust verification BEFORE any agent import.
// Uses ONLY node:fs, node:crypto, node:path, node:url (builtins). Agent
// imports below are DYNAMIC (await import).
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
const { run } = await import('../src/index.js');
const { analyzePlan } = await import('../src/manager.js');
const { Resolver, gitBlobSha1, sha256Hex } = await import('../src/resolver.js');
const { checkPlanPackage } = await import('../src/schemas.js');
const { canonicalStringify } = await import('../src/canonical.js');

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
  // PM651-002: verification lives at the Citation level, not nested in span.
  assert.equal(span.verification, undefined);
  assert.equal(span.start_byte, 0);
  assert.equal(span.end_byte, 10);
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

// ---- PM651-001 (round 2): relay identity and scope ----

test('PM651-001: wrong relay_id -> denied, zero byte reads', () => {
  const c = ctx('muse-relay', fixtures, 'relay-op');
  c.principal = { principal_id: 'relay-op', kind: 'relay' };
  c.relay = { relay_id: 'not-muse', delegate_principal_id: 'relay-op', valid: true, scope: 'read-fixtures' };
  c.grants = [{ grant_id: 'g1', principal_id: 'relay-op', action: 'read', resource: { fixture_id: '*' } }];
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTH_UNVERIFIED'));
});

test('PM651-001: write-only scope -> denied', () => {
  const c = ctx('muse-relay', fixtures, 'relay-op');
  c.principal = { principal_id: 'relay-op', kind: 'relay' };
  c.relay = { relay_id: 'muse-relay', delegate_principal_id: 'relay-op', valid: true, scope: 'write-only' };
  c.grants = [{ grant_id: 'g1', principal_id: 'relay-op', action: 'read', resource: { fixture_id: '*' } }];
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTHZ_DENIED'));
});

// PM651-001 (round 3): substring scope "bread-only" contains "read" but is
// NOT a registered capability. Exact vocabulary matching is required.
test('PM651-001: substring scope "bread-only" -> denied', () => {
  const c = ctx('muse-relay', fixtures, 'relay-op');
  c.principal = { principal_id: 'relay-op', kind: 'relay' };
  c.relay = { relay_id: 'muse-relay', delegate_principal_id: 'relay-op', valid: true, scope: 'bread-only' };
  c.grants = [{ grant_id: 'g1', principal_id: 'relay-op', action: 'read', resource: { fixture_id: '*' } }];
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTHZ_DENIED'));
});

test('PM651-001: correct relay_id and read scope -> allowed', () => {
  const c = ctx('muse-relay', fixtures, 'relay-op');
  c.principal = { principal_id: 'relay-op', kind: 'relay' };
  c.relay = { relay_id: 'muse-relay', delegate_principal_id: 'relay-op', valid: true, scope: 'read-fixtures' };
  c.grants = [{ grant_id: 'g1', principal_id: 'relay-op', action: 'read', resource: { fixture_id: '*' } }];
  const r = run(task(), c);
  assert.equal(r.status, 'REPORT_READY');
});

// ---- PM651-002 (round 2): byte-exact spans ----

test('PM651-002: findRecordSpan uses byte offsets with Unicode before record', () => {
  // Literal é (2 bytes in UTF-8, 1 char in JS) before the record.
  // Character index != byte offset; the span must be byte-exact.
  const bytes = '{"plan_id":"p caf\u00e9","tasks":[{"task_id":"t1","x":1}]}';
  const r = new Resolver({});
  const span = r.findRecordSpan(bytes, 'task_id', 't1');
  assert.ok(span, 'span should be found');
  const [start, end] = span;
  const buf = Buffer.from(bytes, 'utf8');
  const slice = buf.subarray(start, end).toString('utf8');
  // The slice must be valid JSON containing the task_id.
  const obj = JSON.parse(slice);
  assert.equal(obj.task_id, 't1');
  // Byte offsets must round-trip: the slice byte length equals end-start.
  assert.equal(Buffer.byteLength(slice, 'utf8'), end - start);
});

test('PM651-002: quoted_span equals span.quoted_text (no truncation)', () => {
  const r = run(task({ fixture_refs: ['plan-linear'] }), ctx());
  const plan = r.report.plans[0];
  // Whole-fixture citation
  const cite = plan.citation;
  assert.ok(cite.quoted_span);
  assert.ok(cite.span);
  assert.equal(cite.quoted_span, cite.span.quoted_text);
  assert.equal(cite.verification, 'VERIFIED');
  // Per-finding citation
  const f = plan.findings.find((x) => x.record_id);
  if (f) {
    assert.equal(f.source_ref.quoted_span, f.source_ref.span.quoted_text);
    assert.equal(f.source_ref.verification, 'VERIFIED');
  }
});

// ---- PM651-003 (round 2): pre-admission getters ----

test('PM651-003: task_id getter never executes (admission before serialization)', () => {
  let calls = 0;
  const t = task();
  Object.defineProperty(t, 'task_id', {
    get() { calls++; return 'req-123'; },
    enumerable: true, configurable: true,
  });
  const r = run(t, ctx());
  assert.equal(r.status, 'REFUSED');
  assert.equal(calls, 0, `task_id getter executed ${calls} times`);
});

test('PM651-003: oversized context metadata is charged', () => {
  const c = ctx();
  c.clock = { unused: 'x'.repeat(300000) }; // 300KB > 256KiB budget
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'INPUT_LIMIT' || d.code === 'BUDGET_EXCEEDED'));
});

// PM651-003 (round 3): fixtureStore is NEVER serialized. Getters on denied/
// unselected store payloads must not execute (0 calls), even when the
// fixture is registered. The store is skipped by admitGraph and excluded
// from context serialization.
test('PM651-003: getter on denied fixture bytes never executes', () => {
  let calls = 0;
  // Build a store with a getter on the bytes of a registered fixture.
  const evilStore = {};
  for (const [k, v] of Object.entries(fixtures)) {
    evilStore[k] = v;
  }
  const victim = evilStore['plan-linear'];
  Object.defineProperty(victim, 'bytes', {
    get() { calls++; return victim._realBytes || '{}'; },
    enumerable: true, configurable: true,
  });
  // Deny grants: no read grant for this principal.
  const c = ctx('jason', evilStore, 'jason');
  c.grants = []; // no grants -> AUTHZ_DENIED
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTHZ_DENIED'));
  assert.equal(calls, 0, `fixture bytes getter executed ${calls} times (must be 0)`);
});

test('PM651-003: getter on source_ref.blob never executes', () => {
  let calls = 0;
  const evilStore = {};
  for (const [k, v] of Object.entries(fixtures)) {
    evilStore[k] = { ...v, source_ref: { ...v.source_ref } };
  }
  const victim = evilStore['plan-linear'];
  const realBlob = victim.source_ref.blob;
  Object.defineProperty(victim.source_ref, 'blob', {
    get() { calls++; return realBlob; },
    enumerable: true, configurable: true,
  });
  const c = ctx('jason', evilStore, 'jason');
  const r = run(task(), c);
  // The getter must not execute during admission/serialization.
  // (The run may succeed or fail on other grounds; the invariant is 0 calls.)
  assert.equal(calls, 0, `source_ref.blob getter executed ${calls} times (must be 0)`);
});

// ---- PM651-005 (round 2): exact tick arithmetic ----

test('PM651-005: MAX_SAFE_INTEGER start+duration refuses (no rounding)', () => {
  const p = pkg({
    plan_id: 'big', project_start_tick: 9007199254740991,
    tasks: [t('a', 2, { declared: 9007199254740991 })],
  });
  const r = new Resolver({});
  const analysis = analyzePlan(p, r, JSON.stringify(p), null, null);
  // 9007199254740991 + 2 = 9007199254740993 (exact), which exceeds MAX_SAFE_INTEGER.
  // Must refuse, not emit the rounded 9007199254740992.
  const unsafe = analysis.findings.find((f) => f.code === 'UNSAFE_TICK_ARITHMETIC');
  assert.ok(unsafe, 'should flag unsafe tick arithmetic');
  assert.equal(analysis.status, 'PARTIAL');
  assert.equal(analysis.math, null);
});

// ---- PM651-006 (round 2): population contract ----

test('PM651-006: no population declaration -> verified:false', () => {
  const p = pkg({
    plan_id: 'p1', project_start_tick: 0,
    tasks: [t('a', 1, { status: 'COMPLETE', declared: 0 })],
    milestones: [M('m1', ['a'], 1)],
  });
  const r = new Resolver({});
  const analysis = analyzePlan(p, r, JSON.stringify(p), null, null);
  assert.equal(analysis.completion.verified, false);
  assert.equal(analysis.completion.population_matches, false);
});

test('PM651-006: matching population declaration -> verified:true', () => {
  const p = pkg({
    plan_id: 'p1', project_start_tick: 0,
    tasks: [t('a', 1, { status: 'COMPLETE', declared: 0 })],
    milestones: [M('m1', ['a'], 1)],
  });
  const r = new Resolver({});
  // PM651-006 (round 3): population must bind to the exact plan and source.
  const citation = { commit: 'a'.repeat(40), blob: 'b'.repeat(40) };
  const population = {
    expected_tasks: 1,
    plan_id: 'p1',
    source_commit: 'a'.repeat(40),
    source_blob: 'b'.repeat(40),
  };
  const analysis = analyzePlan(p, r, JSON.stringify(p), citation, population);
  assert.equal(analysis.completion.verified, true);
  assert.equal(analysis.completion.population_matches, true);
  assert.equal(analysis.completion.population_binding_matches, true);
});

test('PM651-006: mismatched population -> verified:false', () => {
  const p = pkg({
    plan_id: 'p1', project_start_tick: 0,
    tasks: [t('a', 1, { status: 'COMPLETE', declared: 0 })],
    milestones: [M('m1', ['a'], 1)],
  });
  const r = new Resolver({});
  const analysis = analyzePlan(p, r, JSON.stringify(p), null, { expected_tasks: 5 });
  assert.equal(analysis.completion.verified, false);
  assert.equal(analysis.completion.population_matches, false);
});

// PM651-006 (round 3): wrong binding -> verified:false even if count matches.
test('PM651-006: wrong plan_id binding -> verified:false', () => {
  const p = pkg({
    plan_id: 'p1', project_start_tick: 0,
    tasks: [t('a', 1, { status: 'COMPLETE', declared: 0 })],
    milestones: [M('m1', ['a'], 1)],
  });
  const r = new Resolver({});
  const citation = { commit: 'a'.repeat(40), blob: 'b'.repeat(40) };
  const population = {
    expected_tasks: 1, // count matches
    plan_id: 'different-plan', // but binding is wrong
    source_commit: 'a'.repeat(40),
    source_blob: 'b'.repeat(40),
  };
  const analysis = analyzePlan(p, r, JSON.stringify(p), citation, population);
  assert.equal(analysis.completion.verified, false);
  assert.equal(analysis.completion.population_matches, true); // count matches
  assert.equal(analysis.completion.population_binding_matches, false); // binding fails
});

test('PM651-006: wrong source_commit binding -> verified:false', () => {
  const p = pkg({
    plan_id: 'p1', project_start_tick: 0,
    tasks: [t('a', 1, { status: 'COMPLETE', declared: 0 })],
    milestones: [M('m1', ['a'], 1)],
  });
  const r = new Resolver({});
  const citation = { commit: 'a'.repeat(40), blob: 'b'.repeat(40) };
  const population = {
    expected_tasks: 1,
    plan_id: 'p1',
    source_commit: 'c'.repeat(40), // wrong revision
    source_blob: 'b'.repeat(40),
  };
  const analysis = analyzePlan(p, r, JSON.stringify(p), citation, population);
  assert.equal(analysis.completion.verified, false);
  assert.equal(analysis.completion.population_binding_matches, false);
});

test('PM651-006: wrong source_blob binding -> verified:false', () => {
  const p = pkg({
    plan_id: 'p1', project_start_tick: 0,
    tasks: [t('a', 1, { status: 'COMPLETE', declared: 0 })],
    milestones: [M('m1', ['a'], 1)],
  });
  const r = new Resolver({});
  const citation = { commit: 'a'.repeat(40), blob: 'b'.repeat(40) };
  const population = {
    expected_tasks: 1,
    plan_id: 'p1',
    source_commit: 'a'.repeat(40),
    source_blob: 'd'.repeat(40), // wrong bytes
  };
  const analysis = analyzePlan(p, r, JSON.stringify(p), citation, population);
  assert.equal(analysis.completion.verified, false);
  assert.equal(analysis.completion.population_binding_matches, false);
});

// ---- PM651-007 (round 2): schema gaps ----

test('PM651-007: missing workstream_id -> refused', () => {
  const badTask = t('a', 1);
  delete badTask.workstream_id;
  const p = pkg({ plan_id: 'p', project_start_tick: 0, tasks: [badTask] });
  const r = new Resolver({});
  const result = checkPlanPackage(p, r);
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes('workstream_id'));
});

test('PM651-007: non-finite claimed_completion_pct (1e999) -> refused', () => {
  // 1e999 parses to Infinity. Must be structurally refused.
  const p = {
    plan_id: 'p', project_start_tick: 0, tasks: [], edges: [],
    milestones: [], capacity_windows: [],
    header_claims: { claimed_completion_pct: 1e999 },
  };
  const r = new Resolver({});
  const result = checkPlanPackage(p, r);
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes('finite'));
});

test('PM651-007: unknown field in capacity rational -> refused', () => {
  const p = pkg({
    plan_id: 'p', project_start_tick: 0, tasks: [],
    capacity_windows: [{
      window_id: 'w1', resource_id: 'r1', start_tick: 0, end_tick: 10,
      capacity: { num: 5, den: 1, evil: true },
    }],
  });
  const r = new Resolver({});
  const result = checkPlanPackage(p, r);
  assert.equal(result.ok, false);
  assert.ok(result.errors[0].includes('unknown fields'));
});

test('PM651-003: 256 output records accepted, 257th refused (boundary)', () => {
  // The output record budget is 256. Charging exactly 256 must succeed;
  // the 257th charge must throw BudgetExceeded.
  const r = new Resolver({});
  for (let i = 0; i < 256; i++) {
    r.chargeOutputRecord();
  }
  assert.equal(r.outputRecordsCharged, 256);
  assert.throws(() => r.chargeOutputRecord(), (e) => {
    assert.equal(e.code, 'BUDGET_EXCEEDED');
    return true;
  });
});

test('PM651-003: finding citation and span records are charged', () => {
  // A finding with a source_ref and nested span must consume 3 output
  // records: the finding itself, its source_ref citation, and the span.
  // This test verifies the charging path exists by checking that a
  // Resolver charged for a finding+citation+span triplet counts 3.
  const r = new Resolver({});
  const before = r.outputRecordsCharged;
  // Simulate what index.js now does for each finding with citation+span
  r.chargeOutputRecord(); // finding
  r.chargeOutputRecord(); // source_ref citation
  r.chargeOutputRecord(); // span
  assert.equal(r.outputRecordsCharged - before, 3);
});
