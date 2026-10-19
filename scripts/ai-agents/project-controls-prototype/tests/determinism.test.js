// determinism.test.js — byte-identical repeats, detached snapshots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/index.js';
import { canonicalStringify } from '../src/canonical.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = JSON.parse(readFileSync(join(root, 'fixtures', 'store.json'), 'utf8'));
const keymap = JSON.parse(readFileSync(join(root, 'fixtures', 'keymap.json'), 'utf8'));

function ctx() {
  return {
    clock: { now: '2026-10-18T14:00:00Z' }, criteria_version: 'controls-v1',
    principal: { id: 'muse-relay' }, grants: [{scope: 'read', fixture: '*'}], request_authority: 'muse-relay',
    fixtureStore: JSON.parse(JSON.stringify(store)),
  };
}
function task() {
  return {
    schema_version: '1', task_id: 'det-1', operation: 'analyze', fixture_refs: [keymap['pkg-basic-01'][0], keymap['pkg-eur-01'][0]],
    options: { ev_mode: 'claimed', eac_formulas: ['BAC_OVER_CPI'], include_contingency: true, compare_headers: true },
  };
}

test('three runs are byte-identical', () => {
  const a = canonicalStringify(run(task(), ctx()));
  const b = canonicalStringify(run(task(), ctx()));
  const c = canonicalStringify(run(task(), ctx()));
  assert.equal(a, b);
  assert.equal(b, c);
});

test('caller mutation of output cannot affect later runs (detached)', () => {
  const out1 = run(task(), ctx());
  out1.report.packages[0].cpi.display = 'MUTATED';
  out1.report.packages.push({ fake: true });
  const out2 = run(task(), ctx());
  assert.equal(out2.report.packages[0].cpi.display, '0.8000');
  assert.equal(out2.report.packages.length, 2);
});

test('fixture mutation by caller cannot affect later runs', () => {
  const c1 = ctx();
  c1.fixtureStore[keymap['pkg-basic-01'][0]].bytes = '{"hacked":true}';
  const out1 = run(task(), c1);
  assert.equal(out1.status, 'REFUSED'); // hash mismatch -> refusal, not silent corruption
  const out2 = run(task(), ctx());
  assert.equal(out2.status, 'REPORT_READY');
});

test('package order in fixture_refs changes member order but pooled math is stable', () => {
  const t1 = task();
  const t2 = task();
  t2.fixture_refs = [...t1.fixture_refs].reverse();
  const o1 = run(t1, ctx());
  const o2 = run(t2, ctx());
  const pool = (o) => o.report.pooled.map((p) => `${p.currency}:${p.cpi.display}`).sort().join('|');
  assert.equal(pool(o1), pool(o2));
});
