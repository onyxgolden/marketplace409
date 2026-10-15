/**
 * index.js — financial-manager Phase 2 slice 1 prototype.
 *
 * Draft summary reporting assembler with exact variance recomputation
 * (BigInt / exact rational, no float money) and evidence-label-preserving
 * narrative checks. Advisory only: synthetic fixtures in, draft JSON out.
 * No live ledger access, no issuance, no model calls, no file writes.
 *
 * Exposes run(task, context) -> result.
 *   task    = {task_id, bundle_refs:[SourceRef], period_ids:[], requested_action:"assemble_draft"}
 *   context = {clock, fixtureStore, approvedRepos}  (host-injected, not nested in task)
 */

import { validateTask, validateSection, validateClock } from "./schemas.js";
import { resolveRef } from "./resolver.js";
import { scanInjection } from "./injection.js";
import { canonicalBytes } from "./canonical.js";
import {
  parseAmount,
  addR,
  subR,
  eqR,
  signR,
  zeroR,
  roundRationalHalfAway,
  fmtMinor,
  fmtPct,
  exactString,
} from "./money.js";

export const SCHEMA_VERSION = "1";
export const AGENT = "financial-manager";
export const WATERMARK = "DRAFT — SYNTHETIC FIXTURE DATA — NOT A FINANCIAL STATEMENT";

const INPUT_BYTE_LIMIT = 256 * 1024;
const OUTPUT_BYTE_LIMIT = 256 * 1024;
const MAX_RESOLUTIONS = 64;
const MAX_SPANS = 512;
const MAX_OUTPUT_RECORDS = 256;

const SUMMARY_FLAG = "summary-row";

// ---------------------------------------------------------------------------
// diagnostics / envelope
// ---------------------------------------------------------------------------

function diag(code, severity, reason, sourceRef = null, recordId = null) {
  return { code, severity, source_ref: sourceRef, record_id: recordId, reason };
}

function sortDiagnostics(ds) {
  return ds
    .slice()
    .sort((a, b) =>
      a.code < b.code ? -1 : a.code > b.code ? 1 : a.reason < b.reason ? -1 : a.reason > b.reason ? 1 : 0
    );
}

function baseEnvelope(taskId, sourceRefs) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT,
    task_id: taskId,
    advisory: true,
    fixture_only: true,
    source_refs: sourceRefs || [],
    diagnostics: [],
    quarantined_sources: [],
    routing_flags: [],
    complete: false,
  };
}

function refused(taskId, code, severity, reason, opts = {}) {
  const e = baseEnvelope(taskId, opts.sourceRefs || []);
  e.status = "REFUSED";
  e.watermark = WATERMARK;
  e.diagnostics = [diag(code, severity, reason)];
  e.quarantined_sources = opts.quarantined || [];
  e.routing_flags = opts.routing || [];
  e.sections = [];
  e.package_complete = false;
  e.exceptions = [];
  e.rollup = { possible: false, reason: code, totals: null, sections_included: [] };
  return e;
}

// ---------------------------------------------------------------------------
// support axis (S): verified > attributed-only > unverifiable
// ---------------------------------------------------------------------------

const SUPPORT_RANK = { verified: 2, "attributed-only": 1, unverifiable: 0 };

function lineSupportRank(s) {
  if (s === "verified") return 2;
  if (s === "attributed") return 1;
  return 0; // null or anything else: diagnostic-only, never upgraded
}

function rankToSupport(rank) {
  if (rank >= 2) return "verified";
  if (rank === 1) return "attributed-only";
  return "unverifiable";
}

// ---------------------------------------------------------------------------
// dedup
// ---------------------------------------------------------------------------

function identityKey(sec, line) {
  return [
    sec.population_id,
    line.line_id,
    sec.period_start,
    sec.period_end,
    sec.currency,
    String(sec.minor_unit_scale),
    line.category,
  ].join("");
}

function unionVerbatim(arrays) {
  const out = [];
  const seen = new Set();
  for (const arr of arrays) {
    for (const v of arr) {
      if (!seen.has(v)) {
        seen.add(v);
        out.push(v);
      }
    }
  }
  return out;
}

/**
 * Dedup lines by identity. Identical copies (rational-equal amounts) merge
 * into one line with the union of verbatim source labels and flags.
 * Conflicting copies produce a contradiction: no single aggregate.
 */
function dedupLines(sec) {
  const groups = new Map();
  for (const line of sec.lines) {
    const k = identityKey(sec, line);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(line);
  }
  const merged = [];
  const contradictions = [];
  for (const [key, copies] of groups) {
    const first = copies[0];
    const b0 = parseAmount(first.budget_minor);
    const a0 = parseAmount(first.actual_minor);
    const conflicting = copies.filter(
      (c) => !eqR(parseAmount(c.budget_minor), b0) || !eqR(parseAmount(c.actual_minor), a0)
    );
    if (conflicting.length > 0) {
      contradictions.push({
        key,
        line_id: first.line_id,
        alternatives: copies.map((c) => ({
          budget_minor: c.budget_minor,
          actual_minor: c.actual_minor,
          source_labels: c.source_labels,
        })),
      });
      continue;
    }
    let rank = 2;
    for (const c of copies) rank = Math.min(rank, lineSupportRank(c.support_strength));
    merged.push({
      line_id: first.line_id,
      category: first.category,
      budget_minor: first.budget_minor,
      actual_minor: first.actual_minor,
      source_labels: unionVerbatim(copies.map((c) => c.source_labels)),
      support_strength: rank === 2 ? "verified" : rank === 1 ? "attributed" : null,
      flags: unionVerbatim(copies.map((c) => c.flags)),
      identity_key: key,
    });
  }
  merged.sort((a, b) => (a.line_id < b.line_id ? -1 : a.line_id > b.line_id ? 1 : 0));
  return { merged, contradictions };
}

/**
 * FM-001 — bundle-wide dedup.
 *
 * The authoritative identity is
 * (population_id,line_id,period_start,period_end,currency,minor_unit_scale,category):
 * it does not contain section_id. Identical copies of the same identity
 * arriving in two registered sections are the same financial population and
 * must count once. This pass runs over the whole resolved bundle BEFORE any
 * section/rollup totals.
 *
 * - Identical cross-section copies merge into the first section (bundle
 *   order) with the union of verbatim labels/flags and minimum support
 *   rank; later copies are dropped.
 * - Conflicting cross-section copies become contradictions (returned per
 *   section index); the involved sections report CONTRADICTION with
 *   alternatives and no aggregate.
 *
 * Operates on caller-owned working copies; the shared fixture store is
 * never mutated.
 */
export function bundleDedup(working) {
  const byKey = new Map();
  working.forEach(({ sec }, si) => {
    sec.lines.forEach((line) => {
      const k = identityKey(sec, line);
      if (!byKey.has(k)) byKey.set(k, []);
      byKey.get(k).push({ si, line });
    });
  });
  const perSection = new Map(); // si -> [{key,line_id,alternatives}]
  for (const [key, copies] of byKey) {
    const idxs = [...new Set(copies.map((c) => c.si))];
    if (idxs.length < 2) continue; // within-section dupes stay with dedupLines
    const b0 = parseAmount(copies[0].line.budget_minor);
    const a0 = parseAmount(copies[0].line.actual_minor);
    const conflicting = copies.some(
      (c) => !eqR(parseAmount(c.line.budget_minor), b0) || !eqR(parseAmount(c.line.actual_minor), a0)
    );
    if (conflicting) {
      const entry = {
        key,
        line_id: copies[0].line.line_id,
        alternatives: copies.map((c) => ({
          section_id: working[c.si].sec.section_id,
          budget_minor: c.line.budget_minor,
          actual_minor: c.line.actual_minor,
          source_labels: c.line.source_labels.slice(),
        })),
      };
      for (const si of idxs) {
        if (!perSection.has(si)) perSection.set(si, []);
        perSection.get(si).push(entry);
      }
      continue;
    }
    // identical: merge into the first section in bundle order
    const first = copies[0];
    first.line.source_labels = unionVerbatim(copies.map((c) => c.line.source_labels));
    first.line.flags = unionVerbatim(copies.map((c) => c.line.flags));
    let rank = 2;
    for (const c of copies) rank = Math.min(rank, lineSupportRank(c.line.support_strength));
    first.line.support_strength = rank === 2 ? "verified" : rank === 1 ? "attributed" : null;
    for (let n = 1; n < copies.length; n++) {
      const { si, line } = copies[n];
      const arr = working[si].sec.lines;
      const at = arr.indexOf(line);
      if (at >= 0) arr.splice(at, 1);
    }
  }
  return perSection;
}

// ---------------------------------------------------------------------------
// per-line / totals math
// ---------------------------------------------------------------------------

function favorability(category, varianceSign) {
  if (varianceSign === 0) return "neutral";
  if (category === "revenue") return varianceSign > 0 ? "favorable" : "unfavorable";
  return varianceSign > 0 ? "unfavorable" : "favorable";
}

function buildLineResult(line, scale) {
  const b = parseAmount(line.budget_minor);
  const a = parseAmount(line.actual_minor);
  const v = subR(a, b);
  const vMinor = roundRationalHalfAway(v);
  const fav = favorability(line.category, signR(v));
  return {
    line_id: line.line_id,
    category: line.category,
    budget_minor: roundRationalHalfAway(b).toString(),
    budget_exact: exactString(b),
    actual_minor: roundRationalHalfAway(a).toString(),
    actual_exact: exactString(a),
    variance_minor: vMinor.toString(),
    variance_exact: exactString(v),
    favorability: fav,
    pct_variance: fmtPct(v, b),
    source_labels: line.source_labels.slice(),
    support_strength: rankToSupport(lineSupportRank(line.support_strength)),
    flags: line.flags.slice(),
    _r: { b, a, v },
  };
}

function sumTotals(lineResults) {
  let b = zeroR();
  let a = zeroR();
  for (const lr of lineResults) {
    b = addR(b, lr._r.b);
    a = addR(a, lr._r.a);
  }
  const v = subR(a, b);
  return {
    budget_r: b,
    actual_r: a,
    variance_r: v,
    budget_minor: roundRationalHalfAway(b).toString(),
    actual_minor: roundRationalHalfAway(a).toString(),
    variance_minor: roundRationalHalfAway(v).toString(),
    budget_exact: exactString(b),
    actual_exact: exactString(a),
    variance_exact: exactString(v),
  };
}

// ---------------------------------------------------------------------------
// narrative checks
// ---------------------------------------------------------------------------

function directionOf(sign) {
  return sign > 0 ? "up" : sign < 0 ? "down" : "flat";
}

function evaluateNarrativeClaim(claim, lineMap, scale) {
  const missing = claim.line_ids.filter((id) => !lineMap.has(id));
  if (missing.length > 0) {
    return {
      claim_id: claim.claim_id,
      state: "unverifiable",
      arithmetic_verified: false,
      causal_support: claim.kind === "cause" ? "unsupported" : "not_applicable",
      evidence: [{ reason: "unknown line_ids", line_ids: missing }],
    };
  }
  const lrs = claim.line_ids.map((id) => lineMap.get(id));
  let varianceSum = zeroR();
  for (const lr of lrs) varianceSum = addR(varianceSum, lr._r.v);
  const dir = directionOf(signR(varianceSum));
  const arithOk = dir === claim.direction;

  if (claim.kind === "movement") {
    let rank = 2;
    for (const lr of lrs) rank = Math.min(rank, SUPPORT_RANK[lr.support_strength]);
    return {
      claim_id: claim.claim_id,
      state: arithOk ? "verified" : "mismatch",
      arithmetic_verified: arithOk,
      causal_support: "not_applicable",
      claim_support: rankToSupport(rank),
      evidence: lrs.map((lr) => ({
        line_id: lr.line_id,
        metric: claim.metric,
        variance_minor: lr.variance_minor,
        direction: dir,
      })),
    };
  }

  // kind === "cause": arithmetic can coincide but NEVER supports a causal
  // explanation by itself. Only an explicit verified fixture basis for a
  // bounded causal fact counts.
  const verifiedBases = (claim.basis_refs || []).filter(
    (b) =>
      b.verified === true &&
      typeof b.bounded_fact === "string" &&
      b.bounded_fact.length > 0 &&
      claim.line_ids.some((id) => b.bounded_fact.includes(id))
  );
  const supported = verifiedBases.length > 0;
  let state;
  if (!arithOk) state = "mismatch";
  else if (supported) state = "verified";
  else state = "unverifiable";
  return {
    claim_id: claim.claim_id,
    state,
    arithmetic_verified: arithOk,
    causal_support: supported ? "supported" : "unsupported",
    claim_support: supported ? "verified" : "unverifiable",
    evidence: supported
      ? verifiedBases.map((b) => ({ basis_id: b.basis_id, bounded_fact: b.bounded_fact }))
      : [{ attribution: "unsupported", quoted_text: claim.quoted_text }],
  };
}

// ---------------------------------------------------------------------------
// section assembly
// ---------------------------------------------------------------------------

function processSection(sec, sourceRef, externalContradictions = []) {
  const diagnostics = [];
  const flags = new Set();
  const sid = sec.section_id;

  const { merged, contradictions: internalContradictions } = dedupLines(sec);
  // FM-001: cross-section contradictions found by bundleDedup block here too.
  const contradictions = internalContradictions.concat(externalContradictions);

  const blockedSection = (code, severity, reason, recordId, exceptions) => ({
    section_id: sid,
    complete: false,
    amounts: null,
    variances: null,
    claimed_vs_recomputed: [],
    source_labels: unionVerbatim(merged.map((l) => l.source_labels)),
    support_strength: "unverifiable",
    flags: [...new Set([...flags, ...unionVerbatim(merged.map((l) => l.flags))])].sort(),
    narrative_results: [],
    diagnostics: sortDiagnostics(diagnostics.concat(diag(code, severity, reason, sourceRef, recordId || sid))),
    _exceptions: exceptions || [],
    _lineResults: [],
  });

  if (contradictions.length > 0) {
    const exceptions = contradictions.map((c) => ({
      code: "CONTRADICTION",
      severity: "error",
      section_id: sid,
      reason: `conflicting copies for line ${c.line_id}: no single aggregate`,
      alternatives: c.alternatives,
    }));
    for (const c of contradictions) flags.add("contradicted");
    return blockedSection(
      "CONTRADICTION",
      "error",
      `dedup identity conflict on ${contradictions.map((c) => c.line_id).join(",")}: contradicted aggregate has no single figure`,
      sid,
      exceptions
    );
  }

  const isSummary = (l) => l.flags.includes(SUMMARY_FLAG);
  const detail = merged.filter((l) => !isSummary(l));
  const summaries = merged.filter((l) => isSummary(l));

  // Summary rows overlapping detail populations are never counted twice.
  // Without disjoint-population proof the population is unverifiable.
  if (summaries.length > 0 && detail.length > 0 && sec.disjoint_proof !== true) {
    return blockedSection(
      "UNVERIFIABLE_POPULATION",
      "error",
      "summary rows overlap detail populations without disjoint-population proof",
      sid
    );
  }

  // FM-002: a proof that the summary population is genuinely disjoint is
  // permission to COUNT that population, not to delete it. Proven-disjoint
  // summaries (and summary-only populations, which have nothing to overlap)
  // are included exactly once in the section totals.
  const counted = merged;

  // Missing labels block the section.
  const unlabeled = merged.filter((l) => l.source_labels.length === 0).map((l) => l.line_id);
  if (unlabeled.length > 0) {
    return blockedSection(
      "MISSING_LABELS",
      "error",
      `lines missing source labels: ${unlabeled.join(",")}`,
      sid
    );
  }

  const scale = sec.minor_unit_scale;
  const lineResults = counted.map((l) => buildLineResult(l, scale));
  const lineMap = new Map(lineResults.map((lr) => [lr.line_id, lr]));

  const byCat = (cat) => lineResults.filter((lr) => lr.category === cat);
  const revT = sumTotals(byCat("revenue"));
  const expT = sumTotals(byCat("expense"));
  const hasRev = byCat("revenue").length > 0;
  const hasExp = byCat("expense").length > 0;

  // Mixed-category net income = revenue - expense, reported separately;
  // favorability labels are never summed or attached to it.
  let netIncome = null;
  if (hasRev || hasExp) {
    const bR = hasRev ? revT.budget_r : zeroR();
    const aR = hasRev ? revT.actual_r : zeroR();
    const bE = hasExp ? expT.budget_r : zeroR();
    const aE = hasExp ? expT.actual_r : zeroR();
    const nb = subR(bR, bE);
    const na = subR(aR, aE);
    const nv = subR(na, nb);
    netIncome = {
      budget_minor: roundRationalHalfAway(nb).toString(),
      actual_minor: roundRationalHalfAway(na).toString(),
      variance_minor: roundRationalHalfAway(nv).toString(),
      budget_exact: exactString(nb),
      actual_exact: exactString(na),
      variance_exact: exactString(nv),
    };
  }

  const stripInternal = (lr) => {
    const { _r, ...rest } = lr;
    return rest;
  };

  const amounts = {
    currency: sec.currency,
    minor_unit_scale: scale,
    revenue: hasRev ? { budget_minor: revT.budget_minor, actual_minor: revT.actual_minor } : null,
    expense: hasExp ? { budget_minor: expT.budget_minor, actual_minor: expT.actual_minor } : null,
    net_income: netIncome,
    lines: lineResults.map(stripInternal),
    totals_exact: {
      revenue_budget: hasRev ? revT.budget_exact : null,
      revenue_actual: hasRev ? revT.actual_exact : null,
      expense_budget: hasExp ? expT.budget_exact : null,
      expense_actual: hasExp ? expT.actual_exact : null,
    },
  };

  const variances = {
    lines: lineResults.map((lr) => ({
      line_id: lr.line_id,
      variance_minor: lr.variance_minor,
      variance_exact: lr.variance_exact,
      favorability: lr.favorability,
      pct_variance: lr.pct_variance,
    })),
    totals: {
      revenue_variance_minor: hasRev ? revT.variance_minor : null,
      expense_variance_minor: hasExp ? expT.variance_minor : null,
      net_income_variance_minor: netIncome ? netIncome.variance_minor : null,
    },
  };

  // claimed vs recomputed: input headers remain claims until recomputed.
  const claimedVs = [];
  for (const ct of sec.claimed_totals) {
    const missing = ct.line_ids.filter((id) => !lineMap.has(id));
    if (missing.length > 0) {
      claimedVs.push({
        claim_id: ct.claim_id,
        state: "unverifiable",
        recomputed_budget_minor: null,
        recomputed_actual_minor: null,
        evidence: [{ reason: "unknown line_ids", line_ids: missing }],
      });
      continue;
    }
    let b = zeroR();
    let a = zeroR();
    for (const id of ct.line_ids) {
      const lr = lineMap.get(id);
      b = addR(b, lr._r.b);
      a = addR(a, lr._r.a);
    }
    const rb = roundRationalHalfAway(b).toString();
    const ra = roundRationalHalfAway(a).toString();
    const cb = roundRationalHalfAway(parseAmount(ct.claimed_budget_minor)).toString();
    const ca = roundRationalHalfAway(parseAmount(ct.claimed_actual_minor)).toString();
    const match = rb === cb && ra === ca;
    if (!match) {
      flags.add("mismatch");
      diagnostics.push(
        diag("CLAIM_MISMATCH", "warning", `claimed total ${ct.claim_id} does not match recomputation`, sourceRef, ct.claim_id)
      );
    }
    claimedVs.push({
      claim_id: ct.claim_id,
      state: match ? "match" : "mismatch",
      recomputed_budget_minor: rb,
      recomputed_actual_minor: ra,
    });
  }

  // narrative checks
  const narrativeResults = [];
  let worstRank = 2;
  for (const l of merged) worstRank = Math.min(worstRank, lineSupportRank(l.support_strength));
  for (const claim of sec.narrative_claims) {
    const nr = evaluateNarrativeClaim(claim, lineMap, scale);
    const { claim_support, ...publicNr } = nr;
    narrativeResults.push(publicNr);
    if (nr.state === "mismatch") {
      flags.add("mismatch");
      diagnostics.push(
        diag("NARRATIVE_MISMATCH", "warning", `narrative claim ${claim.claim_id} contradicts recomputed arithmetic`, sourceRef, claim.claim_id)
      );
    }
    if (nr.state === "unverifiable" && nr.causal_support === "unsupported") {
      diagnostics.push(
        diag("UNSUPPORTED_CAUSE", "warning", `narrative claim ${claim.claim_id} attributes cause without verified fixture basis`, sourceRef, claim.claim_id)
      );
    }
    // Narrative state mismatch is a diagnostic, not a confidence rank; cause
    // verdicts are diagnostic too. Section support comes from evidence labels
    // (lines + movement claims), never from a causal upgrade.
    if (claim.kind === "movement" && claim_support) {
      worstRank = Math.min(worstRank, SUPPORT_RANK[claim_support]);
    }
  }

  for (const l of merged) for (const f of l.flags) flags.add(f);

  return {
    section_id: sid,
    complete: true,
    amounts,
    variances,
    claimed_vs_recomputed: claimedVs,
    source_labels: unionVerbatim(merged.map((l) => l.source_labels)),
    support_strength: rankToSupport(worstRank),
    flags: [...flags].sort(),
    narrative_results: narrativeResults,
    diagnostics: sortDiagnostics(diagnostics),
    _exceptions: [],
    _lineResults: lineResults,
  };
}

// ---------------------------------------------------------------------------
// cross-section rollup
// ---------------------------------------------------------------------------

function rangesOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart <= bEnd && bStart <= aEnd;
}

function computeRollup(sectionInputs, sectionResults) {
  const complete = sectionResults.filter((r) => r.complete);
  const included = complete.map((r) => r.section_id);

  // overlapping period populations block the combined aggregate
  const byPop = new Map();
  sectionInputs.forEach((s, i) => {
    if (!byPop.has(s.population_id)) byPop.set(s.population_id, []);
    byPop.get(s.population_id).push(s);
  });
  for (const [, secs] of byPop) {
    for (let i = 0; i < secs.length; i++) {
      for (let j = i + 1; j < secs.length; j++) {
        const A = secs[i];
        const B = secs[j];
        const sameRange = A.period_start === B.period_start && A.period_end === B.period_end;
        if (!sameRange && rangesOverlap(A.period_start, A.period_end, B.period_start, B.period_end)) {
          return {
            possible: false,
            reason: "OVERLAPPING_PERIODS",
            totals: null,
            sections_included: [],
          };
        }
      }
    }
  }

  if (complete.length !== sectionResults.length) {
    return { possible: false, reason: "INCOMPLETE_SECTIONS", totals: null, sections_included: [] };
  }
  if (complete.length === 0) {
    return { possible: false, reason: "INCOMPLETE_SECTIONS", totals: null, sections_included: [] };
  }
  const currencies = new Set(sectionInputs.filter((s, i) => sectionResults[i].complete).map((s) => s.currency));
  if (currencies.size > 1) {
    return { possible: false, reason: "MIXED_CURRENCY", totals: null, sections_included: [] };
  }
  const scales = new Set(
    sectionInputs.filter((s, i) => sectionResults[i].complete).map((s) => String(s.minor_unit_scale))
  );
  if (scales.size > 1) {
    return { possible: false, reason: "MIXED_SCALE", totals: null, sections_included: [] };
  }

  // FM-003: preserve category semantics across sections. Revenue and
  // expense are NEVER added into one unlabeled money total; net income is
  // revenue minus expense, reported separately. Each category total is an
  // exact-rational sum over the complete sections' counted lines.
  const money3 = (b, a) => {
    const v = subR(a, b);
    return {
      budget_minor: roundRationalHalfAway(b).toString(),
      actual_minor: roundRationalHalfAway(a).toString(),
      variance_minor: roundRationalHalfAway(v).toString(),
    };
  };
  let revB = zeroR(), revA = zeroR(), expB = zeroR(), expA = zeroR();
  let hasRev = false, hasExp = false;
  for (const r of complete) {
    for (const lr of r._lineResults) {
      if (lr.category === "revenue") {
        hasRev = true;
        revB = addR(revB, lr._r.b);
        revA = addR(revA, lr._r.a);
      } else if (lr.category === "expense") {
        hasExp = true;
        expB = addR(expB, lr._r.b);
        expA = addR(expA, lr._r.a);
      }
    }
  }
  const revenue = hasRev ? money3(revB, revA) : null;
  const expense = hasExp ? money3(expB, expA) : null;
  let netIncome = null;
  if (hasRev || hasExp) {
    netIncome = money3(
      subR(hasRev ? revB : zeroR(), hasExp ? expB : zeroR()),
      subR(hasRev ? revA : zeroR(), hasExp ? expA : zeroR())
    );
  }
  return {
    possible: true,
    reason: null,
    totals: { revenue, expense, net_income: netIncome },
    sections_included: included,
  };
}

// ---------------------------------------------------------------------------
// run
// ---------------------------------------------------------------------------

export function run(task, context) {
  // 1. task schema
  const tv = validateTask(task);
  if (!tv.ok) {
    return refused(task && typeof task === "object" ? task.task_id : null, "INVALID_INPUT", "error", tv.errors.join("; "));
  }
  const taskId = task.task_id;

  // 2. input budget
  const inputBytes = Buffer.byteLength(JSON.stringify(task), "utf8");
  if (inputBytes > INPUT_BYTE_LIMIT) {
    return refused(taskId, "INPUT_LIMIT", "error", `input ${inputBytes} bytes exceeds ${INPUT_BYTE_LIMIT}`);
  }

  // 3. only the scoped advisory action is allowed
  if (task.requested_action !== "assemble_draft") {
    return refused(taskId, "ACTION_DENIED", "error", `requested_action ${JSON.stringify(task.requested_action)} is not permitted; only "assemble_draft"`, {
      sourceRefs: task.bundle_refs,
    });
  }

  // 4. injected host context
  const ctx = context && typeof context === "object" ? context : {};
  if (!validateClock(ctx.clock)) {
    return refused(taskId, "INVALID_INPUT", "error", "context.clock must be a real YYYY-MM-DD date or finite UTC ISO timestamp with Z");
  }
  const approvedRepos = Array.isArray(ctx.approvedRepos) ? ctx.approvedRepos : ["forge-ai-drop-fixtures"];

  // 5. resolve bundle_refs through the scoped fixture resolver
  const resolved = [];
  for (const ref of task.bundle_refs) {
    const r = resolveRef(ref, ctx.fixtureStore, approvedRepos);
    if (!r.ok) {
      return refused(taskId, r.code, "error", r.reason, { sourceRefs: task.bundle_refs });
    }
    resolved.push(r);
  }

  // 5b. FM-005: the input byte cap covers the task envelope AND the exact
  // registered fixture bytes actually consulted (canonical pinned bytes),
  // charged BEFORE any schema traversal, dedup, arithmetic, injection
  // scanning or rendering. A tiny task referencing a huge fixture is
  // INPUT_LIMIT, not ordinary processing.
  let fixtureBytes = 0;
  for (const r of resolved) {
    fixtureBytes += canonicalBytes(r.fixture.content).length;
  }
  const totalInputBytes = inputBytes + fixtureBytes;
  if (totalInputBytes > INPUT_BYTE_LIMIT) {
    return refused(
      taskId,
      "INPUT_LIMIT",
      "error",
      `input ${totalInputBytes} bytes (task ${inputBytes} + resolved fixtures ${fixtureBytes}) exceeds ${INPUT_BYTE_LIMIT}`
    );
  }

  // 6. gather + validate sections (malformed tables deny the whole task)
  const sections = [];
  for (const r of resolved) {
    const content = r.fixture.content;
    if (!content || !Array.isArray(content.sections)) {
      return refused(taskId, "INVALID_INPUT", "error", `fixture ${r.fixtureId} content.sections must be an array`, {
        sourceRefs: task.bundle_refs,
      });
    }
    const sectionErrors = [];
    content.sections.forEach((s, i) => {
      validateSection(s, `sections[${i}]`, sectionErrors);
    });
    if (sectionErrors.length > 0) {
      return refused(taskId, "INVALID_INPUT", "error", sectionErrors.join("; "), {
        sourceRefs: task.bundle_refs,
      });
    }
    content.sections.forEach((s) => {
      sections.push({ sec: s, sourceRef: r.sourceRef });
    });
  }

  const seenSections = new Set();
  for (const { sec } of sections) {
    if (seenSections.has(sec.section_id)) {
      return refused(taskId, "INVALID_INPUT", "error", `duplicate section_id ${JSON.stringify(sec.section_id)}`, {
        sourceRefs: task.bundle_refs,
      });
    }
    seenSections.add(sec.section_id);
  }
  if (sections.length === 0) {
    return refused(taskId, "INVALID_INPUT", "error", "no sections resolved from bundle_refs", {
      sourceRefs: task.bundle_refs,
    });
  }

  // 6b. FM-001: bundle-wide dedup BEFORE any section/rollup totals, budgets,
  // or scans. Work on copies so the shared fixture store is never mutated.
  const working = sections.map(({ sec, sourceRef }) => ({
    sec: {
      ...sec,
      lines: sec.lines.map((l) => ({
        ...l,
        source_labels: [...l.source_labels],
        flags: [...l.flags],
      })),
    },
    sourceRef,
  }));
  const bundleContradictions = bundleDedup(working);

  // 7. operation budgets
  let resolutions = task.bundle_refs.length;
  let spans = 0;
  for (const { sec } of working) {
    resolutions += sec.lines.length + sec.narrative_claims.length + sec.claimed_totals.length;
    for (const l of sec.lines) spans += l.source_labels.length;
    spans += sec.narrative_claims.length; // one quoted span per claim
  }
  if (resolutions > MAX_RESOLUTIONS || spans > MAX_SPANS) {
    return refused(taskId, "BUDGET_EXCEEDED", "error", `budget exceeded: ${resolutions} resolutions / ${spans} spans`, {
      sourceRefs: task.bundle_refs,
    });
  }

  // 8. injection scan over every narrative quoted_text BEFORE any assembly.
  //    Quarantine exposes IDs and family only — never the raw payload.
  const quarantined = [];
  for (const { sec } of working) {
    for (const claim of sec.narrative_claims) {
      const hits = scanInjection(claim.quoted_text);
      if (hits.length > 0) {
        quarantined.push({
          section_id: sec.section_id,
          claim_id: claim.claim_id,
          family: hits[0].family,
        });
      }
    }
  }
  if (quarantined.length > 0) {
    return refused(taskId, "INSTRUCTION_INJECTION", "error", `seeded instruction-injection family detected in narrative claims; sources quarantined`, {
      sourceRefs: task.bundle_refs,
      quarantined,
      routing: ["quarantine-review"],
    });
  }

  // 9. assemble sections (bundle dedup already applied in 6b)
  const sectionResults = working.map(({ sec, sourceRef }, i) =>
    processSection(sec, sourceRef, bundleContradictions.get(i) || [])
  );

  // 10. cross-section rollup
  const rollup = computeRollup(
    working.map((s) => s.sec),
    sectionResults
  );

  const completeCount = sectionResults.filter((r) => r.complete).length;
  const status =
    completeCount === sectionResults.length ? "ASSEMBLED" : completeCount > 0 ? "PARTIAL" : "BLOCKED";
  const packageComplete = status === "ASSEMBLED";

  // 11. output budget
  let outputRecords = 1; // rollup record
  for (const r of sectionResults) {
    outputRecords += 1 + r._lineResults.length + r.narrative_results.length + r.claimed_vs_recomputed.length;
  }
  if (outputRecords > MAX_OUTPUT_RECORDS) {
    return refused(taskId, "OUTPUT_LIMIT", "error", `output ${outputRecords} records exceeds ${MAX_OUTPUT_RECORDS}`, {
      sourceRefs: task.bundle_refs,
    });
  }

  const publicSections = sectionResults.map((r) => {
    const { _exceptions, _lineResults, ...pub } = r;
    return pub;
  });
  const exceptions = [];
  for (const r of sectionResults) for (const e of r._exceptions) exceptions.push(e);
  if (!rollup.possible && rollup.reason && rollup.reason !== "INCOMPLETE_SECTIONS") {
    exceptions.push({
      code: rollup.reason,
      severity: "error",
      section_id: null,
      reason: `cross-section aggregate blocked: ${rollup.reason}; no FX or overlap guesses made`,
    });
  }

  const envelope = baseEnvelope(taskId, task.bundle_refs);
  envelope.status = status;
  envelope.watermark = WATERMARK;
  envelope.sections = publicSections;
  envelope.package_complete = packageComplete;
  envelope.complete = packageComplete;
  envelope.exceptions = exceptions;
  envelope.rollup = rollup;
  const allDiags = [];
  for (const r of sectionResults) for (const d of r.diagnostics) allDiags.push(d);
  envelope.diagnostics = sortDiagnostics(allDiags);

  const outBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (outBytes > OUTPUT_BYTE_LIMIT) {
    return refused(taskId, "OUTPUT_LIMIT", "error", `output ${outBytes} bytes exceeds ${OUTPUT_BYTE_LIMIT}`, {
      sourceRefs: task.bundle_refs,
    });
  }
  return envelope;
}

export default { run };
