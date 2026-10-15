/**
 * rollup.js — pure domain computations for the Executive Manager Agent
 * prototype: derived two-axis statements, metric dedup/contradiction
 * detection, two-layer metric totals (per-population, then per-declared-
 * disjoint-group), and header-claim comparisons at their own grain.
 * Pure Node 24 ESM, zero dependencies, no I/O.
 *
 * Design decisions documented here because the brief states these rules
 * at a level of abstraction that admits more than one literal reading;
 * each is applied consistently and is covered by its own battery cases
 * (see the build report for the full rationale):
 *
 * 1. Support axis null handling: a statement with support_strength=null
 *    ("flag-only source") is folded into the UNVERIFIABLE tier for
 *    min-wins purposes ("Flag-only source => support unverifiable"), but
 *    its RAW value stays null in the preserved per-occurrence projection
 *    (source_reports) — only the derived, cross-occurrence figure is
 *    ever "unverifiable" as a resolved label.
 * 2. "Two contradictory strengths on one item": differing KNOWN support
 *    levels across occurrences of the same item_id is the ordinary,
 *    expected case min-wins exists to resolve — it is never, by itself,
 *    a contradiction. This rule fires only when at least one of the
 *    differing occurrences ALSO carries the explicit `contradicted`
 *    flag — i.e. a source is explicitly flagging disagreement, not
 *    merely reporting with lower confidence. An unrecognized
 *    support_strength string (not one of the three enum values, and not
 *    null) is always invalid on its own, regardless of flags.
 * 3. Metric identity for dedup is the FULL tuple including line_item_id
 *    (metric_key, population_id, unit, period, currency, line_item_id):
 *    the same line_item_id reported by multiple sources with the SAME
 *    value is one fact reported twice (dedup to one); the SAME
 *    line_item_id reported with DIFFERENT values is a contradiction
 *    (both shown, no winner). A DIFFERENT line_item_id under the same
 *    (metric_key, population_id, unit, period, currency) is a distinct
 *    data point that contributes to that population's own total — this
 *    is normal multi-line aggregation within one population, not a
 *    dedup candidate, and is never itself an overlap question.
 * 4. Cross-population sums (the "different populations... disjoint"
 *    rule) are resolved via host-registered named population_groups
 *    (context.criteria.population_groups): a header_claim's
 *    population_id may name either a real population_id (its own,
 *    trivially well-defined total) or a registered group_id (a sum of
 *    member populations' own totals, licensed ONLY when every member's
 *    own total is itself resolved AND the group is registered
 *    disjoint:true). Any other reference is UNVERIFIABLE.
 */

export const SUPPORT_RANK = { unverifiable: 0, attributed_only: 1, verified: 2 };
export const SUPPORT_NAME_BY_RANK = ["unverifiable", "attributed_only", "verified"];
export const SUPPORT_VALUES_SET = new Set(["verified", "attributed_only", "unverifiable"]);

function metricGroupKey(m) {
  return `${m.metric_key}|${m.population_id}|${m.unit}|${m.period}|${m.currency ?? ""}`;
}
function fullIdentityKey(m) {
  return `${metricGroupKey(m)}|${m.line_item_id}`;
}

/**
 * Derive one two-axis statement from all non-quarantined occurrences of
 * one item_id. occurrences: [{report_id, support_strength, flags,
 * source_label}]. Returns the derived_statements entry.
 */
export function deriveStatement(item_id, occurrences) {
  const sorted = [...occurrences].sort((a, b) => (a.report_id < b.report_id ? -1 : a.report_id > b.report_id ? 1 : 0));
  const flagSet = new Set();
  let anyContradictedFlag = false;
  let unknownLabelPresent = false;
  const knownRanks = [];
  for (const occ of sorted) {
    for (const f of occ.flags) {
      flagSet.add(f);
      if (f === "contradicted") anyContradictedFlag = true;
    }
    if (occ.support_strength === null) {
      knownRanks.push(SUPPORT_RANK.unverifiable);
    } else if (SUPPORT_VALUES_SET.has(occ.support_strength)) {
      knownRanks.push(SUPPORT_RANK[occ.support_strength]);
    } else {
      unknownLabelPresent = true;
    }
  }
  const distinctKnownRanks = new Set(knownRanks);
  const contradictoryStrengths = anyContradictedFlag && distinctKnownRanks.size > 1;
  const invalid = unknownLabelPresent || contradictoryStrengths;
  const invalid_reason = !invalid ? null : unknownLabelPresent ? "UNKNOWN_SUPPORT_LABEL" : "CONTRADICTORY_STRENGTHS";
  const support_strength = invalid ? null : SUPPORT_NAME_BY_RANK[Math.min(...knownRanks)];
  return {
    item_id,
    support_strength,
    flags: [...flagSet].sort(),
    invalid,
    invalid_reason,
    evidence_state: invalid ? "mismatch" : "verified",
    occurrences: sorted.map((o) => ({ report_id: o.report_id, support_strength: o.support_strength, flags: [...o.flags].sort(), source_label: o.source_label })),
  };
}

/**
 * dedup_links + contradictions over full-identity metric occurrences.
 * metrics: [{report_id, line_item_id, metric_key, population_id, unit,
 * period, currency, value, citation}] (non-quarantined only).
 * Returns { dedupLinks, contradictions, resolvedByFullKey } where
 * resolvedByFullKey maps fullIdentityKey -> {value, line} | undefined
 * (undefined/absent means contradicted — excluded from totals).
 */
export function computeMetricDedupAndContradictions(metrics) {
  const byFullKey = new Map();
  for (const m of metrics) {
    const k = fullIdentityKey(m);
    (byFullKey.get(k) ?? byFullKey.set(k, []).get(k)).push(m);
  }
  const dedupLinks = [];
  const contradictions = [];
  const resolvedByFullKey = new Map();
  for (const [k, occs] of byFullKey) {
    const distinctValues = new Set(occs.map((o) => o.value));
    const sortedOccs = [...occs].sort((a, b) => (a.report_id < b.report_id ? -1 : a.report_id > b.report_id ? 1 : 0));
    if (distinctValues.size === 1) {
      dedupLinks.push({
        metric_key: occs[0].metric_key,
        population_id: occs[0].population_id,
        unit: occs[0].unit,
        period: occs[0].period,
        currency: occs[0].currency,
        line_item_id: occs[0].line_item_id,
        value: occs[0].value,
        occurrences: sortedOccs.map((o) => ({ report_id: o.report_id, citation: o.citation })),
      });
      resolvedByFullKey.set(k, { value: occs[0].value, sample: occs[0] });
    } else {
      contradictions.push({
        metric_key: occs[0].metric_key,
        population_id: occs[0].population_id,
        unit: occs[0].unit,
        period: occs[0].period,
        currency: occs[0].currency,
        line_item_id: occs[0].line_item_id,
        evidence_state: "mismatch",
        occurrences: sortedOccs.map((o) => ({ report_id: o.report_id, value: o.value, citation: o.citation })),
      });
      // contradicted full-identity is excluded from any total (no winner).
    }
  }
  return { dedupLinks, contradictions, resolvedByFullKey };
}

/**
 * Layer 1: per (metric_key,population_id,unit,period,currency) totals —
 * sum of each DISTINCT line_item's resolved value. A group containing
 * ANY contradicted line_item_id becomes unverifiable as a whole (the
 * true value of that line is unknown, so the group sum cannot be
 * trusted), independent of other, unaffected groups.
 */
export function computePopulationTotals(metrics, resolvedByFullKey) {
  const byGroup = new Map(); // groupKey -> {sample, lineItemIds:Set, hasContradiction:boolean}
  for (const m of metrics) {
    const gk = metricGroupKey(m);
    const fk = fullIdentityKey(m);
    const g = byGroup.get(gk) ?? { sample: m, lineItemIds: new Set(), hasContradiction: false };
    g.lineItemIds.add(fk);
    byGroup.set(gk, g);
  }
  const totals = new Map(); // groupKey -> {metric_key,population_id,unit,period,currency,total,contributing_line_item_ids,evidence_state}
  for (const [gk, g] of byGroup) {
    const contributing = [];
    let sum = 0;
    let hasContradiction = false;
    for (const fk of g.lineItemIds) {
      const resolved = resolvedByFullKey.get(fk);
      if (!resolved) {
        hasContradiction = true;
        continue;
      }
      sum += resolved.value;
      contributing.push(resolved.sample.line_item_id);
    }
    contributing.sort();
    totals.set(gk, {
      metric_key: g.sample.metric_key,
      population_id: g.sample.population_id,
      unit: g.sample.unit,
      period: g.sample.period,
      currency: g.sample.currency,
      total_value: hasContradiction ? null : sum,
      contributing_line_item_ids: contributing,
      evidence_state: hasContradiction ? "unverifiable" : "verified",
    });
  }
  return totals;
}

/**
 * Layer 2: per (metric_key,group_id,unit,period,currency) combined
 * totals for registered population_groups. Licensed ONLY when the group
 * is registered disjoint:true AND every member population's own layer-1
 * total (same metric_key/unit/period/currency) is itself verified.
 */
export function computeGroupTotals(populationTotals, populationGroups) {
  const groupTotals = new Map(); // "<metric_key>|<group_id>|<unit>|<period>|<currency>" -> entry
  // Index layer-1 totals by (metric_key,unit,period,currency) -> population_id -> entry
  const byDims = new Map();
  for (const t of populationTotals.values()) {
    const dimKey = `${t.metric_key}|${t.unit}|${t.period}|${t.currency ?? ""}`;
    const m = byDims.get(dimKey) ?? new Map();
    m.set(t.population_id, t);
    byDims.set(dimKey, m);
  }
  for (const [dimKey, byPop] of byDims) {
    const [metric_key, unit, period, currencyRaw] = dimKey.split("|");
    const currency = currencyRaw === "" ? null : currencyRaw;
    for (const group of populationGroups) {
      const members = group.member_population_ids.filter((p) => byPop.has(p));
      if (members.length === 0) continue; // this dimension has none of the group's members; not applicable
      const allMembersPresent = members.length === group.member_population_ids.length;
      const allVerified = members.every((p) => byPop.get(p).evidence_state === "verified");
      const licensed = group.disjoint === true && allMembersPresent && allVerified;
      const sum = licensed ? members.reduce((s, p) => s + byPop.get(p).total_value, 0) : null;
      groupTotals.set(`${metric_key}|${group.group_id}|${unit}|${period}|${currency ?? ""}`, {
        metric_key,
        group_id: group.group_id,
        unit,
        period,
        currency,
        member_population_ids: group.member_population_ids,
        present_member_population_ids: members.sort(),
        disjoint_declared: group.disjoint,
        total_value: sum,
        evidence_state: licensed ? "verified" : "unverifiable",
      });
    }
  }
  return groupTotals;
}

/**
 * header_comparisons: each header claim is evaluated at its own grain —
 * its declared (metric_key, population_id/group_id, unit, period,
 * currency) — against the matching layer-1 population total or layer-2
 * group total. A header value is a claim being checked, never an input
 * to its own verification, and never itself feeds a total.
 */
export function computeHeaderComparisons(headerClaims, populationTotals, groupTotals) {
  const out = [];
  for (const h of headerClaims) {
    const gk = metricGroupKey(h);
    const popTotal = populationTotals.get(gk);
    const groupKey = `${h.metric_key}|${h.population_id}|${h.unit}|${h.period}|${h.currency ?? ""}`;
    const grpTotal = groupTotals.get(groupKey);
    let computed = null;
    let evidence_state = "unverifiable";
    let basis = null;
    if (popTotal && popTotal.evidence_state === "verified") {
      computed = popTotal.total_value;
      evidence_state = "verified";
      basis = "population";
    } else if (grpTotal && grpTotal.evidence_state === "verified") {
      computed = grpTotal.total_value;
      evidence_state = "verified";
      basis = "group";
    } else if (popTotal || grpTotal) {
      // Recognized target, but its own total is unresolved (contradiction
      // in a contributing line, or group not licensed) — unverifiable,
      // not silently passed.
      basis = popTotal ? "population" : "group";
    }
    out.push({
      claim_id: h.claim_id,
      report_id: h.report_id,
      metric_key: h.metric_key,
      population_id: h.population_id,
      unit: h.unit,
      period: h.period,
      currency: h.currency,
      claimed_value: h.claimed_value,
      computed_value: computed,
      basis,
      match: evidence_state === "verified" ? h.claimed_value === computed : null,
      evidence_state,
      citation: h.citation,
    });
  }
  return out;
}
