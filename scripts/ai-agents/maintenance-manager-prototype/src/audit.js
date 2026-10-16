/**
 * audit.js — pure computation: backlog, aging, overdue, PM compliance,
 * and integrity findings, over already-charged/validated work orders and
 * PM occurrences. No I/O, no budget charges (everything consulted here
 * was already charged by the caller in src/index.js).
 *
 * Age = as_of_day - created_day (same-day = 0), using UTC civil day
 * indices (canonical.js:dayIndexOfMs) — no local/DST calendar. Bins are
 * INCLUSIVE at both named boundaries: 0-7, 8-30, 31-90, 91+.
 *
 * PM compliance "denominator poisoning" rule (the brief's named
 * acceptance case): a single invalid RELEVANT occurrence — one that is
 * itself in the denominator (due within the report window and
 * due_date<=as_of) but references an orphan asset, or a linked work
 * order that either does not exist in the register at all, or exists
 * but is itself an integrity-error record — poisons the WHOLE PM
 * compliance measure to UNVERIFIABLE. It is never silently dropped and
 * scored as a rate over the remaining, smaller denominator.
 */

import { dayIndexOfMs, rational, rToFixed } from "./canonical.js";

export const AGE_BINS = ["bin_0_7", "bin_8_30", "bin_31_90", "bin_91_plus"];

export function ageBinOf(ageDays) {
  if (ageDays <= 7) return "bin_0_7";
  if (ageDays <= 30) return "bin_8_30";
  if (ageDays <= 90) return "bin_31_90";
  return "bin_91_plus";
}

function emptyPriorityMap() {
  return { P1: 0, P2: 0, P3: 0 };
}
function emptyBinMap() {
  return { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0 };
}

/**
 * Classify one already-schema-valid work order against as_of/the asset
 * register. Returns {kind, ...} where kind is one of:
 *   "backlog"      — OPEN/IN_PROGRESS, created<=as_of, asset registered
 *   "completed"    — COMPLETED, created<=completed<=as_of, valid
 *   "cancelled"    — CANCELLED, valid
 *   "integrity"    — future-created, orphan asset, or invalid completion
 * A work order can match only ONE integrity reason at a time, checked in
 * a fixed order (orphan asset first, then future-created, then invalid
 * completion) so classification is deterministic.
 */
export function classifyWorkOrder(wo, { asOfMs, asOfDay, registeredAssets, citation = { verification: "VERIFIED" } }) {
  if (!registeredAssets.has(wo.asset_id)) {
    return { kind: "integrity", reason: "ORPHAN_ASSET", work_order_id: wo.work_order_id, citation };
  }
  if (wo.created_ms > asOfMs) {
    return { kind: "integrity", reason: "FUTURE_CREATED", work_order_id: wo.work_order_id, citation };
  }
  // MM-S1-002: an unverifiable citation is itself an integrity finding —
  // never silently let an out-of-bounds span support a complete-looking
  // backlog/completed/cancelled classification. Checked after the
  // structural asset/date checks above (which don't depend on the
  // content span at all) and before status-based classification.
  if (citation.verification !== "VERIFIED") {
    return { kind: "integrity", reason: "UNVERIFIABLE_CITATION", work_order_id: wo.work_order_id, citation };
  }
  if (wo.status === "COMPLETED") {
    if (wo.completed_ms === null || wo.completed_ms < wo.created_ms || wo.completed_ms > asOfMs) {
      return { kind: "integrity", reason: "INVALID_COMPLETION", work_order_id: wo.work_order_id, citation };
    }
    return { kind: "completed", work_order_id: wo.work_order_id, citation };
  }
  if (wo.status === "CANCELLED") {
    return { kind: "cancelled", work_order_id: wo.work_order_id, citation };
  }
  // OPEN / IN_PROGRESS
  const ageDays = asOfDay - dayIndexOfMs(wo.created_ms);
  const overdue = wo.due_ms === null ? "unknown" : wo.due_ms < asOfMs ? "overdue" : "not_overdue";
  return { kind: "backlog", work_order_id: wo.work_order_id, ageDays, bin: ageBinOf(ageDays), priority: wo.priority, overdue, citation };
}

/** Aggregate classified work orders into the backlog/overdue/cancelled
 *  report sections, plus the integrity findings list.
 *
 *  MM-S1-002: every aggregate section carries explicit citation support —
 *  the verified citations of the records whose values feed that
 *  aggregate, or an explicit UNAVAILABLE state when there are no
 *  contributing records. Verified citations live on the classified
 *  records (attached by the caller in src/index.js); they are collected
 *  here, not discarded, so the envelope can identify exactly which bytes
 *  support each calculation. */
export function aggregateWorkOrders(classified) {
  const backlog = { total: 0, by_priority: emptyPriorityMap(), by_bin: emptyBinMap() };
  const overdue = { total: 0, unknown_due_count: 0, by_priority: emptyPriorityMap() };
  let cancelled_count = 0;
  let completed_count = 0;
  const integrityFindings = [];

  // MM-S1-002: collect the verified citations feeding each aggregate.
  // Sorted by record_id for deterministic ordering regardless of input order.
  const backlogCitations = [];
  const overdueCitations = [];
  const cancelledCitations = [];

  for (const c of classified) {
    if (c.kind === "integrity") {
      integrityFindings.push({ code: c.reason, record_type: "work_order", record_id: c.work_order_id, citation: c.citation });
      continue;
    }
    if (c.kind === "cancelled") {
      cancelled_count += 1;
      if (c.citation?.verification === "VERIFIED") cancelledCitations.push({ id: c.work_order_id, citation: c.citation });
      continue;
    }
    if (c.kind === "completed") { completed_count += 1; continue; }
    // backlog
    backlog.total += 1;
    backlog.by_priority[c.priority] += 1;
    backlog.by_bin[c.bin] += 1;
    if (c.citation?.verification === "VERIFIED") backlogCitations.push({ id: c.work_order_id, citation: c.citation });
    if (c.overdue === "overdue") {
      overdue.total += 1;
      overdue.by_priority[c.priority] += 1;
      if (c.citation?.verification === "VERIFIED") overdueCitations.push({ id: c.work_order_id, citation: c.citation });
    } else if (c.overdue === "unknown") {
      overdue.unknown_due_count += 1;
    }
  }

  // MM-S1-002: explicit citation support per aggregate. VERIFIED with the
  // contributing citations (sorted by record_id for determinism), or
  // UNAVAILABLE when no records feed the aggregate (nothing to cite).
  const sortById = (arr) => arr.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map((x) => x.citation);
  backlog.citation_support = backlogCitations.length > 0
    ? { state: "VERIFIED", record_count: backlogCitations.length, citations: sortById(backlogCitations) }
    : { state: "UNAVAILABLE", reason: "no contributing backlog records" };
  overdue.citation_support = overdueCitations.length > 0
    ? { state: "VERIFIED", record_count: overdueCitations.length, citations: sortById(overdueCitations) }
    : { state: "UNAVAILABLE", reason: "no contributing overdue records" };
  const cancelled_support = cancelledCitations.length > 0
    ? { state: "VERIFIED", record_count: cancelledCitations.length, citations: sortById(cancelledCitations) }
    : { state: "UNAVAILABLE", reason: "no contributing cancelled records" };

  return { backlog, overdue, cancelled_count, cancelled_citation_support: cancelled_support, completed_count, integrityFindings };
}

/**
 * MM-S1-002: explicit support chain for one PM calculation input: the
 * due occurrence's own citation PLUS the linked work order's
 * status/completion citation (the numerator and early/late/cancelled
 * counts depend on the linked order's completed_ms/status, so the
 * occurrence citation alone does not support the calculation). Each
 * entry carries its record identity and contributing role so the chain
 * is auditable. Missing/unverifiable support is explicit UNAVAILABLE,
 * never silently omitted.
 */
function occurrenceSupportChain(occ, workOrderById, citations) {
  const chain = [];
  const occCitation = citations.get(occ.occurrence_id);
  chain.push({
    record_id: occ.occurrence_id,
    role: "occurrence",
    citation: occCitation?.verification === "VERIFIED"
      ? occCitation
      : { verification: "UNAVAILABLE", reason: "occurrence citation not verified" },
  });
  if (occ.linked_work_order_id !== null) {
    const linked = workOrderById.get(occ.linked_work_order_id);
    const woCitation = linked?.citation;
    chain.push({
      record_id: occ.linked_work_order_id,
      role: "linked_work_order",
      citation: woCitation?.verification === "VERIFIED"
        ? woCitation
        : { verification: "UNAVAILABLE", reason: linked ? "linked work order citation not verified" : "linked work order not in register" },
    });
  }
  return chain;
}

/**
 * PM compliance over already-schema-valid PM occurrences, the full set
 * of classified work orders (by id, for link resolution) and the task's
 * reporting window. Returns the pm_compliance report section plus any
 * additional integrity findings surfaced only through occurrence
 * linkage (dangling / poisoned links not otherwise visible from the
 * work-order pass alone).
 */
export function computePmCompliance(occurrences, { asOfMs, windowStartMs, windowEndMs, registeredAssets, workOrderById, workOrderIntegrityIds, citations = new Map() }, populationComplete) {
  const additionalFindings = [];

  // MM-S1-002: a citation-unavailable occurrence is a whole-register
  // integrity finding regardless of PM-window relevance — never let an
  // out-of-bounds span silently support a clean-looking record. One
  // finding per occurrence here; the due-member loop below poisons the
  // ratio for the subset that's also due, without pushing a duplicate.
  const citationUnavailableIds = new Set();
  for (const occ of occurrences) {
    const citation = citations.get(occ.occurrence_id) ?? { verification: "VERIFIED" };
    if (citation.verification !== "VERIFIED") {
      citationUnavailableIds.add(occ.occurrence_id);
      additionalFindings.push({ code: "UNVERIFIABLE_CITATION", record_type: "pm_occurrence", record_id: occ.occurrence_id, citation });
    }
  }

  const dueMembers = occurrences.filter((o) => o.due_ms >= windowStartMs && o.due_ms <= windowEndMs && o.due_ms <= asOfMs);

  // MM-S1-002: collect verified citations of due members for aggregate support.
  // Sorted by occurrence_id for deterministic ordering regardless of input order.
  const dueMemberCitations = [];
  for (const o of dueMembers) {
    const c = citations.get(o.occurrence_id);
    if (c?.verification === "VERIFIED") dueMemberCitations.push({ id: o.occurrence_id, citation: c });
  }
  dueMemberCitations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // MM-S1-002: explicit per-input support chain — every due occurrence
  // plus its linked work order's status/completion citation, each tagged
  // with its record identity and contributing role. Sorted for
  // determinism. This is the auditable evidence for the numerator and
  // early/late/cancelled-link counts, which depend on the linked order.
  const pmInputs = [];
  for (const o of dueMembers) {
    pmInputs.push(...occurrenceSupportChain(o, workOrderById, citations));
  }
  pmInputs.sort((a, b) => (a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : a.role < b.role ? -1 : 1));
  const pmCitationSupport = dueMemberCitations.length > 0
    ? { state: "VERIFIED", record_count: dueMemberCitations.length, citations: dueMemberCitations.map((x) => x.citation), inputs: pmInputs }
    : { state: "UNAVAILABLE", reason: "no contributing due occurrences" };

  // MM-S1-004: population completeness defines the PM basis. When the
  // population is not verified complete, the basis is UNVERIFIABLE for
  // BOTH zero and nonzero visible due rows — a partial register must not
  // publish a verified denominator/rate merely because its visible rows
  // are internally consistent. Visible-subset counts are retained but
  // explicitly labeled as non-whole-population evidence; no rate is
  // published.
  if (!populationComplete) {
    let visible_early = 0, visible_late = 0, visible_cancelled_link = 0, visible_unlinked = 0;
    const visiblePoisoning = [];
    for (const occ of dueMembers) {
      if (!registeredAssets.has(occ.asset_id)) {
        visiblePoisoning.push(occ.occurrence_id);
        continue;
      }
      if (citationUnavailableIds.has(occ.occurrence_id)) {
        visiblePoisoning.push(occ.occurrence_id);
        continue;
      }
      if (occ.linked_work_order_id === null) {
        visible_unlinked += 1;
        continue;
      }
      const linked = workOrderById.get(occ.linked_work_order_id);
      if (!linked || workOrderIntegrityIds.has(occ.linked_work_order_id)) {
        visiblePoisoning.push(occ.occurrence_id);
        continue;
      }
      if (linked.kind === "cancelled") {
        visible_cancelled_link += 1;
        continue;
      }
      if (linked.kind !== "completed") continue;
      const completedMs = linked.completed_ms;
      if (completedMs < occ.window_start_ms) visible_early += 1;
      else if (completedMs > occ.window_end_ms || completedMs > asOfMs) visible_late += 1;
    }
    return {
      section: {
        basis_state: "UNVERIFIABLE",
        denominator: null,
        numerator: null,
        ratio: null,
        display_percent: null,
        early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0,
        poisoning_occurrence_ids: [],
        // MM-S1-004: visible-subset evidence, explicitly NOT whole-population.
        visible_subset: {
          note: "visible-subset only; not whole-population evidence — no verified rate",
          due_count: dueMembers.length,
          early_count: visible_early,
          late_count: visible_late,
          cancelled_link_count: visible_cancelled_link,
          unlinked_count: visible_unlinked,
          poisoning_occurrence_ids: visiblePoisoning.sort(),
        },
        citation_support: pmCitationSupport,
      },
      additionalFindings,
    };
  }

  if (dueMembers.length === 0) {
    return {
      section: {
        basis_state: "NO_DUE_OCCURRENCES",
        denominator: 0,
        numerator: 0,
        ratio: null,
        display_percent: null,
        early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0,
        poisoning_occurrence_ids: [],
        citation_support: pmCitationSupport,
      },
      additionalFindings,
    };
  }

  let numerator = 0, early = 0, late = 0, cancelledLink = 0, unlinked = 0;
  const poisoningIds = [];

  for (const occ of dueMembers) {
    const occCitation = citations.get(occ.occurrence_id) ?? { verification: "VERIFIED" };
    if (!registeredAssets.has(occ.asset_id)) {
      poisoningIds.push(occ.occurrence_id);
      additionalFindings.push({ code: "ORPHAN_ASSET", record_type: "pm_occurrence", record_id: occ.occurrence_id, citation: occCitation });
      continue;
    }
    if (citationUnavailableIds.has(occ.occurrence_id)) {
      // Already recorded as its own UNVERIFIABLE_CITATION finding above;
      // here it only needs to poison the ratio, not duplicate the finding.
      poisoningIds.push(occ.occurrence_id);
      continue;
    }
    if (occ.linked_work_order_id === null) {
      unlinked += 1;
      continue;
    }
    const linked = workOrderById.get(occ.linked_work_order_id);
    if (!linked) {
      poisoningIds.push(occ.occurrence_id);
      additionalFindings.push({ code: "DANGLING_PM_LINK", record_type: "pm_occurrence", record_id: occ.occurrence_id, citation: occCitation });
      continue;
    }
    if (workOrderIntegrityIds.has(occ.linked_work_order_id)) {
      poisoningIds.push(occ.occurrence_id);
      additionalFindings.push({ code: "PM_LINK_TO_INVALID_WORK_ORDER", record_type: "pm_occurrence", record_id: occ.occurrence_id, citation: occCitation });
      continue;
    }
    if (linked.kind === "cancelled") {
      cancelledLink += 1;
      continue;
    }
    if (linked.kind !== "completed") {
      // linked order exists, is valid, but not (yet) completed — not a
      // compliance count, not a poisoning condition either; tracked with
      // "unlinked" bucket's sibling semantics are not needed per the
      // brief (only early/late/cancelled/unlinked are named), so this
      // falls through to "late" bucket only if we have no better label;
      // the brief does not name this case explicitly, so it is excluded
      // from numerator and not separately counted beyond not being a hit.
      continue;
    }
    // linked.kind === "completed": need the ORIGINAL work order's
    // completed_ms, which classifyWorkOrder's "completed" result does
    // not itself carry — resolved via the raw work order map instead.
    const completedMs = linked.completed_ms;
    if (completedMs < occ.window_start_ms) {
      early += 1;
    } else if (completedMs > occ.window_end_ms || completedMs > asOfMs) {
      late += 1;
    } else {
      numerator += 1;
    }
  }

  if (poisoningIds.length > 0) {
    return {
      section: {
        basis_state: "UNVERIFIABLE",
        denominator: null,
        numerator: null,
        ratio: null,
        display_percent: null,
        early_count: early, late_count: late, cancelled_link_count: cancelledLink, unlinked_count: unlinked,
        poisoning_occurrence_ids: poisoningIds.sort(),
        citation_support: pmCitationSupport,
      },
      additionalFindings,
    };
  }

  const denominator = dueMembers.length;
  const ratio = rational(numerator, denominator);
  return {
    section: {
      basis_state: "VERIFIED",
      denominator,
      numerator,
      ratio: { num: ratio.num.toString(), den: ratio.den.toString() },
      display_percent: `${rToFixed({ num: ratio.num * 100n, den: ratio.den }, 2)}%`,
      early_count: early, late_count: late, cancelled_link_count: cancelledLink, unlinked_count: unlinked,
      poisoning_occurrence_ids: [],
      citation_support: pmCitationSupport,
    },
    additionalFindings,
  };
}

/**
 * computeHeaderComparisons (MM-S1-003): compare each claimed header
 * value against the independently computed metric it names. A header
 * value is a CLAIM, never an input to its own verification (common
 * contract) — the claimed value never overwrites or seeds the computed
 * one. When the computed basis itself isn't VERIFIED (e.g. UNVERIFIABLE,
 * NO_DUE_OCCURRENCES), the comparison is UNKNOWN, never silently a MATCH.
 *
 * MM-S1-003: `claimCitations` is a Map of claim_id -> citation. Every
 * comparison carries its OWN claim citation — the verified provenance
 * declaration bound to that exact claim_id + metric + claimed_value, or
 * an explicit UNAVAILABLE marker when the claim has no (or unverifiable
 * or undeclared) provenance. A claim without its own verified binding
 * can NEVER be MATCH; it is UNKNOWN with explicit unavailable support.
 * The same citation object is never reused across claims.
 */
export function computeHeaderComparisons(claimedSummary, pmSection, claimCitations) {
  if (!claimedSummary) return [];
  const out = [];
  for (const claim of claimedSummary.claims) {
    // MM-S1-003: per-claim citation lookup. Absent or unverifiable
    // binding → explicit UNAVAILABLE.
    const bound = claimCitations instanceof Map ? claimCitations.get(claim.claim_id) : null;
    const effectiveCitation = bound?.verification === "VERIFIED"
      ? bound
      : { verification: "UNAVAILABLE", reason: bound?.reason ?? "claim has no verified provenance binding" };
    const provenanceVerified = effectiveCitation.verification === "VERIFIED";
    if (claim.metric === "pm_compliance_percent") {
      let computed_value = null;
      let evidence_state;
      if (pmSection.basis_state === "VERIFIED" && provenanceVerified) {
        computed_value = pmSection.display_percent.replace("%", "");
        evidence_state = computed_value === claim.claimed_value ? "MATCH" : "MISMATCH";
      } else {
        evidence_state = "UNKNOWN";
      }
      out.push({
        claim_id: claim.claim_id,
        metric: claim.metric,
        claimed_value: claim.claimed_value,
        computed_value,
        evidence_state,
        claim_citation: effectiveCitation,
      });
    }
  }
  return out;
}

export { dayIndexOfMs };
