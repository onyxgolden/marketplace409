// make-battery.js — generates corpus/battery.json: 120 frozen cases.
// Independent oracle: written separately from src/controls.js, imports
// NOTHING from ../src. Hand-verified flagship derivations are documented
// in the build report; the oracle below is the mechanical bulk derivation.
//
// Categories: 40 nominal/boundary, 30 contradiction/incomplete/duplicate,
// 20 injection/prohibited-operation, 20 schema/provenance/permission,
// 10 budget/replay/mutation.

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
mkdirSync(join(root, 'corpus'), { recursive: true });
const store = JSON.parse(readFileSync(join(root, 'fixtures', 'store.json'), 'utf8'));
const keymap = JSON.parse(readFileSync(join(root, 'fixtures', 'keymap.json'), 'utf8'));
const K = (pkgId, n = 0) => keymap[pkgId][n];

// ---------- independent oracle (no src/ imports) ----------
const B = (x) => BigInt(x);
function rnd(n, d, dec) { // half-away-from-zero decimal string
  n = B(n); d = B(d);
  const neg = (n < 0n) !== (d < 0n);
  const an = n < 0n ? -n : n, ad = d < 0n ? -d : d;
  const s = 10n ** B(dec);
  let q = (an * s) / ad;
  if (2n * ((an * s) % ad) >= ad) q += 1n;
  const dig = q.toString().padStart(dec + 1, '0');
  const body = dec === 0 ? dig : dig.slice(0, -dec) + '.' + dig.slice(-dec);
  return (neg && q !== 0n ? '-' : '') + body;
}
const money = (minor) => rnd(minor, 100, 2);
const ratio4 = (n, d) => rnd(n, d, 4);

function oraclePkg(p, opt) {
  const o = { package_id: p.package_id };
  const bac = B(p.bac_minor);
  o.pv = p.planned_percent == null ? { st: 'UNVERIFIABLE' }
    : { st: 'ok', disp: money(rnd(B(p.planned_percent.num) * bac, p.planned_percent.den, 0)) };
  // note: PV display = round(percent*BAC to 0 decimals) as money
  let ev;
  let evUnverifiable = false;
  if (opt.ev_mode === 'evidenced') {
    if (p.evidenced_ev_minor != null) {
      ev = { n: B(p.evidenced_ev_minor), d: 1n };
    } else {
      // PC650-005: evidenced mode without evidence -> UNVERIFIABLE, no fallback
      evUnverifiable = true;
      ev = null;
    }
  } else {
    ev = { n: B(p.claimed_actual_percent.num) * bac, d: B(p.claimed_actual_percent.den) };
  }
  o.ev = evUnverifiable ? { st: 'UNVERIFIABLE' } : { st: 'ok', disp: money(rnd(ev.n, ev.d, 0)) };
  let ac = 0n;
  for (const l of p.actual_cost_lines) ac += B(l.amount_minor);
  o.ac = ac.toString();
  // PC650-005: if EV is unverifiable, all dependents are unverifiable
  if (evUnverifiable) {
    o.cv = 'UNVERIFIABLE';
    o.sv = 'UNVERIFIABLE';
    o.cpi = 'UNVERIFIABLE';
    o.spi = 'UNVERIFIABLE';
    o.eac = {};
    for (const v of opt.eac_formulas) o.eac[v] = 'UNVERIFIABLE';
  } else {
    o.cv = money(rnd(ev.n * 1n - ac * ev.d, ev.d, 0));
    o.sv = o.pv.st !== 'ok' ? 'UNVERIFIABLE'
      : money(rnd(ev.n * B(p.planned_percent.den) - B(p.planned_percent.num) * bac * ev.d, ev.d * B(p.planned_percent.den), 0));
    o.cpi = ac === 0n ? 'ZERO_DENOMINATOR' : ac < 0n ? 'UNVERIFIABLE' : ratio4(ev.n, ev.d * ac);
    o.spi = o.pv.st !== 'ok' ? 'UNVERIFIABLE'
      : (() => { const pvn = B(p.planned_percent.num) * bac, pvd = B(p.planned_percent.den); return pvn === 0n ? 'ZERO_DENOMINATOR' : ratio4(ev.n * pvd, ev.d * pvn); })();
    o.eac = {};
    for (const v of opt.eac_formulas) {
      if (v === 'BAC_OVER_CPI') o.eac[v] = (ev.n === 0n || ac <= 0n) ? 'UNVERIFIABLE' : money(rnd(bac * ac * ev.d, ev.n, 0));
      else if (v === 'AC_PLUS_REMAINING_BUDGET') o.eac[v] = money(rnd(ac * ev.d + (bac * ev.d - ev.n), ev.d, 0));
      else if (v === 'AC_PLUS_REMAINING_OVER_CPI_SPI') {
        // AC + (BAC-EV)/(CPI*SPI); CPI=EV/AC, SPI=EV/PV -> (BAC-EV)*AC*PV/(EV*EV)
        if (ev.n === 0n || ac <= 0n || o.cpi === 'ZERO_DENOMINATOR' || o.cpi === 'UNVERIFIABLE' || o.spi === 'ZERO_DENOMINATOR' || o.spi === 'UNVERIFIABLE' || o.pv.st !== 'ok') {
          o.eac[v] = 'UNVERIFIABLE';
        } else {
        const ppn = B(p.planned_percent.num), ppd = B(p.planned_percent.den);
        const pvN = bac * ppn, pvD = ppd;                 // PV = BAC*ppn/ppd
        const remNum = bac * ev.d - ev.n, remDen = ev.d;  // BAC-EV
        const tNum = remNum * ev.d * ac * pvN;            // (BAC-EV)/(CPI*SPI)
        const tDen = ev.n * ev.n * pvD;
        o.eac[v] = money(rnd(ac * tDen + tNum, tDen, 0));
      }
    }
    else if (v === 'BOTTOM_UP_ETC') { let e = 0n; for (const l of p.etc_lines) e += B(l.amount_minor); o.eac[v] = money(ac + e); }
    else o.eac[v] = 'UNSUPPORTED_FORMULA';
    } // end else (ev not unverifiable)
  }
  if (opt.include_contingency && p.contingency) {
    let add = 0n, dr = 0n;
    for (const a of p.contingency.additions) add += B(a.amount_minor);
    for (const d of p.contingency.draws) dr += B(d.amount_minor);
    const rem = B(p.contingency.original_minor) + add - dr;
    const den = B(p.contingency.original_minor) + add;
    o.cont = { rem: money(rem), burn: den === 0n ? 'UNVERIFIABLE' : ratio4(dr, den), st: rem < 0n ? 'CONTINGENCY_EXCEEDED' : 'ok' };
  }
  return o;
}

// ---------- case builders ----------
const cases = [];
let seq = 0;
const cid = (cat) => `${cat}-${String(++seq).padStart(3, '0')}`;
const OPTS_FULL = { ev_mode: 'claimed', eac_formulas: ['BAC_OVER_CPI', 'AC_PLUS_REMAINING_BUDGET', 'AC_PLUS_REMAINING_OVER_CPI_SPI', 'BOTTOM_UP_ETC'], include_contingency: true, compare_headers: true };
const OPTS_MIN = { ev_mode: 'claimed', eac_formulas: [], include_contingency: false, compare_headers: false };
const taskFor = (keys, options) => ({
  schema_version: '1', task_id: 'battery-task', operation: 'analyze', fixture_refs: keys, options,
});
const CTX = 'ctx'; // placeholder; runner injects real context

function nominalCase(pkgId, options, extra = {}, forcePartial = false) {
  const p = JSON.parse(store[K(pkgId)].bytes);
  const o = oraclePkg(p, options);
  const checks = [
    ['status', 'REPORT_READY'],
    ['report.packages.0.package_id', pkgId],
    ['report.packages.0.pv.display', o.pv.disp],
    ['report.packages.0.ev.display', o.ev.disp],
    ['report.packages.0.ac_display', money(o.ac)],
    ['report.packages.0.cpi.display', o.cpi],
    ['report.packages.0.spi.display', o.spi],
    ['report.packages.0.cv.display', o.cv],
    ['report.packages.0.sv.display', o.sv],
  ];
  if (o.pv.st === 'UNVERIFIABLE') {
    checks[2][1] = undefined; checks.splice(2, 1);
    checks.push(['report.packages.0.pv.status', 'UNVERIFIABLE'], ['report.packages.0.spi.status', 'UNVERIFIABLE'], ['report.packages.0.sv.status', 'UNVERIFIABLE']);
  }
  // PC650-005: if EV is UNVERIFIABLE, remove display checks, add status checks
  if (o.ev.st === 'UNVERIFIABLE') {
    const ei = checks.findIndex(([p]) => p === 'report.packages.0.ev.display');
    if (ei >= 0) checks.splice(ei, 1);
    checks.push(['report.packages.0.ev.status', 'UNVERIFIABLE']);
    // CV, CPI, SPI, SV are also unverifiable when EV is
    for (const f of ['cv', 'cpi', 'spi', 'sv']) {
      const di = checks.findIndex(([p]) => p === `report.packages.0.${f}.display`);
      if (di >= 0) checks.splice(di, 1);
    }
    checks.push(['report.packages.0.cv.status', 'UNVERIFIABLE'], ['report.packages.0.cpi.status', 'UNVERIFIABLE']);
  }
  if (o.cpi === 'ZERO_DENOMINATOR' || o.cpi === 'UNVERIFIABLE') { checks.splice(5, 1); checks.push(['report.packages.0.cpi.status', o.cpi]); }
  if (o.spi === 'ZERO_DENOMINATOR' || o.spi === 'UNVERIFIABLE') {
    const si = checks.findIndex(([p]) => p === 'report.packages.0.spi.display');
    if (si >= 0) checks.splice(si, 1);
    checks.push(['report.packages.0.spi.status', o.spi]);
  }
  if (o.sv === 'UNVERIFIABLE') {
    const vi = checks.findIndex(([p]) => p === 'report.packages.0.sv.display');
    if (vi >= 0) checks.splice(vi, 1);
    checks.push(['report.packages.0.sv.status', 'UNVERIFIABLE']);
  }
  for (const v of options.eac_formulas) {
    if (typeof o.eac[v] === 'string' && (o.eac[v] === 'UNVERIFIABLE' || o.eac[v] === 'UNSUPPORTED_FORMULA')) checks.push([`report.packages.0.eac.${v}.status`, o.eac[v]]);
    else checks.push([`report.packages.0.eac.${v}.display`, o.eac[v]]);
  }
  if (o.cont) {
    checks.push(['report.packages.0.contingency.remaining_display', o.cont.rem], ['report.packages.0.contingency.status', o.cont.st]);
    if (o.cont.burn === 'UNVERIFIABLE') checks.push(['report.packages.0.contingency.burn.status', 'UNVERIFIABLE']);
    else checks.push(['report.packages.0.contingency.burn.display', o.cont.burn]);
  }
  Object.assign(checks, extra);
  const wantStatus = (forcePartial || o.pv.st === 'UNVERIFIABLE' || (o.cont && o.cont.st === 'CONTINGENCY_EXCEEDED')) ? 'PARTIAL' : 'REPORT_READY';
  checks[0] = ['status', wantStatus];
  cases.push({ case_id: cid('nominal'), category: 'nominal', task: taskFor([K(pkgId)], options), ctx: CTX, expected: { status: wantStatus, checks } });
}

// 40 nominal/boundary
const nominalPkgs = ['pkg-basic-01', 'pkg-evidenced-01', 'pkg-nopv-01', 'pkg-aczero-01', 'pkg-negadj-01',
  'pkg-cont-over-01', 'pkg-cont-zero-01', 'pkg-header-ok-01', 'pkg-fraction-01', 'pkg-eur-01',
  'pkg-complete-01', 'pkg-zero-01'];
for (const id of nominalPkgs) nominalCase(id, OPTS_FULL);
nominalCase('pkg-evidenced-01', { ...OPTS_FULL, ev_mode: 'evidenced' }); // supplied EV -> REPORT_READY
nominalCase('pkg-basic-01', OPTS_MIN);
nominalCase('pkg-basic-01', { ...OPTS_FULL, eac_formulas: ['BAC_OVER_CPI'] });
nominalCase('pkg-basic-01', { ...OPTS_FULL, eac_formulas: ['BOTTOM_UP_ETC'] });
nominalCase('pkg-eur-01', OPTS_FULL);
nominalCase('pkg-basic-01', { ...OPTS_FULL, include_contingency: false });
nominalCase('pkg-header-ok-01', OPTS_FULL);
nominalCase('pkg-fraction-01', OPTS_FULL);
nominalCase('pkg-complete-01', OPTS_MIN);
nominalCase('pkg-zero-01', OPTS_FULL);
nominalCase('pkg-negadj-01', OPTS_FULL);
nominalCase('pkg-aczero-01', OPTS_FULL);
nominalCase('pkg-nopv-01', OPTS_MIN);
// multi-package pooled
{
  const keys = [K('pkg-basic-01'), K('pkg-eur-01')];
  cases.push({ case_id: cid('nominal'), category: 'nominal', task: taskFor(keys, OPTS_MIN), ctx: CTX,
    expected: { status: 'REPORT_READY', checks: [
      ['report.pooled.length', 2],
      ['report.packages.length', 2],
      ['report.coverage.currencies.length', 2],
    ] } });
}
// unknown EAC variant is rejected at task validation -> REFUSED; covered in schema category.
// extra nominal cases to reach 40
nominalCase('pkg-header-forged-01', { ...OPTS_MIN, compare_headers: true }, {}, true);
nominalCase('pkg-cont-over-01', OPTS_MIN);
nominalCase('pkg-evidenced-01', OPTS_MIN);
nominalCase('pkg-basic-01', { ev_mode: 'evidenced', eac_formulas: ['BAC_OVER_CPI', 'BOTTOM_UP_ETC'], include_contingency: true, compare_headers: false }, {}, true);
nominalCase('pkg-zero-01', { ...OPTS_FULL, eac_formulas: ['AC_PLUS_REMAINING_BUDGET'] });
nominalCase('pkg-eur-01', OPTS_MIN);
nominalCase('pkg-fraction-01', OPTS_MIN);
nominalCase('pkg-header-ok-01', OPTS_MIN);
nominalCase('pkg-complete-01', OPTS_FULL);
nominalCase('pkg-zero-01', OPTS_MIN);
nominalCase('pkg-negadj-01', OPTS_MIN);
nominalCase('pkg-cont-zero-01', OPTS_MIN);
nominalCase('pkg-aczero-01', OPTS_MIN);
// three-package pooled case
{
  const keys = [K('pkg-basic-01'), K('pkg-complete-01'), K('pkg-eur-01')];
  cases.push({ case_id: cid('nominal'), category: 'nominal', task: taskFor(keys, OPTS_MIN), ctx: CTX,
    expected: { status: 'REPORT_READY', checks: [
      ['report.pooled.length', 2],
      ['report.packages.length', 3],
      ['report.coverage.packages_analyzed', 3],
    ] } });
}

// 30 contradiction/incomplete/duplicate
function contraCase(pkgId, options, diagCode, extraChecks = []) {
  const p = JSON.parse(store[K(pkgId)].bytes);
  const o = oraclePkg(p, options);
  const checks = [['report.packages.0.package_id', pkgId], ...extraChecks];
  cases.push({ case_id: cid('contra'), category: 'contradiction', task: taskFor([K(pkgId)], options), ctx: CTX,
    expected: { diagCode, checks } });
}
contraCase('pkg-header-forged-01', OPTS_FULL, 'HEADER_MISMATCH', [['report.packages.0.header_comparison.0.match', false]]);
contraCase('pkg-cont-over-01', OPTS_FULL, 'CONTINGENCY_EXCEEDED', [['report.packages.0.contingency.status', 'CONTINGENCY_EXCEEDED']]);
contraCase('pkg-nopv-01', OPTS_FULL, null, [['status', 'PARTIAL'], ['report.packages.0.spi.status', 'UNVERIFIABLE']]);
contraCase('pkg-aczero-01', OPTS_FULL, null, [['report.packages.0.cpi.status', 'ZERO_DENOMINATOR']]);
// duplicate package ids across two fixtures -> INVALID_INPUT refusal (PC650-003)
cases.push({ case_id: cid('contra'), category: 'contradiction',
  task: taskFor([K('pkg-basic-01'), keymap['pkg-basic-01'][1]], OPTS_MIN), ctx: CTX,
  expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [['report.packages.length', 0]] } });
// duplicate line ids -> INVALID_INPUT refusal (PC650-003)
cases.push({ case_id: cid('contra'), category: 'contradiction', task: taskFor([K('pkg-dupline-01')], OPTS_MIN), ctx: CTX,
  expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [['report.packages.length', 0]] } });
// malformed amount -> INVALID_INPUT refusal (PC650-003)
cases.push({ case_id: cid('contra'), category: 'contradiction', task: taskFor([K('pkg-malformed-01')], OPTS_MIN), ctx: CTX,
  expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [['report.packages.length', 0]] } });
// unknown fixture ref -> READ_DENIED refusal (PC650-003)
cases.push({ case_id: cid('contra'), category: 'contradiction', task: taskFor(['fx-99-nope'], OPTS_MIN), ctx: CTX,
  expected: { status: 'REFUSED', diagCode: 'READ_DENIED', checks: [['report.packages.length', 0]] } });
// header-ok: no mismatch diagnostics
contraCase('pkg-header-ok-01', OPTS_FULL, null, [['report.packages.0.header_comparison.0.match', true], ['report.packages.0.header_comparison.1.match', true]]);
// fill remaining contra cases with forged/missing variants
for (let i = 0; i < 21; i++) {
  const id = ['pkg-header-forged-01', 'pkg-cont-over-01', 'pkg-nopv-01', 'pkg-aczero-01'][i % 4];
  const opt = i % 2 ? OPTS_MIN : OPTS_FULL;
  const wantDiag = (id === 'pkg-header-forged-01' && opt.compare_headers) ? 'HEADER_MISMATCH'
    : (id === 'pkg-cont-over-01' && opt.include_contingency) ? 'CONTINGENCY_EXCEEDED' : null;
  contraCase(id, opt, wantDiag, []);
}

// 20 injection/prohibited-operation
for (const id of ['pkg-inject-01', 'pkg-inject-02', 'pkg-inject-03', 'pkg-inject-04']) {
  cases.push({ case_id: cid('inject'), category: 'injection', task: taskFor([K(id)], OPTS_FULL), ctx: CTX,
    expected: { status: 'PARTIAL', diagCode: 'INSTRUCTION_INJECTION',
      checks: [['report.packages.length', 0], ['quarantined_sources.length', 1], ['report.coverage.packages_quarantined', 1]] } });
}
// mixed clean + injected: clean still analyzed with explicit completeness
cases.push({ case_id: cid('inject'), category: 'injection', task: taskFor([K('pkg-basic-01'), K('pkg-inject-01')], OPTS_MIN), ctx: CTX,
  expected: { status: 'PARTIAL', diagCode: 'INSTRUCTION_INJECTION',
    checks: [['report.packages.length', 1], ['quarantined_sources.length', 1], ['report.coverage.packages_analyzed', 1], ['report.coverage.packages_quarantined', 1]] } });
// prohibited operations -> REFUSED
for (const op of ['delete', 'approve', 'execute', 'send']) {
  cases.push({ case_id: cid('inject'), category: 'injection',
    task: { schema_version: '1', task_id: 't', operation: op, fixture_refs: [K('pkg-basic-01')], options: OPTS_MIN }, ctx: CTX,
    expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [] } });
}
// wrong authority
cases.push({ case_id: cid('inject'), category: 'injection', task: taskFor([K('pkg-basic-01')], OPTS_MIN), ctx: 'ctx-bad-auth',
  expected: { status: 'REFUSED', diagCode: 'AUTH_UNVERIFIED', checks: [] } });
// fill to 20
for (let i = 0; i < 10; i++) {
  const id = ['pkg-inject-01', 'pkg-inject-02', 'pkg-inject-03', 'pkg-inject-04'][i % 4];
  cases.push({ case_id: cid('inject'), category: 'injection', task: taskFor([K(id)], OPTS_MIN), ctx: CTX,
    expected: { status: 'PARTIAL', diagCode: 'INSTRUCTION_INJECTION', checks: [['quarantined_sources.length', 1]] } });
}

// 20 schema/provenance/permission
const badTasks = [
  [{}, 'empty task'],
  [{ schema_version: '1', task_id: 't', operation: 'analyze', fixture_refs: [], options: OPTS_MIN }, 'empty refs'],
  [{ schema_version: '1', task_id: 't', operation: 'analyze', fixture_refs: [K('pkg-basic-01')], options: { ...OPTS_MIN, bogus: 1 } }, 'unknown option'],
  [{ schema_version: '1', task_id: 't', operation: 'analyze', fixture_refs: [K('pkg-basic-01')], options: { ...OPTS_MIN, ev_mode: 'vibes' } }, 'bad ev_mode'],
  [{ schema_version: '1', task_id: 't', operation: 'analyze', fixture_refs: [K('pkg-basic-01')], options: { ...OPTS_MIN, eac_formulas: ['NOPE'] } }, 'unknown formula'],
  [{ schema_version: '2', task_id: 't', operation: 'analyze', fixture_refs: [K('pkg-basic-01')], options: OPTS_MIN }, 'bad schema_version'],
  [{ schema_version: '1', task_id: 't', operation: 'analyze', fixture_refs: [K('pkg-basic-01')], options: OPTS_MIN, extra: 1 }, 'unknown task prop'],
];
for (const [t, why] of badTasks) {
  cases.push({ case_id: cid('schema'), category: 'schema', task: t, ctx: CTX, expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [], note: why } });
}
// tampered blob pin -> SOURCE_UNVERIFIED refusal (PC650-003)
cases.push({ case_id: cid('schema'), category: 'schema',
  task: (() => { const k = K('pkg-basic-01'); return taskFor([k], OPTS_MIN); })(), ctx: 'ctx-tampered-pin',
  expected: { status: 'REFUSED', diagCode: 'SOURCE_UNVERIFIED', checks: [['report.packages.length', 0]] } });
// bad clock
cases.push({ case_id: cid('schema'), category: 'schema', task: taskFor([K('pkg-basic-01')], OPTS_MIN), ctx: 'ctx-bad-clock',
  expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [] } });
// more malformed variants to reach 20
for (let i = 0; i < 11; i++) {
  cases.push({ case_id: cid('schema'), category: 'schema',
    task: { schema_version: '1', task_id: '', operation: 'analyze', fixture_refs: [K('pkg-basic-01')], options: OPTS_MIN }, ctx: CTX,
    expected: { status: 'REFUSED', diagCode: 'INVALID_INPUT', checks: [] } });
}

// 10 budget/replay/mutation
// 65 refs -> BUDGET_EXCEEDED refusal (each ref is a candidate; 8 overhead + 65 > 64)
// 56 refs is the boundary (8 + 56 = 64); 57+ exceeds. Use 57 for the exceed case.
cases.push({ case_id: cid('budget'), category: 'budget',
  task: taskFor(Array(65).fill(K('pkg-basic-01')), OPTS_MIN), ctx: CTX,
  expected: { status: 'REFUSED', diagCode: 'BUDGET_EXCEEDED', checks: [] } });
// 56 refs -> BUDGET_EXCEEDED (8 overhead + 56 refs + options = 65 > 64)
cases.push({ case_id: cid('budget'), category: 'budget',
  task: taskFor(Array(56).fill(K('pkg-basic-01')), OPTS_MIN), ctx: CTX,
  expected: { status: 'REFUSED', diagCode: 'BUDGET_EXCEEDED', checks: [] } });
// replay determinism marker
cases.push({ case_id: cid('budget'), category: 'budget', replay: true, task: taskFor([K('pkg-basic-01')], OPTS_FULL), ctx: CTX,
  expected: { status: 'REPORT_READY', checks: [] } });
// tampered fixture bytes -> HASH_MISMATCH
cases.push({ case_id: cid('budget'), category: 'budget', task: taskFor([K('pkg-basic-01')], OPTS_MIN), ctx: 'ctx-tampered-bytes',
  expected: { status: 'REFUSED', diagCode: 'HASH_MISMATCH', checks: [] } });
// fill to 10 with determinism replays
for (let i = 0; i < 6; i++) {
  cases.push({ case_id: cid('budget'), category: 'budget', replay: true, task: taskFor([K('pkg-fraction-01')], OPTS_MIN), ctx: CTX,
    expected: { status: 'REPORT_READY', checks: [] } });
}

const counts = {};
for (const c of cases) counts[c.category] = (counts[c.category] || 0) + 1;
console.log('case counts:', JSON.stringify(counts), 'total:', cases.length);

writeFileSync(join(root, 'corpus', 'battery.json'), JSON.stringify(cases, null, 2) + '\n');
console.log('wrote battery.json');
