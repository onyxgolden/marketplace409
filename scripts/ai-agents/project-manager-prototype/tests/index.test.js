// index.test.js — envelope, budget-first, task_id preservation, refusals.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { run } from '../src/index.js';
import { canonicalStringify } from '../src/canonical.js';
import { readFileSync } from 'node:fs';

const fixtures = JSON.parse(readFileSync(new URL('../fixtures/store.json', import.meta.url), 'utf8')).fixtures;
function ctx(authority = 'jason', store = fixtures) {
  return { clock: {}, criteria_version: '1', principal: 't', grants: [], request_authority: authority, fixtureStore: store };
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

test('muse-relay authority accepted', () => {
  const r = run(task(), ctx('muse-relay'));
  assert.equal(r.status, 'REPORT_READY');
});

test('unknown fixture -> PARTIAL with READ_DENIED', () => {
  const r = run(task({ fixture_refs: ['nope'] }), ctx());
  assert.equal(r.status, 'PARTIAL');
  assert.ok(r.diagnostics.some((d) => d.code === 'READ_DENIED'));
});

test('hash mismatch -> REFUSED HASH_MISMATCH (not swallowed)', () => {
  const bad = JSON.parse(JSON.stringify(fixtures));
  bad['plan-linear'] = { ...bad['plan-linear'], bytes: '{"tampered":true}' };
  const r = run(task(), ctx('jason', bad));
  assert.equal(r.status, 'REFUSED');
  assert.ok(r.diagnostics.some((d) => d.code === 'HASH_MISMATCH'));
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
  assert.ok(f.source_ref && f.source_ref.path === 'plan-cycle');
});
