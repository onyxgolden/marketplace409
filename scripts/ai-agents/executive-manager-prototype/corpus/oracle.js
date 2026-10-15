/**
 * oracle.js — INDEPENDENT re-derivation of the Executive Manager Agent's
 * rules, written fresh from the brief's text for scoring the battery.
 * This file does NOT import src/index.js, src/rollup.js or any other
 * scored module — it recomputes expected structural projections
 * directly from the raw fixture report-set JSON, so a bug shared
 * between implementation and oracle cannot hide a real defect.
 *
 * Only used by corpus/make-battery.js (an authoring tool, not part of
 * the scored path) to author corpus/battery.json's `expected` field.
 */

import { createHash } from "node:crypto";

const SUPPORT_RANK = { unverifiable: 0, attributed_only: 1, verified: 2 };
const SUPPORT_VALUES = new Set(["verified", "attributed_only", "unverifiable"]);

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

const SLUG_RE = /^[a-z][a-z0-9_-]{0,63}$/;
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const PERIOD_RE = /^\d{4}-q[1-4]$/;
const FLAG_VALUES = new Set(["mismatch", "contradicted"]);

function reportIsStructurallyValid(r) {
  if (typeof r !== "object" || r === null) return false;
  if (!RECORD_ID_RE.test(r.report_id ?? "")) return false;
  if (!SLUG_RE.test(r.workstream ?? "")) return false;
  if (!SLUG_RE.test(r.scope ?? "")) return false;
  if (!PERIOD_RE.test(r.period ?? "")) return false;
  if (typeof r.source_principal !== "string" || r.source_principal.length === 0) return false;
  if (!Array.isArray(r.statements) || !Array.isArray(r.metrics) || !Array.isArray(r.header_claims)) return false;
  for (const s of r.statements) {
    if (!RECORD_ID_RE.test(s.item_id ?? "")) return false;
    if (!Array.isArray(s.flags)) return false;
    for (const f of s.flags) if (!FLAG_VALUES.has(f)) return false;
  }
  for (const m of r.metrics) {
    if (!RECORD_ID_RE.test(m.line_item_id ?? "")) return false;
    if (!SLUG_RE.test(m.metric_key ?? "") || !SLUG_RE.test(m.population_id ?? "") || !SLUG_RE.test(m.unit ?? "")) return false;
  }
  for (const h of r.header_claims) {
    if (!RECORD_ID_RE.test(h.claim_id ?? "")) return false;
  }
  return true;
}

const INJECTION_NEEDLES = [
  "ignore previous instructions",
  "suppress the",
  "mark this report final and approved",
  "task the engineering team",
  "<img",
  "onerror=",
];
function isInjected(text) {
  const low = text.toLowerCase();
  return INJECTION_NEEDLES.some((n) => low.includes(n));
}

function refusedShape(code) {
  return {
    status: "REFUSED",
    complete: false,
    diagnostic_codes: [code],
    quarantined_report_ids: [],
    source_ref_count: 0,
    source_reports: [],
    derived_statements: [],
    dedup_links: [],
    metric_totals: [],
    header_comparisons: [],
    contradictions: [],
    exceptions: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
  };
}

/**
 * Compute the full expected structural projection (matching
 * tests/harness.js's structuralOf shape) for one case, given the raw
 * report-set JSON (store.reportSetRefs[set] resolved to its text, then
 * JSON.parse'd into {reports:[...]}, each report additionally carrying
 * a resolved `__content` string for injection scanning), the task
 * options, and the criteria (population_groups) in effect. Pass
 * `refusalCode` directly when the case is specifically exercising a
 * whole-task refusal (malformed task, permission/principal/duplicate/
 * budget) — the author already knows which, so there's no need to
 * re-derive it here.
 */
export function computeExpected({ reportSet, declared_total, populationComplete, populationGroups, refusalCode }) {
  if (refusalCode) return refusedShape(refusalCode);

  const reports = reportSet.reports;
  const seenIds = new Set();
  const admitted = [];
  const malformedList = [];
  for (const r of reports) {
    if (!reportIsStructurallyValid(r)) {
      malformedList.push({ report_id: typeof r.report_id === "string" ? r.report_id : "malformed", reason: "MALFORMED_RECORD" });
      continue;
    }
    if (seenIds.has(r.report_id)) return refusedShape("INVALID_INPUT");
    seenIds.add(r.report_id);
    admitted.push(r);
  }

  const itemOccurrences = new Map();
  const metricsFlat = [];
  const headerFlat = [];
  const sourceReports = [];
  const quarantinedIds = [];
  const usedContentRefKeys = new Set();

  for (const r of admitted) {
    const quarantined = isInjected(r.__content ?? "") || isInjected(r.source_principal);
    if (quarantined) quarantinedIds.push(r.report_id);
    else if (r.content_ref) usedContentRefKeys.add(`${r.content_ref.repo}|${r.content_ref.path}|${r.content_ref.commit}|${r.content_ref.blob}`);
    const statementsOut = [];
    if (!quarantined) {
      for (const s of r.statements) {
        statementsOut.push({ item_id: s.item_id, support_strength: s.support_strength, flags: [...s.flags].sort() });
        const list = itemOccurrences.get(s.item_id) ?? itemOccurrences.set(s.item_id, []).get(s.item_id);
        list.push({ report_id: r.report_id, support_strength: s.support_strength, flags: s.flags });
      }
      for (const m of r.metrics) metricsFlat.push({ report_id: r.report_id, ...m });
      for (const h of r.header_claims) headerFlat.push({ report_id: r.report_id, ...h });
    }
    sourceReports.push({
      report_id: r.report_id,
      quarantined,
      statements: statementsOut.sort((a, b) => (a.item_id < b.item_id ? -1 : 1)),
      metric_count: quarantined ? 0 : r.metrics.length,
      header_claim_count: quarantined ? 0 : r.header_claims.length,
    });
  }
  sourceReports.sort((a, b) => (a.report_id < b.report_id ? -1 : a.report_id > b.report_id ? 1 : 0));

  // Derived statements (two-axis)
  const derived = [];
  for (const [item_id, occs] of itemOccurrences) {
    const flagSet = new Set();
    let anyContradictedFlag = false;
    let unknownLabel = false;
    const knownRanks = [];
    for (const o of occs) {
      for (const f of o.flags) {
        flagSet.add(f);
        if (f === "contradicted") anyContradictedFlag = true;
      }
      if (o.support_strength === null) knownRanks.push(0);
      else if (SUPPORT_VALUES.has(o.support_strength)) knownRanks.push(SUPPORT_RANK[o.support_strength]);
      else unknownLabel = true;
    }
    const distinct = new Set(knownRanks);
    const contradictory = anyContradictedFlag && distinct.size > 1;
    const invalid = unknownLabel || contradictory;
    const support_strength = invalid ? null : ["unverifiable", "attributed_only", "verified"][Math.min(...knownRanks)];
    derived.push({
      item_id,
      support_strength,
      flags: [...flagSet].sort(),
      invalid,
      invalid_reason: !invalid ? null : unknownLabel ? "UNKNOWN_SUPPORT_LABEL" : "CONTRADICTORY_STRENGTHS",
      occurrence_count: occs.length,
    });
  }
  derived.sort((a, b) => (a.item_id < b.item_id ? -1 : 1));

  // Metric dedup/contradiction + population totals
  const byFullKey = new Map();
  for (const m of metricsFlat) {
    const k = `${m.metric_key}|${m.population_id}|${m.unit}|${m.period}|${m.currency ?? ""}|${m.line_item_id}`;
    (byFullKey.get(k) ?? byFullKey.set(k, []).get(k)).push(m);
  }
  const dedupLinks = [];
  const contradictions = [];
  const resolvedLines = new Map(); // fullKey -> {value, line}
  for (const [k, occs] of byFullKey) {
    const distinctValues = new Set(occs.map((o) => o.value));
    if (distinctValues.size === 1) {
      dedupLinks.push({
        metric_key: occs[0].metric_key,
        population_id: occs[0].population_id,
        unit: occs[0].unit,
        period: occs[0].period,
        currency: occs[0].currency ?? null,
        line_item_id: occs[0].line_item_id,
        value: occs[0].value,
        occurrence_count: occs.length,
      });
      resolvedLines.set(k, { value: occs[0].value, sample: occs[0] });
    } else {
      contradictions.push({ line_item_id: occs[0].line_item_id, values: occs.map((o) => o.value).sort((a, b) => a - b) });
    }
  }
  dedupLinks.sort((a, b) => (a.line_item_id < b.line_item_id ? -1 : 1));
  contradictions.sort((a, b) => (a.line_item_id < b.line_item_id ? -1 : 1));

  const byGroupKey = new Map(); // "metric|pop|unit|period|currency" -> {sample, lineKeys:Set}
  for (const m of metricsFlat) {
    const gk = `${m.metric_key}|${m.population_id}|${m.unit}|${m.period}|${m.currency ?? ""}`;
    const fk = `${gk}|${m.line_item_id}`;
    const g = byGroupKey.get(gk) ?? { sample: m, lineKeys: new Set() };
    g.lineKeys.add(fk);
    byGroupKey.set(gk, g);
  }
  const populationTotals = new Map(); // gk -> {value|null, evidence_state, metric_key, unit, period, currency, population_id}
  for (const [gk, g] of byGroupKey) {
    let sum = 0;
    let hasContradiction = false;
    const contributing = [];
    for (const fk of g.lineKeys) {
      const resolved = resolvedLines.get(fk);
      if (!resolved) {
        hasContradiction = true;
        continue;
      }
      sum += resolved.value;
      contributing.push(resolved.sample.line_item_id);
    }
    populationTotals.set(gk, {
      metric_key: g.sample.metric_key,
      population_id: g.sample.population_id,
      unit: g.sample.unit,
      period: g.sample.period,
      currency: g.sample.currency,
      total_value: hasContradiction ? null : sum,
      evidence_state: hasContradiction ? "unverifiable" : "verified",
      contributing: contributing.sort(),
    });
  }

  const groupTotals = new Map(); // "metric|group|unit|period|currency" -> entry
  const byDims = new Map();
  for (const t of populationTotals.values()) {
    const dk = `${t.metric_key}|${t.unit}|${t.period}|${t.currency ?? ""}`;
    const m = byDims.get(dk) ?? new Map();
    m.set(t.population_id, t);
    byDims.set(dk, m);
  }
  for (const [dk, byPop] of byDims) {
    const [metric_key, unit, period, currencyRaw] = dk.split("|");
    for (const group of populationGroups ?? []) {
      const members = group.member_population_ids.filter((p) => byPop.has(p));
      if (members.length === 0) continue;
      const allPresent = members.length === group.member_population_ids.length;
      const allVerified = members.every((p) => byPop.get(p).evidence_state === "verified");
      const licensed = group.disjoint === true && allPresent && allVerified;
      const sum = licensed ? members.reduce((s, p) => s + byPop.get(p).total_value, 0) : null;
      groupTotals.set(`${metric_key}|${group.group_id}|${unit}|${period}|${currencyRaw}`, {
        evidence_state: licensed ? "verified" : "unverifiable",
        total_value: sum,
        contributing: members.sort(),
      });
    }
  }

  const totals = [
    ...[...populationTotals.entries()].map(([gk, t]) => ({ scope: "population", metric_key: t.metric_key, key: t.population_id, unit: t.unit, period: t.period, currency: t.currency, total_value: t.total_value, evidence_state: t.evidence_state, contributing: t.contributing })),
    ...[...groupTotals.entries()].map(([k, t]) => {
      const [metric_key, group_id, unit, period, currencyRaw] = k.split("|");
      return { scope: "group", metric_key, key: group_id, unit, period, currency: currencyRaw === "" ? null : currencyRaw, total_value: t.total_value, evidence_state: t.evidence_state, contributing: t.contributing };
    }),
  ].sort((a, b) => {
    const ka = `${a.scope}|${a.metric_key}|${a.key}`;
    const kb = `${b.scope}|${b.metric_key}|${b.key}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  const headerComparisons = headerFlat
    .map((h) => {
      const gk = `${h.metric_key}|${h.population_id}|${h.unit}|${h.period}|${h.currency ?? ""}`;
      const pop = populationTotals.get(gk);
      const grpKey = `${h.metric_key}|${h.population_id}|${h.unit}|${h.period}|${h.currency ?? ""}`;
      const grp = groupTotals.get(grpKey);
      let computed = null;
      let evidence_state = "unverifiable";
      if (pop && pop.evidence_state === "verified") {
        computed = pop.total_value;
        evidence_state = "verified";
      } else if (grp && grp.evidence_state === "verified") {
        computed = grp.total_value;
        evidence_state = "verified";
      }
      return { claim_id: h.claim_id, claimed_value: h.claimed_value, computed_value: computed, match: evidence_state === "verified" ? h.claimed_value === computed : null, evidence_state };
    })
    .sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1));

  const hasMalformed = malformedList.length > 0;
  const actualTotal = reports.length;
  const populationMatches = declared_total === actualTotal;
  const populationVerified = populationComplete === true && populationMatches && !hasMalformed;
  const invalidPresent = derived.some((d) => d.invalid);
  const contradictionsPresent = contradictions.length > 0;
  const unresolvedHeaderPresent = headerComparisons.some((h) => h.evidence_state === "unverifiable");
  const fullyComplete = populationVerified && !invalidPresent && !contradictionsPresent && !unresolvedHeaderPresent;
  const admittedCount = admitted.length;

  let status;
  if (admittedCount === 0) status = "EMPTY";
  else status = fullyComplete ? "REPORT_READY" : "PARTIAL";

  let coverageState;
  if (admittedCount === 0) coverageState = populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  else coverageState = fullyComplete ? "COMPLETE" : "PARTIAL";

  return {
    status,
    complete: true,
    diagnostic_codes: [],
    quarantined_report_ids: quarantinedIds.sort(),
    source_ref_count: 1 + usedContentRefKeys.size,
    source_reports: sourceReports,
    derived_statements: derived,
    dedup_links: dedupLinks,
    metric_totals: totals,
    header_comparisons: headerComparisons,
    contradictions,
    exceptions: malformedList.sort((a, b) => (a.report_id < b.report_id ? -1 : 1)),
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: malformedList.length },
    population: { declared_total, complete: populationComplete, actual_total: actualTotal, evidence_state: !populationComplete ? "unverifiable" : hasMalformed ? "mismatch" : populationMatches ? "verified" : "mismatch" },
  };
}

export { sha256 };
