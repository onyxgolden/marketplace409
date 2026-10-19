// controls.js — earned-value arithmetic over invented work packages.
// Exact rational minor-unit math (BigInt). Forecasts are explicitly
// SYNTHETIC ARITHMETIC EXERCISE — never a project forecast.

import { roundRational, formatMinor, formatRatio, cmpRational } from './canonical.js';

const FORMULA_VERSION = 'controls-v1';
const ROUNDING_VERSION = 'half-away-from-zero/v1';

// ---- rational helpers on {n: BigInt, d: BigInt} ----

function rat(n, d) { return { n: BigInt(n), d: BigInt(d) }; }
function ratIsZero(r) { return r.n === 0n; }
function ratNeg(r) { return { n: -r.n, d: r.d }; }
function ratAdd(a, b) { return { n: a.n * b.d + b.n * a.d, d: a.d * b.d }; }
function ratSub(a, b) { return { n: a.n * b.d - b.n * a.d, d: a.d * b.d }; }
function ratMul(a, b) { return { n: a.n * b.n, d: a.d * b.d }; }
function ratDiv(a, b) {
  if (b.n === 0n) return null;
  let n = a.n * b.d, d = a.d * b.n;
  if (d < 0n) { n = -n; d = -d; }
  return { n, d };
}
function ratFromInt(i) { return { n: BigInt(i), d: 1n }; }
// percent {num,den} * int minor -> rational
function percentOf(pct, minor) { return { n: BigInt(pct.num) * BigInt(minor), d: BigInt(pct.den) }; }

/**
 * Analyze one validated package. ctx: {evMode, eacFormulas, includeContingency,
 * compareHeaders, chargeSpan, quarantine}.
 * Returns { result, diagnostics } where result fields carry status tags.
 */
export function analyzePackage(pkg, ctx) {
  const diagnostics = [];
  const R = { package_id: pkg.package_id, currency: pkg.currency };

  R.bac_minor = pkg.bac_minor;
  R.bac_display = formatMinor(pkg.bac_minor);
  R.provenance = {
    bac: 'declared-baseline',
    pv: 'derived-from-plan',
    ev: ctx.evMode === 'evidenced' && pkg.evidenced_ev_minor != null ? 'evidenced' : 'derived-from-claim',
    note: 'All forecast values are SYNTHETIC ARITHMETIC EXERCISE — not a project forecast.',
  };
  R.citations = { package: pkg.source_ref, lines: [] };

  // PV
  if (pkg.planned_percent == null) {
    R.pv = { status: 'UNVERIFIABLE', reason: 'planned_percent not declared' };
    diagnostics.push(diag('PV_UNVERIFIABLE', 'medium', pkg.package_id, 'planned_percent not declared; PV/SPI/SV unavailable'));
  } else {
    const pv = percentOf(pkg.planned_percent, pkg.bac_minor);
    R.pv = { status: 'ok', n: pv.n.toString(), d: pv.d.toString(), display: formatMinor(roundRational(pv.n, pv.d, 0)) };
  }

  // EV
  let ev;
  if (ctx.evMode === 'evidenced' && pkg.evidenced_ev_minor != null) {
    ev = ratFromInt(pkg.evidenced_ev_minor);
    R.ev_mode = 'evidenced';
  } else {
    ev = percentOf(pkg.claimed_actual_percent, pkg.bac_minor);
    R.ev_mode = 'claimed';
    if (ctx.evMode === 'evidenced' && pkg.evidenced_ev_minor == null) {
      diagnostics.push(diag('EV_UNVERIFIABLE', 'medium', pkg.package_id, 'evidenced EV mode selected but no evidenced_ev_minor supplied; fell back to claimed percent'));
      R.ev_mode = 'claimed-fallback';
    }
  }
  R.ev = { status: 'ok', n: ev.n.toString(), d: ev.d.toString(), display: formatMinor(roundRational(ev.n, ev.d, 0)) };
  R.claim_note = 'claimed progress remains a claim: exact arithmetic never upgrades physical completion';

  // AC
  let ac = 0n;
  const lineIds = [];
  for (const ln of pkg.actual_cost_lines) {
    ctx.chargeSpan();
    ac += BigInt(ln.amount_minor);
    lineIds.push(ln.line_id);
  }
  R.ac_minor = ac.toString();
  R.ac_display = formatMinor(ac);
  R.citations.lines = lineIds;

  // CV = EV - AC
  const cv = ratSub(ev, ratFromInt(ac));
  R.cv = { status: 'ok', n: cv.n.toString(), d: cv.d.toString(), display: formatMinor(roundRational(cv.n, cv.d, 0)) };

  // SV = EV - PV (needs PV)
  if (R.pv.status === 'ok') {
    const pv = rat(BigInt(R.pv.n), BigInt(R.pv.d));
    const sv = ratSub(ev, pv);
    R.sv = { status: 'ok', n: sv.n.toString(), d: sv.d.toString(), display: formatMinor(roundRational(sv.n, sv.d, 0)) };
  } else {
    R.sv = { status: 'UNVERIFIABLE', reason: 'missing PV blocks SV' };
  }

  // CPI = EV / AC — nonpositive pooled AC invalidates
  if (ac === 0n) {
    R.cpi = { status: 'ZERO_DENOMINATOR', reason: 'AC is zero' };
  } else if (ac < 0n) {
    R.cpi = { status: 'UNVERIFIABLE', reason: 'nonpositive AC invalidates CPI' };
    diagnostics.push(diag('CPI_INVALID', 'high', pkg.package_id, 'AC <= 0; CPI not computed'));
  } else {
    const cpi = ratDiv(ev, ratFromInt(ac));
    R.cpi = { status: 'ok', n: cpi.n.toString(), d: cpi.d.toString(), display: formatRatio(cpi.n, cpi.d) };
  }

  // SPI = EV / PV (needs PV)
  if (R.pv.status !== 'ok') {
    R.spi = { status: 'UNVERIFIABLE', reason: 'missing PV blocks SPI' };
  } else {
    const pv = rat(BigInt(R.pv.n), BigInt(R.pv.d));
    if (ratIsZero(pv)) {
      R.spi = { status: 'ZERO_DENOMINATOR', reason: 'PV is zero' };
    } else {
      const spi = ratDiv(ev, pv);
      R.spi = { status: 'ok', n: spi.n.toString(), d: spi.d.toString(), display: formatRatio(spi.n, spi.d) };
    }
  }

  // EAC variants
  R.eac = {};
  R.formula_version = FORMULA_VERSION;
  for (const variant of ctx.eacFormulas) {
    R.eac[variant] = computeEac(variant, { bac: ratFromInt(pkg.bac_minor), ev, ac, pv: R.pv.status === 'ok' ? rat(BigInt(R.pv.n), BigInt(R.pv.d)) : null, cpi: R.cpi, spi: R.spi, etcLines: pkg.etc_lines, chargeSpan: ctx.chargeSpan, packageId: pkg.package_id, diagnostics });
  }

  // Contingency
  if (ctx.includeContingency && pkg.contingency) {
    R.contingency = analyzeContingency(pkg.contingency, ctx, pkg.package_id, diagnostics);
  }

  // Header comparison — exact rational compare, no display tolerance
  R.header_comparison = [];
  if (ctx.compareHeaders && pkg.header_claims) {
    const h = pkg.header_claims;
    compareHeaderRatio(R, h, 'cpi', R.cpi, pkg.package_id, diagnostics);
    compareHeaderRatio(R, h, 'spi', R.spi, pkg.package_id, diagnostics);
    compareHeaderMoney(R, h, 'cv_minor', R.cv, pkg.package_id, diagnostics);
    compareHeaderMoney(R, h, 'sv_minor', R.sv, pkg.package_id, diagnostics);
  }

  R.rounding_version = ROUNDING_VERSION;
  return { result: R, diagnostics };
}

function compareHeaderRatio(R, h, field, computed, packageId, diagnostics) {
  if (h[field] == null) return;
  if (computed.status !== 'ok') {
    R.header_comparison.push({ field, claimed: `${h[field].num}/${h[field].den}`, computed: computed.status, match: false, note: 'computed value unavailable; claim unverifiable' });
    return;
  }
  const match = cmpRational(BigInt(h[field].num), BigInt(h[field].den), BigInt(computed.n), BigInt(computed.d)) === 0;
  R.header_comparison.push({ field, claimed: `${h[field].num}/${h[field].den}`, computed: `${computed.n}/${computed.d}`, computed_display: computed.display, match });
  if (!match) {
    diagnostics.push(diag('HEADER_MISMATCH', 'high', packageId, `header ${field} claim ${h[field].num}/${h[field].den} != recomputed ${computed.n}/${computed.d} (display ${computed.display})`));
  }
}

function compareHeaderMoney(R, h, field, computed, packageId, diagnostics) {
  if (h[field] == null) return;
  if (computed.status !== 'ok') {
    R.header_comparison.push({ field, claimed_minor: h[field], computed: computed.status, match: false });
    return;
  }
  // exact: claimed minor units vs recomputed rounded-to-cents minor units
  const recomputedMinor = roundRational(BigInt(computed.n), BigInt(computed.d), 0);
  const match = BigInt(h[field]) === BigInt(recomputedMinor);
  R.header_comparison.push({ field, claimed_minor: h[field], recomputed_minor: recomputedMinor, match });
  if (!match) {
    diagnostics.push(diag('HEADER_MISMATCH', 'high', packageId, `header ${field} claim ${h[field]} != recomputed ${recomputedMinor}`));
  }
}

function computeEac(variant, p) {
  const { bac, ev, ac, cpi, spi, etcLines } = p;
  const fail = (code, reason) => {
    p.diagnostics.push(diag(code, 'medium', p.packageId, `EAC ${variant}: ${reason}`));
    return { status: code === 'UNSUPPORTED_FORMULA' ? 'UNSUPPORTED_FORMULA' : 'UNVERIFIABLE', reason };
  };
  const okOut = (r) => ({ status: 'ok', n: r.n.toString(), d: r.d.toString(), display: formatMinor(roundRational(r.n, r.d, 0)) });

  switch (variant) {
    case 'BAC_OVER_CPI': {
      // BAC / CPI = BAC*AC/EV ; requires EV != 0 and AC > 0
      if (ratIsZero(ev)) return fail('UNVERIFIABLE', 'EV is zero');
      if (ac <= 0n) return fail('UNVERIFIABLE', 'nonpositive AC invalidates BAC_OVER_CPI');
      return okOut(ratDiv(ratMul(bac, ratFromInt(ac)), ev));
    }
    case 'AC_PLUS_REMAINING_BUDGET': {
      return okOut(ratAdd(ratFromInt(ac), ratSub(bac, ev)));
    }
    case 'AC_PLUS_REMAINING_OVER_CPI_SPI': {
      // AC + (BAC-EV)/(CPI*SPI); requires EV != 0, PV != 0, AC > 0
      if (ratIsZero(ev)) return fail('UNVERIFIABLE', 'EV is zero');
      if (ac <= 0n) return fail('UNVERIFIABLE', 'nonpositive AC invalidates variant');
      if (cpi.status !== 'ok' || spi.status !== 'ok') return fail('UNVERIFIABLE', 'CPI and SPI must both be computable');
      const cpiR = rat(BigInt(cpi.n), BigInt(cpi.d));
      const spiR = rat(BigInt(spi.n), BigInt(spi.d));
      const denom = ratMul(cpiR, spiR);
      if (ratIsZero(denom)) return fail('UNVERIFIABLE', 'CPI*SPI is zero');
      return okOut(ratAdd(ratFromInt(ac), ratDiv(ratSub(bac, ev), denom)));
    }
    case 'BOTTOM_UP_ETC': {
      let etc = 0n;
      for (const ln of etcLines) {
        p.chargeSpan();
        etc += BigInt(ln.amount_minor);
      }
      return okOut(ratAdd(ratFromInt(ac), ratFromInt(etc)));
    }
    default:
      return fail('UNSUPPORTED_FORMULA', `unknown variant ${variant}`);
  }
}

function analyzeContingency(c, ctx, packageId, diagnostics) {
  let additions = 0n;
  const drawIds = [];
  let draws = 0n;
  for (const a of c.additions) { ctx.chargeSpan(); additions += BigInt(a.amount_minor); }
  for (const d of c.draws) { ctx.chargeSpan(); draws += BigInt(d.amount_minor); drawIds.push(d.line_id); }
  const original = BigInt(c.original_minor);
  const remaining = original + additions - draws;
  const out = {
    original_minor: original.toString(),
    additions_minor: additions.toString(),
    draws_minor: draws.toString(),
    remaining_minor: remaining.toString(),
    remaining_display: formatMinor(remaining),
    draw_line_ids: drawIds,
    attribution_note: 'additions carry simulated approval attribution only, not authority to spend',
  };
  const denom = original + additions;
  if (denom === 0n) {
    out.burn = { status: 'UNVERIFIABLE', reason: 'zero reserve denominator' };
  } else {
    out.burn = { status: 'ok', display: formatRatio(draws, denom) };
  }
  if (remaining < 0n) {
    out.status = 'CONTINGENCY_EXCEEDED';
    diagnostics.push(diag('CONTINGENCY_EXCEEDED', 'high', packageId, `contingency remaining ${remaining} minor units is negative`));
  } else {
    out.status = 'ok';
  }
  return out;
}

function diag(code, severity, record_id, reason) {
  return { code, severity, record_id, source_ref: null, reason };
}

/**
 * Pool per-currency-group aggregates. Ratios are pooled sums, never averages.
 * packages: array of per-package results. Returns {pools: [...], diagnostics}.
 */
export function poolByCurrency(pkgResults, ctx) {
  const groups = new Map();
  for (const pr of pkgResults) {
    if (!groups.has(pr.currency)) groups.set(pr.currency, []);
    groups.get(pr.currency).push(pr);
  }
  const pools = [];
  const diagnostics = [];
  for (const [currency, members] of groups) {
    ctx.chargeSpan();
    let bac = 0n, pvN = 0n, pvD = 1n, evN = 0n, evD = 1n, ac = 0n;
    let pvOk = true;
    for (const m of members) {
      bac += BigInt(m.bac_minor);
      ac += BigInt(m.ac_minor);
      if (m.pv.status === 'ok') {
        const t = ratAdd(rat(pvN, pvD), rat(BigInt(m.pv.n), BigInt(m.pv.d)));
        pvN = t.n; pvD = t.d;
      } else { pvOk = false; }
      if (m.ev.status === 'ok') {
        const t = ratAdd(rat(evN, evD), rat(BigInt(m.ev.n), BigInt(m.ev.d)));
        evN = t.n; evD = t.d;
      }
    }
    const pool = { currency, member_count: members.length, bac_minor: bac.toString(), ac_minor: ac.toString() };
    const evR = rat(evN, evD);
    if (ac === 0n) pool.cpi = { status: 'ZERO_DENOMINATOR', reason: 'pooled AC is zero' };
    else if (ac < 0n) pool.cpi = { status: 'UNVERIFIABLE', reason: 'nonpositive pooled AC' };
    else { const c = ratDiv(evR, ratFromInt(ac)); pool.cpi = { status: 'ok', display: formatRatio(c.n, c.d) }; }
    if (!pvOk) pool.spi = { status: 'UNVERIFIABLE', reason: 'a member lacks PV' };
    else if (pvN === 0n) pool.spi = { status: 'ZERO_DENOMINATOR', reason: 'pooled PV is zero' };
    else { const s = ratDiv(evR, rat(pvN, pvD)); pool.spi = { status: 'ok', display: formatRatio(s.n, s.d) }; }
    pools.push(pool);
  }
  return { pools, diagnostics };
}

export { FORMULA_VERSION, ROUNDING_VERSION };
