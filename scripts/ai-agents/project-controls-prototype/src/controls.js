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
 * compareHeaders, chargeSpan, sourceBytes, sourceRef}.
 * Returns { result, diagnostics } where result fields carry status tags.
 * Every operand citation is verified against source bytes (PC650-004); failures
 * yield explicit unavailable states, never unverified labels.
 */
export function analyzePackage(pkg, ctx) {
  const diagnostics = [];
  const R = { package_id: pkg.package_id, currency: pkg.currency };
  // Finding 2 (local review): spans are UTF-8 BYTE offsets; slicing a JS string
  // uses UTF-16 code units. Convert to Buffer once so byte offsets are exact
  // for non-ASCII content.
  const srcBuf = Buffer.isBuffer(ctx.sourceBytes)
    ? ctx.sourceBytes
    : Buffer.from(ctx.sourceBytes || '', 'utf8');
  const srcRef = ctx.sourceRef || null;

  // Helper: derive and verify a money line's citation from source byte spans.
  // Returns a verified Citation or an unavailable marker. Charges the span
  // budget before checking. The byte slice must equal the amount's canonical
  // form; the citation is bound to the verified SourceRef.
  const citeLine = (ln, field, spanPath) => {
    ctx.chargeSpan();
    const span = ctx.sourceSpans ? ctx.sourceSpans.get(spanPath) : undefined;
    if (!span) {
      diagnostics.push(diag('CITATION_UNVERIFIED', 'high', pkg.package_id,
        `${field} ${ln.line_id}: no byte span for ${spanPath}`,
        { status: 'UNAVAILABLE', reason: 'missing byte span' }));
      return { status: 'UNAVAILABLE', reason: 'missing byte span' };
    }
    const expected = String(ln.amount_minor);
    const actual = srcBuf.toString('utf8', span.start, span.end);
    if (actual !== expected) {
      diagnostics.push(diag('CITATION_UNVERIFIED', 'high', pkg.package_id,
        `${field} ${ln.line_id}: byte slice ${JSON.stringify(actual)} != amount ${expected}`,
        { status: 'UNAVAILABLE', reason: 'span/amount mismatch' }));
      return { status: 'UNAVAILABLE', reason: 'span/amount mismatch' };
    }
    return {
      status: 'VERIFIED',
      // PC650-004: Citation shape per brief: quoted_span, span{start_byte,
      // end_byte, quoted_text}, verification. The two quote fields equal the
      // exact byte slice.
      quoted_span: actual,
      span: { start_byte: span.start, end_byte: span.end, quoted_text: actual },
      source_ref: srcRef,
      verification: 'BYTE_SLICE_VERIFIED',
    };
  };

  // PC650-004: cite scalar operands (bac, percents, evidenced EV, contingency
  // original, header claims). Each operand gets a verified Citation bound to
  // the source byte span, or an explicit UNAVAILABLE state. Charges the span
  // budget exactly once per operand.
  const citeOperand = (fieldName, spanPath, expectedValue) => {
    ctx.chargeSpan();
    const span = ctx.sourceSpans ? ctx.sourceSpans.get(spanPath) : undefined;
    if (!span) {
      const unavailable = { status: 'UNAVAILABLE', reason: `missing byte span for ${spanPath}` };
      diagnostics.push(diag('CITATION_UNVERIFIED', 'high', pkg.package_id,
        `${fieldName}: no byte span for ${spanPath}`, unavailable));
      return unavailable;
    }
    const actual = srcBuf.toString('utf8', span.start, span.end);
    // For objects (percents), compare parsed values; for primitives, compare strings
    let matches = false;
    try {
      const parsedActual = JSON.parse(actual);
      matches = JSON.stringify(parsedActual) === JSON.stringify(expectedValue);
    } catch {
      matches = actual === String(expectedValue);
    }
    if (!matches) {
      const unavailable = { status: 'UNAVAILABLE', reason: `span/value mismatch for ${spanPath}` };
      diagnostics.push(diag('CITATION_UNVERIFIED', 'high', pkg.package_id,
        `${fieldName}: byte slice ${JSON.stringify(actual)} != expected ${JSON.stringify(expectedValue)}`,
        unavailable));
      return unavailable;
    }
    return {
      status: 'VERIFIED',
      quoted_span: actual,
      span: { start_byte: span.start, end_byte: span.end, quoted_text: actual },
      source_ref: srcRef,
      verification: 'BYTE_SLICE_VERIFIED',
    };
  };

  R.bac_minor = pkg.bac_minor;
  R.bac_display = formatMinor(pkg.bac_minor);
  R.provenance = {
    bac: 'declared-baseline',
    pv: 'derived-from-plan',
    // R2 (local review): set after the EV branch resolves; evidenced mode
    // without evidence must not claim 'derived-from-claim'.
    ev: 'pending',
    note: 'All forecast values are SYNTHETIC ARITHMETIC EXERCISE — not a project forecast.',
  };
  // PC650-004: the package identity citation is bound to the package_id byte
  // span in the cited document (not a bare label). The source_ref pin itself
  // is verified separately by verifySourceRef.
  const pkgIdCitation = citeOperand('package_id', '$.package_id', pkg.package_id);
  R.citations = {
    package: pkgIdCitation.status === 'VERIFIED' ? {
      status: 'VERIFIED',
      quoted_span: pkgIdCitation.quoted_span,
      span: pkgIdCitation.span,
      source_ref: srcRef,
      verification: 'PACKAGE_IDENTITY_VERIFIED',
      note: 'package identity bound to verified package_id byte span; source_ref pin verified separately',
    } : pkgIdCitation,
    bac_minor: citeOperand('bac_minor', '$.bac_minor', pkg.bac_minor),
    lines: [],
  };

  // PV — PC650-004: cite the planned_percent operand
  if (pkg.planned_percent == null) {
    R.pv = { status: 'UNVERIFIABLE', reason: 'planned_percent not declared' };
    R.citations.planned_percent = { status: 'UNAVAILABLE', reason: 'planned_percent not declared' };
    diagnostics.push(diag('PV_UNVERIFIABLE', 'medium', pkg.package_id, 'planned_percent not declared; PV/SPI/SV unavailable',
      R.citations.planned_percent));
  } else {
    const pv = percentOf(pkg.planned_percent, pkg.bac_minor);
    R.pv = { status: 'ok', n: pv.n.toString(), d: pv.d.toString(), display: formatMinor(roundRational(pv.n, pv.d, 0)) };
    R.citations.planned_percent = citeOperand('planned_percent', '$.planned_percent', pkg.planned_percent);
  }

  // EV — PC650-005: evidenced mode without cited evidence yields typed
  // UNVERIFIABLE for EV and all dependents; the claimed percent is preserved
  // as a separate unverified claim, never a computational fallback.
  // PC650-004: cite the EV operand (claimed percent or evidenced EV).
  let ev = null;
  let evUnavailable = false;
  if (ctx.evMode === 'evidenced') {
    if (pkg.evidenced_ev_minor != null) {
      ev = ratFromInt(pkg.evidenced_ev_minor);
      R.ev_mode = 'evidenced';
      R.provenance.ev = 'evidenced';
      R.citations.evidenced_ev_minor = citeOperand('evidenced_ev_minor', '$.evidenced_ev_minor', pkg.evidenced_ev_minor);
    } else {
      evUnavailable = true;
      R.ev_mode = 'evidenced';
      R.ev = { status: 'UNVERIFIABLE', reason: 'evidenced EV mode selected but no evidenced_ev_minor supplied; no fallback to claimed percent' };
      R.claimed_actual_percent_unverified = { ...pkg.claimed_actual_percent, note: 'claim preserved, not used computationally' };
      R.citations.evidenced_ev_minor = { status: 'UNAVAILABLE', reason: 'evidenced_ev_minor not supplied' };
      R.citations.claimed_actual_percent = citeOperand('claimed_actual_percent', '$.claimed_actual_percent', pkg.claimed_actual_percent);
      // R2: provenance must not claim the claim was used.
      R.provenance.ev = 'unverifiable-no-evidence';
      diagnostics.push(diag('EV_UNVERIFIABLE', 'high', pkg.package_id, 'evidenced EV mode selected but no evidenced_ev_minor supplied; EV and dependents unavailable',
        R.citations.evidenced_ev_minor));
    }
  } else {
    ev = percentOf(pkg.claimed_actual_percent, pkg.bac_minor);
    R.ev_mode = 'claimed';
    R.provenance.ev = 'derived-from-claim';
    R.citations.claimed_actual_percent = citeOperand('claimed_actual_percent', '$.claimed_actual_percent', pkg.claimed_actual_percent);
  }
  if (!evUnavailable) {
    R.ev = { status: 'ok', n: ev.n.toString(), d: ev.d.toString(), display: formatMinor(roundRational(ev.n, ev.d, 0)) };
  }
  R.claim_note = 'claimed progress remains a claim: exact arithmetic never upgrades physical completion';

  // AC — each line's citation verified; unverified lines are excluded with
  // explicit accounting (never silently dropped).
  let ac = 0n;
  const lineCitations = [];
  let acUnavailable = false;
  for (let i = 0; i < pkg.actual_cost_lines.length; i++) {
    const ln = pkg.actual_cost_lines[i];
    // PC650-004: citeLine charges the span; do not double-charge here.
    const c = citeLine(ln, 'actual_cost_lines', `$.actual_cost_lines[${i}].amount_minor`);
    lineCitations.push({ line_id: ln.line_id, citation: c });
    if (c.status !== 'VERIFIED') {
      acUnavailable = true;
    } else {
      ac += BigInt(ln.amount_minor);
    }
  }
  R.citations.lines = lineCitations;
  if (acUnavailable) {
    R.ac = { status: 'UNVERIFIABLE', reason: 'one or more actual-cost line citations unverified' };
    diagnostics.push(diag('AC_UNVERIFIABLE', 'high', pkg.package_id, 'actual-cost total unavailable: citation verification failed'));
  } else {
    R.ac_minor = ac.toString();
    R.ac_display = formatMinor(ac);
  }

  // CV = EV - AC (needs both)
  if (evUnavailable || acUnavailable) {
    R.cv = { status: 'UNVERIFIABLE', reason: 'EV or AC unavailable' };
  } else {
    const cv = ratSub(ev, ratFromInt(ac));
    R.cv = { status: 'ok', n: cv.n.toString(), d: cv.d.toString(), display: formatMinor(roundRational(cv.n, cv.d, 0)) };
  }

  // SV = EV - PV (needs both)
  if (evUnavailable || R.pv.status !== 'ok') {
    R.sv = { status: 'UNVERIFIABLE', reason: 'EV or PV unavailable' };
  } else {
    const pv = rat(BigInt(R.pv.n), BigInt(R.pv.d));
    const sv = ratSub(ev, pv);
    R.sv = { status: 'ok', n: sv.n.toString(), d: sv.d.toString(), display: formatMinor(roundRational(sv.n, sv.d, 0)) };
  }

  // CPI = EV / AC (needs both, AC > 0)
  if (evUnavailable || acUnavailable) {
    R.cpi = { status: 'UNVERIFIABLE', reason: 'EV or AC unavailable' };
  } else if (ac === 0n) {
    R.cpi = { status: 'ZERO_DENOMINATOR', reason: 'AC is zero' };
  } else if (ac < 0n) {
    R.cpi = { status: 'UNVERIFIABLE', reason: 'nonpositive AC invalidates CPI' };
    diagnostics.push(diag('CPI_INVALID', 'high', pkg.package_id, 'AC <= 0; CPI not computed'));
  } else {
    const cpi = ratDiv(ev, ratFromInt(ac));
    R.cpi = { status: 'ok', n: cpi.n.toString(), d: cpi.d.toString(), display: formatRatio(cpi.n, cpi.d) };
  }

  // SPI = EV / PV (needs both)
  if (evUnavailable || R.pv.status !== 'ok') {
    R.spi = { status: 'UNVERIFIABLE', reason: 'EV or PV unavailable' };
  } else {
    const pv = rat(BigInt(R.pv.n), BigInt(R.pv.d));
    if (ratIsZero(pv)) {
      R.spi = { status: 'ZERO_DENOMINATOR', reason: 'PV is zero' };
    } else {
      const spi = ratDiv(ev, pv);
      R.spi = { status: 'ok', n: spi.n.toString(), d: spi.d.toString(), display: formatRatio(spi.n, spi.d) };
    }
  }

  // EAC variants (each needs EV unless noted)
  R.eac = {};
  R.formula_version = FORMULA_VERSION;
  const eacBase = {
    bac: ratFromInt(pkg.bac_minor), ev, ac, acUnavailable, evUnavailable,
    pv: R.pv.status === 'ok' ? rat(BigInt(R.pv.n), BigInt(R.pv.d)) : null,
    cpi: R.cpi, spi: R.spi, etcLines: pkg.etc_lines,
    chargeSpan: ctx.chargeSpan, packageId: pkg.package_id, diagnostics,
    citeLine, srcBytes: srcBuf,
  };
  for (const variant of ctx.eacFormulas) {
    R.eac[variant] = computeEac(variant, eacBase);
  }

  // Contingency (citations verified per line)
  if (ctx.includeContingency && pkg.contingency) {
    R.contingency = analyzeContingency(pkg.contingency, { ...ctx, citeLine, citeOperand }, pkg.package_id, diagnostics);
  }

  // Header comparison — exact rational compare, no display tolerance
  // PC650-004: each header claim gets a verified citation
  R.header_comparison = [];
  R.citations.header_claims = {};
  if (ctx.compareHeaders && pkg.header_claims) {
    const h = pkg.header_claims;
    for (const field of ['cpi', 'spi']) {
      if (h[field] != null) {
        R.citations.header_claims[field] = citeOperand(`header_claims.${field}`, `$.header_claims.${field}`, h[field]);
      }
    }
    for (const field of ['cv_minor', 'sv_minor', 'eac_minor']) {
      if (h[field] != null) {
        R.citations.header_claims[field] = citeOperand(`header_claims.${field}`, `$.header_claims.${field}`, h[field]);
      }
    }
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
  const { bac, ev, ac, acUnavailable, evUnavailable, cpi, spi, etcLines } = p;
  const fail = (code, reason) => {
    p.diagnostics.push(diag(code, 'medium', p.packageId, `EAC ${variant}: ${reason}`));
    return { status: code === 'UNSUPPORTED_FORMULA' ? 'UNSUPPORTED_FORMULA' : 'UNVERIFIABLE', reason };
  };
  const okOut = (r) => ({ status: 'ok', n: r.n.toString(), d: r.d.toString(), display: formatMinor(roundRational(r.n, r.d, 0)) });

  // PC650-005: dependents of unavailable EV/AC are unavailable, never computed
  // from a fallback.
  if (evUnavailable) return fail('UNVERIFIABLE', 'EV unavailable');
  if (acUnavailable && variant !== 'AC_PLUS_REMAINING_BUDGET') {
    // AC_PLUS_REMAINING_BUDGET also needs AC; all variants need it here
    return fail('UNVERIFIABLE', 'AC unavailable');
  }
  if (acUnavailable) return fail('UNVERIFIABLE', 'AC unavailable');

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
      let etcUnavailable = false;
      for (let i = 0; i < etcLines.length; i++) {
        const ln = etcLines[i];
        // PC650-004: citeLine charges the span; do not double-charge here.
        const c = p.citeLine(ln, 'etc_lines', `$.etc_lines[${i}].amount_minor`);
        if (c.status !== 'VERIFIED') {
          etcUnavailable = true;
          p.diagnostics.push(diag('CITATION_UNVERIFIED', 'high', p.packageId, `etc_lines ${ln.line_id}: citation unverified`));
        } else {
          etc += BigInt(ln.amount_minor);
        }
      }
      if (etcUnavailable) return fail('UNVERIFIABLE', 'ETC line citation unverified');
      return okOut(ratAdd(ratFromInt(ac), ratFromInt(etc)));
    }
    default:
      return fail('UNSUPPORTED_FORMULA', `unknown variant ${variant}`);
  }
}

function analyzeContingency(c, ctx, packageId, diagnostics) {
  // PC650-004: cite the original_minor operand
  const originalCitation = ctx.citeOperand ? ctx.citeOperand('contingency.original_minor', '$.contingency.original_minor', c.original_minor) : { status: 'UNAVAILABLE', reason: 'citeOperand not available' };
  let additions = 0n;
  let draws = 0n;
  let contUnavailable = false;
  if (originalCitation.status !== 'VERIFIED') contUnavailable = true;
  for (let i = 0; i < c.additions.length; i++) {
    const a = c.additions[i];
    // PC650-004: citeLine charges the span; do not double-charge here.
    const ci = ctx.citeLine(a, 'contingency.additions', `$.contingency.additions[${i}].amount_minor`);
    if (ci.status !== 'VERIFIED') contUnavailable = true;
    else additions += BigInt(a.amount_minor);
  }
  for (let i = 0; i < c.draws.length; i++) {
    const d = c.draws[i];
    // PC650-004: citeLine charges the span; do not double-charge here.
    const ci = ctx.citeLine(d, 'contingency.draws', `$.contingency.draws[${i}].amount_minor`);
    if (ci.status !== 'VERIFIED') contUnavailable = true;
    else draws += BigInt(d.amount_minor);
  }
  if (contUnavailable) {
    diagnostics.push(diag('CITATION_UNVERIFIED', 'high', packageId, 'contingency line citation unverified'));
    return { status: 'UNVERIFIABLE', reason: 'contingency line citation unverified' };
  }
  const original = BigInt(c.original_minor);
  const remaining = original + additions - draws;
  const out = {
    original_minor: original.toString(),
    original_citation: originalCitation,
    additions_minor: additions.toString(),
    draws_minor: draws.toString(),
    remaining_minor: remaining.toString(),
    remaining_display: formatMinor(remaining),
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

function diag(code, severity, record_id, reason, citation) {
  // PC650-004: diagnostics carry an explicit citation state, never a bare null.
  // If no citation is provided, the state is explicitly UNAVAILABLE.
  return {
    code,
    severity,
    record_id,
    source_ref: null, // legacy field; use citation instead
    citation: citation || { status: 'UNAVAILABLE', reason: 'no citation bound to this diagnostic' },
    reason,
  };
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
    let acOk = true;
    // PC650-009: track EV availability. If ANY member's EV is not ok, the
    // pooled EV numerator is unknown — it must NOT default to 0 (which would
    // produce a falsely verified 0.0000 CPI/SPI). Unavailable EV propagates
    // to all dependent pooled ratios; independently supported BAC/AC/PV are
    // still reported.
    let evOk = true;
    // PC650-004: collect ALL contributing member citations for the pooled
    // basis — not just BAC. A verified BAC alone cannot support CPI/SPI which
    // require AC lines, PV/planned operands, and EV operands. Each member
    // contributes its full citation set; the pool basis is VERIFIED only if
    // every member's every contributing citation is VERIFIED.
    const contributingCitations = [];
    let allCitationsVerified = true;
    for (const m of members) {
      bac += BigInt(m.bac_minor);
      // Finding 1 (local review): AC may be UNVERIFIABLE (no ac_minor field).
      // Guard instead of BigInt(undefined); mark the pool AC unavailable.
      if (typeof m.ac_minor === 'string') {
        ac += BigInt(m.ac_minor);
      } else {
        acOk = false;
        diagnostics.push(diag('AC_UNVERIFIABLE', 'high', m.package_id,
          'member AC unavailable; pooled AC unverifiable'));
      }
      // Collect the member's full citation set for the pooled basis.
      const memberCites = { package_id: m.package_id };
      if (m.citations) {
        for (const [k, cite] of Object.entries(m.citations)) {
          if (k === 'lines') {
            // Line citations: record each line's citation status.
            memberCites.lines = (cite || []).map((lc) => ({
              line_id: lc.line_id,
              status: lc.citation ? lc.citation.status : 'UNAVAILABLE',
            }));
            for (const lc of (cite || [])) {
              if (!lc.citation || lc.citation.status !== 'VERIFIED') allCitationsVerified = false;
            }
          } else if (cite && typeof cite === 'object') {
            memberCites[k] = { status: cite.status || 'UNAVAILABLE' };
            if (cite.status !== 'VERIFIED') allCitationsVerified = false;
          }
        }
      } else {
        allCitationsVerified = false;
      }
      contributingCitations.push(memberCites);
      if (m.pv.status === 'ok') {
        const t = ratAdd(rat(pvN, pvD), rat(BigInt(m.pv.n), BigInt(m.pv.d)));
        pvN = t.n; pvD = t.d;
      } else { pvOk = false; }
      if (m.ev.status === 'ok') {
        const t = ratAdd(rat(evN, evD), rat(BigInt(m.ev.n), BigInt(m.ev.d)));
        evN = t.n; evD = t.d;
      } else {
        // PC650-009: member EV unavailable — pooled EV is unknown, not zero.
        evOk = false;
        diagnostics.push(diag('EV_UNVERIFIABLE', 'high', m.package_id,
          'member EV unavailable; pooled EV/CPI/SPI unverifiable'));
      }
    }
    const pool = {
      currency,
      member_count: members.length,
      bac_minor: bac.toString(),
      ac: acOk ? { status: 'ok', minor: ac.toString() } : { status: 'UNVERIFIABLE', reason: 'a member AC is unavailable' },
      // PC650-004: pooled totals expose their FULL contributing citation
      // basis (every operand/line/rule per member), not just BAC. VERIFIED
      // only if every member's every contributing citation is VERIFIED.
      citation_basis: {
        status: allCitationsVerified ? 'VERIFIED' : 'PARTIAL',
        members: contributingCitations,
        note: allCitationsVerified
          ? `all ${members.length} members contributed fully verified citation sets`
          : 'one or more member citations are not VERIFIED; pooled basis is partial',
      },
    };
    // Keep ac_minor for backward compatibility when available.
    if (acOk) pool.ac_minor = ac.toString();
    const evR = rat(evN, evD);
    // PC650-009: pooled CPI/SPI require a KNOWN pooled EV. If any member's
    // EV was unavailable, evOk is false and the ratios are UNVERIFIABLE —
    // never computed from a zero-initialized numerator.
    if (!evOk) {
      pool.cpi = { status: 'UNVERIFIABLE', reason: 'pooled EV unavailable: a member EV is not ok' };
    } else if (!acOk) pool.cpi = { status: 'UNVERIFIABLE', reason: 'pooled AC unavailable' };
    else if (ac === 0n) pool.cpi = { status: 'ZERO_DENOMINATOR', reason: 'pooled AC is zero' };
    else if (ac < 0n) pool.cpi = { status: 'UNVERIFIABLE', reason: 'nonpositive pooled AC' };
    else { const c = ratDiv(evR, ratFromInt(ac)); pool.cpi = { status: 'ok', display: formatRatio(c.n, c.d) }; }
    if (!evOk) {
      pool.spi = { status: 'UNVERIFIABLE', reason: 'pooled EV unavailable: a member EV is not ok' };
    } else if (!pvOk) pool.spi = { status: 'UNVERIFIABLE', reason: 'a member lacks PV' };
    else if (pvN === 0n) pool.spi = { status: 'ZERO_DENOMINATOR', reason: 'pooled PV is zero' };
    else { const s = ratDiv(evR, rat(pvN, pvD)); pool.spi = { status: 'ok', display: formatRatio(s.n, s.d) }; }
    pools.push(pool);
  }
  return { pools, diagnostics };
}

export { FORMULA_VERSION, ROUNDING_VERSION };
