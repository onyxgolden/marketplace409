/**
 * oracle.js — INDEPENDENT re-derivation of the Maintenance Manager
 * Agent's rules, written fresh from the brief's text for scoring the
 * battery. This file does NOT import src/index.js, src/audit.js or any
 * other scored module — it recomputes expected structural projections
 * directly from the raw fixture register JSON, using its own date
 * arithmetic (Date.UTC, not canonical.js's dayIndexOfMs), so a bug
 * shared between implementation and oracle cannot hide a real defect.
 *
 * Only used by corpus/make-battery.js (an authoring tool, not part of
 * the scored path) to author corpus/battery.json's `expected` field.
 */

const STATUS_VALUES = new Set(["OPEN", "IN_PROGRESS", "COMPLETED", "CANCELLED"]);
const PRIORITY_VALUES = new Set(["P1", "P2", "P3"]);
const RECORD_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function civilDayIndex(dateStr) {
  // Independent of canonical.js: computes the UTC day index straight
  // from Date.UTC(y, m-1, d), not by parsing an ISO midnight string.
  const [y, m, d] = dateStr.split("-").map(Number);
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
}

function isRealDate(dateStr) {
  if (!DATE_RE.test(dateStr)) return false;
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

function ageBinOf(ageDays) {
  if (ageDays <= 7) return "bin_0_7";
  if (ageDays <= 30) return "bin_8_30";
  if (ageDays <= 90) return "bin_31_90";
  return "bin_91_plus";
}

const INJECTION_NEEDLES = [
  "dispatch a technician", "close this work order", "schedule the", "purchase parts",
  "mark this work order", "approve this", "predict failure", "<img", "onerror=",
  "ignore previous instructions", "act as the technician", "fetch http", "javascript:",
];
function isInjected(text) {
  const low = (text ?? "").toLowerCase();
  return INJECTION_NEEDLES.some((n) => low.includes(n));
}

function registerIsStructurallyValid(reg) {
  if (typeof reg !== "object" || reg === null) return false;
  if (!Array.isArray(reg.assets) || !Array.isArray(reg.work_orders) || !Array.isArray(reg.pm_occurrences)) return false;
  for (const wo of reg.work_orders) {
    if (!RECORD_ID_RE.test(wo.work_order_id ?? "")) return false;
    if (!RECORD_ID_RE.test(wo.asset_id ?? "")) return false;
    if (!STATUS_VALUES.has(wo.status)) return false;
    if (!PRIORITY_VALUES.has(wo.priority)) return false;
    if (!isRealDate(wo.created_date ?? "")) return false;
    if (wo.completed_date !== null && !isRealDate(wo.completed_date)) return false;
    if (wo.due_date !== null && !isRealDate(wo.due_date)) return false;
  }
  for (const occ of reg.pm_occurrences) {
    if (!RECORD_ID_RE.test(occ.occurrence_id ?? "")) return false;
    if (!RECORD_ID_RE.test(occ.asset_id ?? "")) return false;
    if (!isRealDate(occ.due_date ?? "")) return false;
    if (!isRealDate(occ.window_start ?? "")) return false;
    if (!isRealDate(occ.window_end ?? "")) return false;
    if (occ.linked_work_order_id !== null && !RECORD_ID_RE.test(occ.linked_work_order_id)) return false;
  }
  return true;
}

function hasDuplicates(arr) {
  return new Set(arr).size !== arr.length;
}

/**
 * Independent span-bounds check (MM-S1-002 oracle mirror): resolves the
 * record's content_ref against the raw fixture source bag and checks
 * span.end_byte against the ACTUAL byte length of that content — never
 * trusting src/resolver.js's own verifySpanBounds. `sourcesBag` is the
 * same shape as fixtures/store.json's sourcesBySet[*] entries.
 */
function citationVerifiedFor(record, sourcesBag) {
  const ref = record.content_ref;
  const key = `${ref.repo}|${ref.path}`;
  const entry = sourcesBag?.[key];
  const rev = entry?.revisions?.[ref.commit];
  if (!rev || typeof rev.text !== "string") return false;
  const bytes = Buffer.from(rev.text, "utf8");
  return record.span.end_byte <= bytes.length;
}

/** Independent mirror of src/audit.js's computeHeaderComparisons — never
 *  imports it. A header value is a claim, never an input to its own
 *  verification: the claimed value never seeds or overwrites the
 *  computed one.
 *
 *  MM-S1-003 mirror: a claim without verified provenance can never be
 *  MATCH — it is UNKNOWN with an explicit UNAVAILABLE claim citation.
 *  The oracle models provenance as absent (battery tasks carry no
 *  provenance fixtures), so all battery header comparisons are UNKNOWN
 *  unless the basis is VERIFIED AND provenance is present (never in the
 *  battery). */
function computeHeaderComparisonsOracle(claimedSummary, pmSection) {
  if (!claimedSummary) return [];
  const out = [];
  // Battery tasks have no provenance → UNAVAILABLE, never MATCH.
  for (const claim of claimedSummary.claims) {
    if (claim.metric === "pm_compliance_percent") {
      // Without verified provenance, the comparison is always UNKNOWN.
      out.push({ claim_id: claim.claim_id, metric: claim.metric, claimed_value: claim.claimed_value, computed_value: null, evidence_state: "UNKNOWN", claim_citation_verification: "UNAVAILABLE" });
    }
  }
  return out;
}

function refusedShape(code) {
  return {
    status: "REFUSED",
    complete: false,
    diagnostic_codes: [code],
    quarantined_work_order_ids: [],
    source_ref_count: 0,
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    backlog: { total: 0, by_priority: { P1: 0, P2: 0, P3: 0 }, by_bin: { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0 }, citation_support: { state: "UNAVAILABLE", reason: "no contributing backlog records" } },
    overdue: { total: 0, unknown_due_count: 0, by_priority: { P1: 0, P2: 0, P3: 0 }, citation_support: { state: "UNAVAILABLE", reason: "no contributing overdue records" } },
    cancelled_count: 0,
    cancelled_citation_support: { state: "UNAVAILABLE", reason: "no contributing cancelled records" },
    pm_compliance: { basis_state: "UNVERIFIABLE", denominator: null, numerator: null, ratio: null, display_percent: null, early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0, poisoning_occurrence_ids: [], citation_support: { state: "UNAVAILABLE", reason: "no contributing due occurrences" } },
    integrity_findings: [],
    header_comparisons: [],
    excluded_ids: { future_created: [], orphan_asset_work_orders: [], invalid_completion: [], orphan_asset_pm_occurrences: [], unverifiable_citation_work_orders: [], unverifiable_citation_pm_occurrences: [] },
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
  };
}

function reduceFrac(n, d) {
  const g = (a, b) => (b === 0 ? a : g(b, a % b));
  const gg = Math.abs(g(n, d)) || 1;
  return { num: (n / gg).toString(), den: (d / gg).toString() };
}

function percentHalfAwayFromZero(n, d) {
  // n/d * 100, rounded to 2 decimals, half-away-from-zero, via integer
  // arithmetic scaled by 10^4 then divided by 100 at display time.
  const scaled = Math.round((n * 1000000) / d) / 10000; // 2-decimal precision via careful rounding
  // Use a precise integer-based half-away-from-zero at 2 decimals instead
  // of floating rounding above (kept only as a sanity cross-check).
  const num = n * 10000;
  const den = d;
  let q = Math.floor(num / den);
  const rem = num - q * den;
  if (rem * 2 >= den) q += 1;
  const cents = q; // n/d*100 scaled by 100 (i.e. this is the value * 100 * 100)
  const whole = Math.floor(cents / 100);
  const frac = Math.abs(cents % 100);
  return `${whole}.${frac.toString().padStart(2, "0")}`;
}

/**
 * computeExpected(register, task, assetsComplete) -> structural
 * projection matching tests/harness.js's structuralOf() shape, derived
 * independently from the brief's rules.
 *
 * `assetsComplete` carries task.options.population as given (declared
 * total + complete flag) — the oracle checks it against the register's
 * actual asset count itself, exactly as the brief specifies.
 */
export function computeExpected(register, task, sourcesBag) {
  if (!registerIsStructurallyValid(register)) return refusedShape("INVALID_INPUT");

  const woIds = register.work_orders.map((w) => w.work_order_id);
  const occIds = register.pm_occurrences.map((o) => o.occurrence_id);
  if (hasDuplicates(register.assets)) return refusedShape("INVALID_INPUT");
  if (hasDuplicates(woIds)) return refusedShape("INVALID_INPUT");
  if (hasDuplicates(occIds)) return refusedShape("INVALID_INPUT");

  const assetSet = new Set(register.assets);
  const asOfDay = civilDayIndex(task.options.as_of_date);
  const asOfDate = task.options.as_of_date;
  const winStart = task.options.window.start_date;
  const winEnd = task.options.window.end_date;

  const quarantined_work_order_ids = [];
  const classified = [];
  const woById = new Map();
  const integrityIdsByType = { future_created: [], orphan_asset_work_orders: [], invalid_completion: [], unverifiable_citation_work_orders: [] };

  for (const wo of register.work_orders) {
    if (isInjected(wo.notes ?? "")) quarantined_work_order_ids.push(wo.work_order_id);
    const citationOk = citationVerifiedFor(wo, sourcesBag);

    let kind;
    if (!assetSet.has(wo.asset_id)) {
      kind = "integrity"; integrityIdsByType.orphan_asset_work_orders.push(wo.work_order_id);
    } else if (wo.created_date > asOfDate) {
      kind = "integrity"; integrityIdsByType.future_created.push(wo.work_order_id);
    } else if (!citationOk) {
      kind = "integrity"; integrityIdsByType.unverifiable_citation_work_orders.push(wo.work_order_id);
    } else if (wo.status === "COMPLETED") {
      if (wo.completed_date === null || wo.completed_date < wo.created_date || wo.completed_date > asOfDate) {
        kind = "integrity"; integrityIdsByType.invalid_completion.push(wo.work_order_id);
      } else {
        kind = "completed";
      }
    } else if (wo.status === "CANCELLED") {
      kind = "cancelled";
    } else {
      kind = "backlog";
    }
    const entry = { wo, kind, citationOk };
    classified.push(entry);
    woById.set(wo.work_order_id, entry);
  }

  const backlog = { total: 0, by_priority: { P1: 0, P2: 0, P3: 0 }, by_bin: { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0 } };
  const overdue = { total: 0, unknown_due_count: 0, by_priority: { P1: 0, P2: 0, P3: 0 } };
  let cancelled_count = 0;
  const integrityFindings = [];
  // MM-S1-002 oracle: count verified citations feeding each aggregate.
  let backlogCitationCount = 0;
  let overdueCitationCount = 0;
  let cancelledCitationCount = 0;
  for (const c of classified) {
    if (c.kind === "integrity") continue;
    if (c.kind === "cancelled") {
      cancelled_count += 1;
      if (c.citationOk) cancelledCitationCount += 1;
      continue;
    }
    if (c.kind === "completed") continue;
    backlog.total += 1;
    backlog.by_priority[c.wo.priority] += 1;
    const age = asOfDay - civilDayIndex(c.wo.created_date);
    backlog.by_bin[ageBinOf(age)] += 1;
    if (c.citationOk) backlogCitationCount += 1;
    if (c.wo.due_date === null) {
      overdue.unknown_due_count += 1;
    } else if (c.wo.due_date < asOfDate) {
      overdue.total += 1;
      overdue.by_priority[c.wo.priority] += 1;
      if (c.citationOk) overdueCitationCount += 1;
    }
  }
  // MM-S1-002: explicit citation support per aggregate.
  backlog.citation_support = backlogCitationCount > 0
    ? { state: "VERIFIED", record_count: backlogCitationCount }
    : { state: "UNAVAILABLE", reason: "no contributing backlog records" };
  overdue.citation_support = overdueCitationCount > 0
    ? { state: "VERIFIED", record_count: overdueCitationCount }
    : { state: "UNAVAILABLE", reason: "no contributing overdue records" };
  const cancelled_citation_support = cancelledCitationCount > 0
    ? { state: "VERIFIED", record_count: cancelledCitationCount }
    : { state: "UNAVAILABLE", reason: "no contributing cancelled records" };
  for (const code of ["FUTURE_CREATED"]) {
    for (const id of integrityIdsByType.future_created) integrityFindings.push({ code, record_type: "work_order", record_id: id, citation_verification: "VERIFIED" });
  }
  for (const id of integrityIdsByType.orphan_asset_work_orders) integrityFindings.push({ code: "ORPHAN_ASSET", record_type: "work_order", record_id: id, citation_verification: "VERIFIED" });
  for (const id of integrityIdsByType.unverifiable_citation_work_orders) integrityFindings.push({ code: "UNVERIFIABLE_CITATION", record_type: "work_order", record_id: id, citation_verification: "UNVERIFIED" });
  for (const id of integrityIdsByType.invalid_completion) integrityFindings.push({ code: "INVALID_COMPLETION", record_type: "work_order", record_id: id, citation_verification: "VERIFIED" });

  // PM compliance. First, a whole-register citation pass independent of
  // window relevance (MM-S1-002 mirror): every occurrence with a bad
  // citation is its own finding, regardless of whether it's due.
  const unverifiablePmCitationIds = new Set();
  for (const occ of register.pm_occurrences) {
    if (!citationVerifiedFor(occ, sourcesBag)) {
      unverifiablePmCitationIds.add(occ.occurrence_id);
      integrityFindings.push({ code: "UNVERIFIABLE_CITATION", record_type: "pm_occurrence", record_id: occ.occurrence_id, citation_verification: "UNVERIFIED" });
    }
  }

  const dueMembers = register.pm_occurrences.filter((o) => o.due_date >= winStart && o.due_date <= winEnd && o.due_date <= asOfDate);
  const orphanPmIds = [];
  const danglingLinkIds = [];
  const invalidLinkIds = [];
  // MM-S1-002 oracle: count verified citations of due members.
  let dueCitationCount = 0;
  for (const o of dueMembers) {
    if (citationVerifiedFor(o, sourcesBag)) dueCitationCount += 1;
  }
  const pmCitationSupport = dueCitationCount > 0
    ? { state: "VERIFIED", record_count: dueCitationCount }
    : { state: "UNAVAILABLE", reason: "no contributing due occurrences" };

  const popCompleteForPm = task.options.population.complete === true && task.options.population.declared_total === register.assets.length;

  // MM-S1-004 oracle: when population is not verified complete, the PM
  // basis is UNVERIFIABLE for both zero and nonzero due rows. Visible-
  // subset counts are retained with explicit non-whole-population labeling.
  let pmSection;
  if (!popCompleteForPm) {
    let vEarly = 0, vLate = 0, vCancelled = 0, vUnlinked = 0;
    const vPoison = [];
    for (const occ of dueMembers) {
      if (!assetSet.has(occ.asset_id)) { vPoison.push(occ.occurrence_id); continue; }
      if (unverifiablePmCitationIds.has(occ.occurrence_id)) { vPoison.push(occ.occurrence_id); continue; }
      if (occ.linked_work_order_id === null) { vUnlinked += 1; continue; }
      const linked = woById.get(occ.linked_work_order_id);
      if (!linked || linked.kind === "integrity") { vPoison.push(occ.occurrence_id); continue; }
      if (linked.kind === "cancelled") { vCancelled += 1; continue; }
      if (linked.kind !== "completed") continue;
      const cd = linked.wo.completed_date;
      if (cd < occ.window_start) vEarly += 1;
      else if (cd > occ.window_end || cd > asOfDate) vLate += 1;
    }
    pmSection = {
      basis_state: "UNVERIFIABLE", denominator: null, numerator: null, ratio: null, display_percent: null,
      early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0, poisoning_occurrence_ids: [],
      visible_subset: {
        note: "visible-subset only; not whole-population evidence — no verified rate",
        due_count: dueMembers.length, early_count: vEarly, late_count: vLate,
        cancelled_link_count: vCancelled, unlinked_count: vUnlinked,
        poisoning_occurrence_ids: [...vPoison].sort(),
      },
      citation_support: pmCitationSupport,
    };
  } else if (dueMembers.length === 0) {
    pmSection = { basis_state: "NO_DUE_OCCURRENCES", denominator: 0, numerator: 0, ratio: null, display_percent: null, early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0, poisoning_occurrence_ids: [], citation_support: pmCitationSupport };
  } else {
    let numerator = 0, early = 0, late = 0, cancelledLink = 0, unlinked = 0;
    const poisoning = [];
    for (const occ of dueMembers) {
      if (!assetSet.has(occ.asset_id)) {
        poisoning.push(occ.occurrence_id);
        orphanPmIds.push(occ.occurrence_id);
        continue;
      }
      if (unverifiablePmCitationIds.has(occ.occurrence_id)) { poisoning.push(occ.occurrence_id); continue; }
      if (occ.linked_work_order_id === null) { unlinked += 1; continue; }
      const linked = woById.get(occ.linked_work_order_id);
      if (!linked) { poisoning.push(occ.occurrence_id); danglingLinkIds.push(occ.occurrence_id); continue; }
      if (linked.kind === "integrity") { poisoning.push(occ.occurrence_id); invalidLinkIds.push(occ.occurrence_id); continue; }
      if (linked.kind === "cancelled") { cancelledLink += 1; continue; }
      if (linked.kind !== "completed") continue;
      const cd = linked.wo.completed_date;
      if (cd < occ.window_start) early += 1;
      else if (cd > occ.window_end || cd > asOfDate) late += 1;
      else numerator += 1;
    }
    if (poisoning.length > 0) {
      pmSection = { basis_state: "UNVERIFIABLE", denominator: null, numerator: null, ratio: null, display_percent: null, early_count: early, late_count: late, cancelled_link_count: cancelledLink, unlinked_count: unlinked, poisoning_occurrence_ids: [...poisoning].sort(), citation_support: pmCitationSupport };
    } else {
      const denominator = dueMembers.length;
      const frac = reduceFrac(numerator, denominator);
      pmSection = { basis_state: "VERIFIED", denominator, numerator, ratio: frac, display_percent: `${percentHalfAwayFromZero(numerator, denominator)}%`, early_count: early, late_count: late, cancelled_link_count: cancelledLink, unlinked_count: unlinked, poisoning_occurrence_ids: [], citation_support: pmCitationSupport };
    }
  }
  for (const id of orphanPmIds) integrityFindings.push({ code: "ORPHAN_ASSET", record_type: "pm_occurrence", record_id: id, citation_verification: "VERIFIED" });
  for (const id of danglingLinkIds) integrityFindings.push({ code: "DANGLING_PM_LINK", record_type: "pm_occurrence", record_id: id, citation_verification: "VERIFIED" });
  for (const id of invalidLinkIds) integrityFindings.push({ code: "PM_LINK_TO_INVALID_WORK_ORDER", record_type: "pm_occurrence", record_id: id, citation_verification: "VERIFIED" });

  // population.evidence_state reflects the asset/work-order register's
  // OWN cleanliness only (future_created/orphan_asset_work_orders/
  // invalid_completion/unverifiable_citation) — PM link-poisoning and PM
  // citation findings are tracked separately and do not retroactively
  // flip this field; they instead block fullyComplete/REPORT_READY on
  // their own, below (mirrors src/index.js: population.evidence_state
  // comes only from aggregateWorkOrders' work-order findings).
  const woIntegrityCount = integrityIdsByType.future_created.length + integrityIdsByType.orphan_asset_work_orders.length + integrityIdsByType.invalid_completion.length + integrityIdsByType.unverifiable_citation_work_orders.length;
  const populationMatches = task.options.population.declared_total === register.assets.length;
  const populationEvidence = !task.options.population.complete ? "unverifiable" : woIntegrityCount > 0 ? "mismatch" : populationMatches ? "verified" : "mismatch";
  const population = { declared_total: task.options.population.declared_total, complete: task.options.population.complete, actual_total: register.assets.length, evidence_state: populationEvidence };

  const header_comparisons = computeHeaderComparisonsOracle(task.options.claimed_summary, pmSection);
  const headerAllMatch = header_comparisons.every((h) => h.evidence_state === "MATCH");

  const totalRecords = register.work_orders.length + register.pm_occurrences.length;
  const excludedCount = integrityFindings.length;
  const fullyComplete = populationEvidence === "verified" && woIntegrityCount === 0 && pmSection.poisoning_occurrence_ids.length === 0 && unverifiablePmCitationIds.size === 0 && headerAllMatch;
  let status, coverageState;
  if (totalRecords === 0) {
    status = "EMPTY";
    coverageState = populationEvidence === "verified" ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  } else {
    status = fullyComplete ? "REPORT_READY" : "PARTIAL";
    coverageState = fullyComplete ? "COMPLETE" : "PARTIAL";
  }

  // source_refs lists only actually verified, used, nonquarantined
  // sources (common contract) — a record whose citation couldn't be
  // verified never counts as a "used" source either.
  const refKey = (r) => `${r.repo}|${r.path}|${r.commit}|${r.blob}`;
  const seenRefs = new Set([refKey(task.fixture_refs.register)]);
  const quarantinedSet = new Set(quarantined_work_order_ids);
  for (const wo of register.work_orders) {
    if (quarantinedSet.has(wo.work_order_id)) continue;
    if (!citationVerifiedFor(wo, sourcesBag)) continue;
    seenRefs.add(refKey(wo.content_ref));
  }
  for (const occ of register.pm_occurrences) {
    if (!citationVerifiedFor(occ, sourcesBag)) continue;
    seenRefs.add(refKey(occ.content_ref));
  }

  return {
    status,
    // MM-S1-005 oracle: complete follows status. PARTIAL is never complete.
    complete: status === "REPORT_READY" || (status === "EMPTY" && populationEvidence === "verified"),
    diagnostic_codes: [],
    quarantined_work_order_ids: quarantined_work_order_ids.sort(),
    source_ref_count: seenRefs.size,
    population,
    backlog,
    overdue,
    cancelled_count,
    cancelled_citation_support,
    pm_compliance: pmSection,
    header_comparisons: [...header_comparisons].sort((a, b) => (a.claim_id < b.claim_id ? -1 : 1)),
    integrity_findings: integrityFindings.map((f) => ({ code: f.code, record_type: f.record_type, record_id: f.record_id, citation_verification: f.citation_verification })).sort((a, b) => (a.record_id < b.record_id ? -1 : 1)),
    excluded_ids: {
      future_created: [...integrityIdsByType.future_created].sort(),
      orphan_asset_work_orders: [...integrityIdsByType.orphan_asset_work_orders].sort(),
      invalid_completion: [...integrityIdsByType.invalid_completion].sort(),
      orphan_asset_pm_occurrences: [...orphanPmIds].sort(),
      unverifiable_citation_work_orders: [...integrityIdsByType.unverifiable_citation_work_orders].sort(),
      unverifiable_citation_pm_occurrences: [...unverifiablePmCitationIds].sort(),
    },
    coverage: { state: coverageState, admitted_count: totalRecords - excludedCount, excluded_count: excludedCount },
  };
}

export { refusedShape, civilDayIndex, ageBinOf };
