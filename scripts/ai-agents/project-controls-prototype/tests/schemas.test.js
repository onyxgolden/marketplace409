// schemas.test.js — task/context/package/pin validation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTask, checkContext, checkPackage, checkSourceRef } from '../src/schemas.js';

const REF = { repo: 'synthetic', path: 'fx-00-x', commit: '0'.repeat(40), blob: 'a'.repeat(40), algorithm: 'git-sha1', revision: 'synthetic-v1' };
const goodTask = {
  schema_version: '1', task_id: 't1', operation: 'analyze', fixture_refs: ['fx-00-x'],
  options: { ev_mode: 'claimed', eac_formulas: ['BAC_OVER_CPI'], include_contingency: true, compare_headers: false },
};
const goodCtx = {
  clock: { now: '2026-10-18T14:00:00Z' }, criteria_version: 'controls-v1',
  principal: { id: 'muse-relay' }, grants: [{scope: 'read', fixture: '*'}], request_authority: 'muse-relay', fixtureStore: {},
};

test('valid task passes', () => assert.equal(checkTask(goodTask).ok, true));
test('valid context passes', () => assert.equal(checkContext(goodCtx).ok, true));

test('task rejects unknown operation', () => {
  const r = checkTask({ ...goodTask, operation: 'delete' });
  assert.equal(r.ok, false);
});

test('task rejects unknown option property', () => {
  const r = checkTask({ ...goodTask, options: { ...goodTask.options, exec: true } });
  assert.equal(r.ok, false);
  assert.ok(r.errors.some((e) => e.includes('unknown property')));
});

test('task rejects unknown EAC variant', () => {
  const r = checkTask({ ...goodTask, options: { ...goodTask.options, eac_formulas: ['TEA_LEAVES'] } });
  assert.equal(r.ok, false);
});

test('task rejects empty fixture_refs', () => {
  assert.equal(checkTask({ ...goodTask, fixture_refs: [] }).ok, false);
});

test('task rejects bad schema_version', () => {
  assert.equal(checkTask({ ...goodTask, schema_version: '2' }).ok, false);
});

test('context accepts syntactically valid authority; run() enforces the allowlist', () => {
  // checkContext only validates shape; runInner emits AUTH_UNVERIFIED for unknowns
  assert.equal(checkContext({ ...goodCtx, request_authority: 'mallory' }).ok, true);
});

test('context rejects malformed clock', () => {
  assert.equal(checkContext({ ...goodCtx, clock: { now: 'yesterday' } }).ok, false);
});

test('context rejects wrong criteria version', () => {
  assert.equal(checkContext({ ...goodCtx, criteria_version: 'controls-v2' }).ok, false);
});

function goodPkg() {
  return {
    kind: 'work-package', package_id: 'p1', currency: 'USD', bac_minor: 100,
    planned_percent: { num: 1, den: 2 }, claimed_actual_percent: { num: 1, den: 2 },
    actual_cost_lines: [{ line_id: 'l1', amount_minor: 10, kind: 'labor', citation: 'c' }],
    etc_lines: [], source_ref: REF, label: 'x',
  };
}

test('valid package passes', () => {
  const errs = [];
  assert.equal(checkPackage(goodPkg(), errs, new Set()), true);
  assert.deepEqual(errs, []);
});

test('package rejects unknown property', () => {
  const errs = [];
  assert.equal(checkPackage({ ...goodPkg(), frobnicate: 1 }, errs, new Set()), false);
});

test('package rejects duplicate package_id', () => {
  const errs = [];
  const seen = new Set(['p1']);
  assert.equal(checkPackage(goodPkg(), errs, seen), false);
  assert.ok(errs.some((e) => e.includes('duplicate')));
});

test('package rejects duplicate line ids', () => {
  const errs = [];
  const p = goodPkg();
  p.actual_cost_lines = [
    { line_id: 'dup', amount_minor: 1, kind: 'labor', citation: 'c' },
    { line_id: 'dup', amount_minor: 2, kind: 'labor', citation: 'c' },
  ];
  assert.equal(checkPackage(p, errs, new Set()), false);
});

test('package rejects percent out of range', () => {
  const errs = [];
  const p = goodPkg();
  p.planned_percent = { num: 3, den: 2 };
  assert.equal(checkPackage(p, errs, new Set()), false);
});

test('package rejects bad currency', () => {
  const errs = [];
  assert.equal(checkPackage({ ...goodPkg(), currency: 'US' }, errs, new Set()), false);
});

test('source_ref rejects non-40-hex blob', () => {
  const errs = [];
  assert.equal(checkSourceRef({ ...REF, blob: 'xyz' }, errs, 'p'), false);
});

test('source_ref rejects traversal path', () => {
  const errs = [];
  assert.equal(checkSourceRef({ ...REF, path: '../etc/passwd' }, errs, 'p'), false);
});

test('source_ref rejects wrong algorithm', () => {
  const errs = [];
  assert.equal(checkSourceRef({ ...REF, algorithm: 'sha256' }, errs, 'p'), false);
});
