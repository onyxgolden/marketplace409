// index.test.js — envelope, budget-first, task_id preservation, refusals.
// PM651-008: inline builtins-only trust verification BEFORE any agent import.
// Uses ONLY node:fs, node:crypto, node:path, node:url (builtins). Verifies
// manifest digest against host PM_TRUST_ROOT and every listed file hash.
// Exits nonzero before any in-corpus module is evaluated on failure.
// Agent imports below are DYNAMIC (await import).
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

test('envelope preserves validated task_id', () => {
  const r = run(task(), ctx());
  assert.equal(r.task_id, 'req-123');
  assert.equal(r.status, 'REPORT_READY');
  assert.equal(r.advisory, true);
  assert.equal(r.fixture_only, true);
});

test('deterministic: repeat runs byte-identical', () => {
  const a = canonicalStringify(run(task(), ctx()));
  const b = canonicalStringify(run(task(), ctx()));
  assert.equal(a, b);
});

test('unknown authority -> REFUSED AUTH_UNVERIFIED', () => {
  const r = run(task(), ctx('mallory'));
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTH_UNVERIFIED'));
});

test('principal mismatch -> REFUSED AUTH_UNVERIFIED', () => {
  const r = run(task(), ctx('jason', fixtures, 'mallory'));
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTH_UNVERIFIED'));
});

test('missing grant -> REFUSED AUTHZ_DENIED with zero byte access', () => {
  const c = ctx();
  c.grants = [];
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTHZ_DENIED'));
});

test('muse-relay authority requires valid relay', () => {
  // No relay object -> refused.
  const c1 = ctx('muse-relay');
  c1.principal = { principal_id: 'relay-op', kind: 'relay' };
  c1.grants = [{ grant_id: 'g1', principal_id: 'relay-op', action: 'read', resource: { fixture_id: '*' } }];
  const r1 = run(task(), c1);
  assert.equal(r1.status, 'REFUSED');
  // Valid relay delegating to principal -> accepted.
  const c2 = ctx('muse-relay');
  c2.principal = { principal_id: 'relay-op', kind: 'relay' };
  c2.grants = [{ grant_id: 'g1', principal_id: 'relay-op', action: 'read', resource: { fixture_id: '*' } }];
  c2.relay = { relay_id: 'muse-relay', delegate_principal_id: 'relay-op', valid: true, scope: 'read-fixtures' };
  const r2 = run(task(), c2);
  assert.equal(r2.status, 'REPORT_READY');
});

test('unknown fixture -> PARTIAL with READ_DENIED', () => {
  const r = run(task({ fixture_refs: ['nope'] }), ctx());
  assert.equal(r.status, 'PARTIAL');
  assert.ok(r.diagnostics.some((d) => d.code === 'READ_DENIED'));
});

test('hash mismatch -> REFUSED (not swallowed)', () => {
  const bad = JSON.parse(JSON.stringify(fixtures));
  bad['plan-linear'] = { ...bad['plan-linear'], bytes: '{"tampered":true}' };
  const r = run(task(), ctx('jason', bad));
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'BLOB_MISMATCH' || d.code === 'HASH_MISMATCH'));
});

test('65 fixture refs -> BUDGET_EXCEEDED refusal', () => {
  const refs = Array.from({ length: 65 }, () => 'plan-linear');
  const r = run(task({ fixture_refs: refs }), ctx());
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'BUDGET_EXCEEDED'));
});

test('malformed task -> REFUSED INVALID_INPUT', () => {
  const r = run({ schema_version: '1', task_id: 'x', operation: 'analyze', fixture_refs: [], options: {}, extra: 1 }, ctx());
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'INVALID_INPUT'));
});

test('unsupported operation -> REFUSED', () => {
  const r = run(task({ operation: 'schedule' }), ctx());
  assert.equal(r.status, 'REFUSED');
});

test('injection note quarantined, plan still analyzed', () => {
  const r = run(task({ fixture_refs: ['plan-injection'] }), ctx());
  assert.equal(r.status, 'REPORT_READY');
  assert.equal(r.quarantined_sources.length, 1);
  assert.ok(r.diagnostics.some((d) => d.code === 'INSTRUCTION_INJECTION'));
  assert.equal(r.report.plans[0].status, 'REPORT_READY');
});

test('draft summary is inert prose', () => {
  const r = run(task({ options: { include_draft_summary: true } }), ctx());
  const draft = r.report.draft_summary;
  assert.ok(draft.includes('DRAFT'));
  assert.ok(draft.includes('Advisory only'));
  assert.ok(!/approv/i.test(draft));
});

test('findings carry source citations', () => {
  const r = run(task({ fixture_refs: ['plan-cycle'] }), ctx());
  const f = r.report.plans[0].findings[0];
  assert.ok(f.source_ref && f.source_ref.path === 'fixtures/plan-cycle.json');
  assert.ok(f.source_ref.blob && /^[0-9a-f]{40}$/.test(f.source_ref.blob));
  assert.equal(f.source_ref.algorithm, 'git-sha1');
  // PM651-002: aggregate findings (no record_id) get the whole-fixture
  // verified span with an explicit aggregate basis.
  assert.equal(f.evidence_state, 'verified-aggregate');
  assert.equal(f.source_ref.verification, 'VERIFIED');
  assert.ok(f.source_ref.quoted_span);
  assert.ok(f.source_ref.span);
});

test('PM651-001: missing principal entirely -> REFUSED', () => {
  const c = ctx();
  delete c.principal;
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
});

test('PM651-001: wrong-scope grant -> REFUSED AUTHZ_DENIED', () => {
  const c = ctx();
  c.grants = [{ grant_id: 'g1', principal_id: 'jason', action: 'read', resource: { fixture_id: 'other-fixture' } }];
  const r = run(task(), c);
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'AUTHZ_DENIED'));
});

test('PM651-002: blob is real git SHA-1, not truncated SHA-256', () => {
  const r = run(task(), ctx());
  const ref = r.source_refs[0];
  assert.equal(ref.algorithm, 'git-sha1');
  assert.ok(/^[0-9a-f]{40}$/.test(ref.blob));
  // Must equal the actual git blob SHA-1 ChatGPT computed.
  assert.equal(ref.blob, '988320ec71f72d05f1b724ad19bea540e7f52b7f');
});

test('PM651-002: tampered blob -> BLOB_MISMATCH (not swallowed)', () => {
  const bad = JSON.parse(JSON.stringify(fixtures));
  bad['plan-linear'].source_ref.blob = '0000000000000000000000000000000000000000';
  const r = run(task(), ctx('jason', bad));
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'BLOB_MISMATCH'));
});
