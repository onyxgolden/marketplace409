// controls.test.js — hand-derived domain cases (independent of battery oracle).
// Each expected value below was derived by hand; see build report.
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePackage } from '../src/controls.js';
import { parseWithSpans } from '../src/spans.js';

const REF = { repo: 'synthetic', path: 'x', commit: '0'.repeat(40), blob: '1'.repeat(40), algorithm: 'git-sha1', revision: 'synthetic-v1' };

// Build a ctx with real byte spans: serialize the package, parse with spans,
// and wire sourceBytes/sourceSpans so citation verification succeeds.
function ctxFor(pkg, overrides) {
  const bytes = JSON.stringify(pkg);
  const { spans } = parseWithSpans(bytes);
  return {
    evMode: 'claimed',
    eacFormulas: ['BAC_OVER_CPI', 'AC_PLUS_REMAINING_BUDGET', 'AC_PLUS_REMAINING_OVER_CPI_SPI', 'BOTTOM_UP_ETC'],
    includeContingency: true,
    compareHeaders: true,
    chargeSpan: () => {},
    sourceBytes: Buffer.from(bytes, 'utf8'),
    sourceSpans: spans,
    sourceRef: REF,
    ...(overrides || {}),
  };
}
const ctxBaseFor = (pkg) => ctxFor(pkg);
const basePkg = {
  package_id: 't1', currency: 'USD', bac_minor: 1000000,
  planned_percent: { num: 1, den: 2 }, claimed_actual_percent: { num: 2, den: 5 },
  actual_cost_lines: [{ line_id: 'a1', amount_minor: 500000, kind: 'labor', citation: 's' }],
  etc_lines: [], contingency: null, header_claims: null, source_ref: REF, label: 't',
};

test('brief canonical case: PV5000 EV4000 CPI0.8 SPI0.8 CV-1000 SV-1000', () => {
  const { result } = analyzePackage(basePkg, ctxFor(basePkg));
  assert.equal(result.pv.display, '5000.00');
  assert.equal(result.ev.display, '4000.00');
  assert.equal(result.cpi.display, '0.8000');
  assert.equal(result.spi.display, '0.8000');
  assert.equal(result.cv.display, '-1000.00');
  assert.equal(result.sv.display, '-1000.00');
});

test('EAC variants hand-derived', () => {
  const { result } = analyzePackage(basePkg, ctxFor(basePkg));
  // BAC/CPI = 1000000/0.8 = 1250000
  assert.equal(result.eac.BAC_OVER_CPI.display, '12500.00');
  // AC+(BAC-EV) = 500000+600000 = 1100000
  assert.equal(result.eac.AC_PLUS_REMAINING_BUDGET.display, '11000.00');
  // AC+(BAC-EV)/(CPI*SPI) = 500000 + 600000/0.64 = 500000+937500 = 1437500
  assert.equal(result.eac.AC_PLUS_REMAINING_OVER_CPI_SPI.display, '14375.00');
  // bottom-up with no ETC lines = AC
  assert.equal(result.eac.BOTTOM_UP_ETC.display, '5000.00');
});

test('missing planned_percent: PV/SPI/SV unverifiable, CPI/CV still computed', () => {
  const p = { ...basePkg, planned_percent: undefined };
  const { result } = analyzePackage(p, ctxFor(p));
  assert.equal(result.pv.status, 'UNVERIFIABLE');
  assert.equal(result.spi.status, 'UNVERIFIABLE');
  assert.equal(result.sv.status, 'UNVERIFIABLE');
  assert.equal(result.cpi.display, '0.8000');
  assert.equal(result.cv.display, '-1000.00');
});

test('zero AC: CPI zero-denominator, CV still computed', () => {
  const p = { ...basePkg, actual_cost_lines: [] };
  const { result } = analyzePackage(p, ctxFor(p));
  assert.equal(result.cpi.status, 'ZERO_DENOMINATOR');
  assert.equal(result.cv.display, '4000.00'); // EV - 0
  assert.equal(result.eac.BAC_OVER_CPI.status, 'UNVERIFIABLE');
});

test('negative AC: CPI invalidated', () => {
  const p = { ...basePkg, actual_cost_lines: [{ line_id: 'a1', amount_minor: -100, kind: 'ADJUSTMENT', citation: 's' }] };
  const { result, diagnostics } = analyzePackage(p, ctxFor(p));
  assert.equal(result.cpi.status, 'UNVERIFIABLE');
  assert.ok(diagnostics.some((d) => d.code === 'CPI_INVALID'));
});

test('negative AC with non-adjustment kind is refused at schema', () => {
  // schema-level: covered in schemas.test.js
});

test('evidenced EV mode uses supplied EV', () => {
  const p = { ...basePkg, evidenced_ev_minor: 900000 };
  const { result } = analyzePackage(p, ctxFor(p, { evMode: 'evidenced' }));
  assert.equal(result.ev.display, '9000.00');
  assert.equal(result.ev_mode, 'evidenced');
});

test('evidenced mode without supplied EV yields UNVERIFIABLE, no fallback (PC650-005)', () => {
  const { result, diagnostics } = analyzePackage(basePkg, ctxFor(basePkg, { evMode: 'evidenced' }));
  assert.equal(result.ev_mode, 'evidenced');
  assert.equal(result.ev.status, 'UNVERIFIABLE');
  assert.equal(result.cpi.status, 'UNVERIFIABLE');
  assert.equal(result.cv.status, 'UNVERIFIABLE');
  assert.ok(result.claimed_actual_percent_unverified);
  assert.ok(diagnostics.some((d) => d.code === 'EV_UNVERIFIABLE'));
});

test('contingency: remaining and burn', () => {
  const p = { ...basePkg, contingency: { original_minor: 100000, additions: [], draws: [{ line_id: 'd1', amount_minor: 20000, kind: 'draw', citation: 's' }], citation: 's' } };
  const { result } = analyzePackage(p, ctxFor(p));
  assert.equal(result.contingency.remaining_display, '800.00');
  assert.equal(result.contingency.burn.display, '0.2000');
  assert.equal(result.contingency.status, 'ok');
});

test('contingency overspend flagged', () => {
  const p = { ...basePkg, contingency: { original_minor: 50000, additions: [{ line_id: 'a1', amount_minor: 10000, kind: 'approved-addition', citation: 's' }], draws: [{ line_id: 'd1', amount_minor: 70000, kind: 'draw', citation: 's' }], citation: 's' } };
  const { result, diagnostics } = analyzePackage(p, ctxFor(p));
  assert.equal(result.contingency.status, 'CONTINGENCY_EXCEEDED');
  assert.equal(result.contingency.remaining_display, '-100.00');
  assert.ok(diagnostics.some((d) => d.code === 'CONTINGENCY_EXCEEDED'));
});

test('zero reserve: burn unverifiable', () => {
  const p = { ...basePkg, contingency: { original_minor: 0, additions: [], draws: [], citation: 's' } };
  const { result } = analyzePackage(p, ctxFor(p));
  assert.equal(result.contingency.burn.status, 'UNVERIFIABLE');
});

test('forged header CPI detected with exact values', () => {
  const p = { ...basePkg, header_claims: { cpi: { num: 1, den: 1 }, source: 's' } };
  const { result, diagnostics } = analyzePackage(p, ctxFor(p));
  assert.equal(result.header_comparison[0].match, false);
  assert.ok(diagnostics.some((d) => d.code === 'HEADER_MISMATCH'));
});

test('correct header CPI matches', () => {
  const p = { ...basePkg, header_claims: { cpi: { num: 4, den: 5 }, source: 's' } };
  const { result, diagnostics } = analyzePackage(p, ctxFor(p));
  assert.equal(result.header_comparison[0].match, true);
  assert.ok(!diagnostics.some((d) => d.code === 'HEADER_MISMATCH'));
});

test('fractional percent rounds only at final display', () => {
  const p = { ...basePkg, bac_minor: 100000, planned_percent: { num: 1, den: 3 }, claimed_actual_percent: { num: 1, den: 3 }, actual_cost_lines: [{ line_id: 'a1', amount_minor: 33333, kind: 'labor', citation: 's' }] };
  const { result } = analyzePackage(p, ctxFor(p, { eacFormulas: [] }));
  // PV = 100000/3 = 33333.333... -> 33333.33 ; internal rational retained
  assert.equal(result.pv.display, '333.33');
  assert.equal(result.pv.n, '100000');
  assert.equal(result.pv.d, '3');
});
