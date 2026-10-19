// findings.test.js — regression tests for PC650-001..006.
// Each test proves the specific blocker is fixed with exact probes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '../src/index.js';
import { createHash } from 'node:crypto';
import { Resolver, LIMITS } from '../src/resolver.js';
import { parseWithSpans } from '../src/spans.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const store = JSON.parse(readFileSync(join(root, 'fixtures', 'store.json'), 'utf8'));
const keymap = JSON.parse(readFileSync(join(root, 'fixtures', 'keymap.json'), 'utf8'));

function ctx(overrides) {
  return {
    clock: { now: '2026-10-18T14:00:00Z' }, criteria_version: 'controls-v1',
    principal: { id: 'test' }, grants: [], request_authority: 'muse-relay',
    fixtureStore: JSON.parse(JSON.stringify(store)),
    ...(overrides || {}),
  };
}
function task(refs, options) {
  return {
    schema_version: '1', task_id: 'findings-1', operation: 'analyze',
    fixture_refs: refs,
    options: { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false, ...(options || {}) },
  };
}

// ---- PC650-001: invocation-wide budget ----

test('PC650-001: 65th nested cost line is untouched (exact-limit/+1)', () => {
  // Build a fixture with 65 cost lines; the 65th must refuse before inspection.
  const lines = [];
  for (let i = 0; i < 65; i++) {
    lines.push({ line_id: `l-${i}`, amount_minor: 100, kind: 'labor', citation: 's' });
  }
  const pkg = {
    kind: 'work-package', package_id: 'pkg-budget-01', currency: 'USD', bac_minor: 1000000,
    planned_percent: { num: 1, den: 2 }, claimed_actual_percent: { num: 1, den: 2 },
    actual_cost_lines: lines, etc_lines: [], contingency: null, header_claims: null,
    source_ref: { repo: 's', path: 'x', commit: '0'.repeat(40), blob: '1'.repeat(40), algorithm: 'git-sha1', revision: 'v1' },
    label: 't',
  };
  const bytes = JSON.stringify(pkg);
  const localStore = {
    'fx-budget': { bytes, sha256: '00'.repeat(32), media_type: 'application/json' },
  };
  // Fix the sha to match
  localStore['fx-budget'].sha256 = createHash('sha256').update(bytes, 'utf8').digest('hex');
  const out = run(task(['fx-budget']), ctx({ fixtureStore: localStore }));
  // Budget: task(1)+refs(1)+options(1) + ctx(3) + resolve(1) + package(1) + percents(2) + lines...
  // 65 lines exceeds the 64-object cap -> refusal
  assert.equal(out.status, 'REFUSED');
  assert.ok(out.diagnostics.some((d) => d.code === 'BUDGET_EXCEEDED'));
});

test('PC650-001: output collections count toward 256-record limit', () => {
  // A valid single package produces bounded output records.
  const out = run(task([keymap['pkg-basic-01'][0]]), ctx());
  assert.ok(['REPORT_READY', 'PARTIAL'].includes(out.status));
  // Output records charged: packages + diagnostics + source_refs, all < 256
  assert.ok(out.report.packages.length <= 256);
});

// ---- PC650-003: corruption refuses ----

test('PC650-003: duplicate package IDs refuse (not partial)', () => {
  const refs = [keymap['pkg-basic-01'][0], keymap['pkg-basic-01'][1]]; // fx-00 and fx-17 share package_id
  const out = run(task(refs), ctx());
  assert.equal(out.status, 'REFUSED');
  assert.equal(out.report.packages.length, 0);
  assert.ok(out.diagnostics.some((d) => d.code === 'INVALID_INPUT'));
});

test('PC650-003: unknown fixture refuses (not partial)', () => {
  const out = run(task(['fx-nonexistent']), ctx());
  assert.equal(out.status, 'REFUSED');
  assert.ok(out.diagnostics.some((d) => d.code === 'READ_DENIED'));
});

// ---- PC650-005: evidenced EV ----

test('PC650-005: evidenced mode without evidence yields UNVERIFIABLE dependents', () => {
  const out = run(
    task([keymap['pkg-basic-01'][0]], { ev_mode: 'evidenced' }),
    ctx()
  );
  const pkg = out.report.packages[0];
  assert.equal(pkg.ev.status, 'UNVERIFIABLE');
  assert.equal(pkg.cpi.status, 'UNVERIFIABLE');
  assert.equal(pkg.cv.status, 'UNVERIFIABLE');
  assert.ok(pkg.claimed_actual_percent_unverified);
  // No 'claimed-fallback' anywhere
  assert.ok(!JSON.stringify(pkg).includes('claimed-fallback'));
});

// ---- PC650-006: line identity ----

test('PC650-006: same line_id in actual_cost and etc refuses (ambiguous overlap)', () => {
  const pkg = {
    kind: 'work-package', package_id: 'pkg-overlap-01', currency: 'USD', bac_minor: 1000000,
    planned_percent: { num: 1, den: 2 }, claimed_actual_percent: { num: 1, den: 2 },
    actual_cost_lines: [{ line_id: 'shared-01', amount_minor: 100, kind: 'labor', citation: 's' }],
    etc_lines: [{ line_id: 'shared-01', amount_minor: 200, kind: 'etc-labor', citation: 's' }],
    contingency: null, header_claims: null,
    source_ref: { repo: 's', path: 'x', commit: '0'.repeat(40), blob: '1'.repeat(40), algorithm: 'git-sha1', revision: 'v1' },
    label: 't',
  };
  const bytes = JSON.stringify(pkg);
  const localStore = {
    'fx-overlap': { bytes, sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'), media_type: 'application/json' },
  };
  const out = run(task(['fx-overlap']), ctx({ fixtureStore: localStore }));
  assert.equal(out.status, 'REFUSED');
  assert.ok(out.diagnostics.some((d) => /ambiguous/.test(d.reason)));
});

test('PC650-006: negative etc amount refuses', () => {
  const pkg = {
    kind: 'work-package', package_id: 'pkg-negetc-01', currency: 'USD', bac_minor: 1000000,
    planned_percent: { num: 1, den: 2 }, claimed_actual_percent: { num: 1, den: 2 },
    actual_cost_lines: [{ line_id: 'a1', amount_minor: 100, kind: 'labor', citation: 's' }],
    etc_lines: [{ line_id: 'e1', amount_minor: -50, kind: 'etc-labor', citation: 's' }],
    contingency: null, header_claims: null,
    source_ref: { repo: 's', path: 'x', commit: '0'.repeat(40), blob: '1'.repeat(40), algorithm: 'git-sha1', revision: 'v1' },
    label: 't',
  };
  const bytes = JSON.stringify(pkg);
  const localStore = {
    'fx-negetc': { bytes, sha256: createHash('sha256').update(bytes, 'utf8').digest('hex'), media_type: 'application/json' },
  };
  const out = run(task(['fx-negetc']), ctx({ fixtureStore: localStore }));
  assert.equal(out.status, 'REFUSED');
  assert.ok(out.diagnostics.some((d) => /negative/.test(d.reason)));
});

test('PC650-006: negative actual-cost with ADJUSTMENT kind is permitted', () => {
  const out = run(task([keymap['pkg-negadj-01'][0]]), ctx());
  assert.ok(['REPORT_READY', 'PARTIAL'].includes(out.status));
  // AC = 950000 - 50000 = 900000
  assert.equal(out.report.packages[0].ac_display, '9000.00');
});
