/**
 * index.js — public entry for the Maintenance Manager Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. A synthetic maintenance-health AUDIT:
 * backlog, aging, PM compliance and integrity findings over a fixture
 * asset/work-order/PM-occurrence register — NOT a CMMS or dispatch
 * planner. It never schedules PM work, dispatches, purchases, closes a
 * work order, or predicts reliability. The agent has no file-write API,
 * no network, no model calls: it returns a detached advisory JSON
 * snapshot.
 *
 * Budget discipline (two lessons carried forward from this program):
 *
 * 1. (Financial Manager / Executive Manager EM-001 precedent) EACH work
 *    order and EACH PM occurrence is charged via budget.countObject() as
 *    the FIRST statement of its loop iteration, before any of its own
 *    fields are read. Attempt 65 refuses before that candidate (or any
 *    later one, in either array) is inspected at all.
 * 2. (Customer Success CS-001 / Document Agent DOC-002 precedent) The
 *    trusted context's OWN registry — principal, criteria, read grants,
 *    source keys, revisions — is charged under the exact same monotonic
 *    budget via contextGuard.chargeContext(), BEFORE any task-domain
 *    candidate is touched.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength, maxContainerDepth, MAX_CONTAINER_DEPTH } from "./canonical.js";
import { validateTask, validateRegisterShape, validateWorkOrder, validatePmOccurrence, SchemaError } from "./schemas.js";
import { resolveSourceRef, verifySpanBounds, hasReadGrant, makeBudget, buildVerifiedCitation, buildUnverifiedCitation, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { chargeContext } from "./contextGuard.js";
import { scanAnyDocText } from "./injection.js";
import { classifyWorkOrder, aggregateWorkOrders, computePmCompliance, computeHeaderComparisons } from "./audit.js";
import { dayIndexOfMs } from "./canonical.js";

export const AGENT_ID = "maintenance-manager-agent";
export const SCHEMA_VERSION = "1";

function emptyReport() {
  return {
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    backlog: { total: 0, by_priority: { P1: 0, P2: 0, P3: 0 }, by_bin: { bin_0_7: 0, bin_8_30: 0, bin_31_90: 0, bin_91_plus: 0 } },
    overdue: { total: 0, unknown_due_count: 0, by_priority: { P1: 0, P2: 0, P3: 0 } },
    cancelled_count: 0,
    pm_compliance: { basis_state: "UNVERIFIABLE", denominator: null, numerator: null, ratio: null, display_percent: null, early_count: 0, late_count: 0, cancelled_link_count: 0, unlinked_count: 0, poisoning_occurrence_ids: [] },
    header_comparisons: [],
    integrity_findings: [],
    excluded_ids: { future_created: [], orphan_asset_work_orders: [], invalid_completion: [], orphan_asset_pm_occurrences: [], unverifiable_citation_work_orders: [], unverifiable_citation_pm_occurrences: [] },
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
  };
}

function taskIdOf(task) {
  try {
    return `mm-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "mm-invalid-task";
  }
}

function envelope(task, { status, complete, source_refs = [], diagnostics = [], quarantined_sources = [], routing_flags = [], report = null }) {
  return {
    schema_version: SCHEMA_VERSION,
    agent: AGENT_ID,
    task_id: taskIdOf(task),
    status,
    advisory: true,
    fixture_only: true,
    authorization_granted: false,
    complete,
    source_refs,
    diagnostics,
    quarantined_sources,
    routing_flags,
    report: report ?? emptyReport(),
  };
}

function refused(task, code, severity, reason, extra = {}) {
  return envelope(task, {
    status: "REFUSED",
    complete: false,
    diagnostics: [{ code, severity, source_ref: null, record_id: null, reason }],
    ...extra,
  });
}

function refKey(r) {
  return `${r.repo}|${r.path}|${r.commit}|${r.blob}`;
}

export function run(task, context) {
  const clockRaw = context && typeof context === "object" ? context.clock : undefined;
  if (!Number.isFinite(clockRaw)) return refused(task, "INVALID_INPUT", "error", "context.clock must be a finite number");

  // MM-S1-001: a pre-inspection depth guard on admitted JSON, before any
  // shape/field validation walks it — bounded schema traversal rejects
  // depth >32 per the brief, applied to the task itself here and to the
  // parsed register below (both are "admitted JSON" structures).
  if (maxContainerDepth(task) > MAX_CONTAINER_DEPTH) {
    return refused(task, "INPUT_LIMIT", "error", `task exceeds the maximum container nesting depth of ${MAX_CONTAINER_DEPTH}`);
  }

  let validatedTask;
  try {
    validatedTask = validateTask(task);
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  const budget = makeBudget();
  try {
    budget.countPayload(canonicalJson(task), "task payload");
  } catch (e) {
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  if (validatedTask.kind === "prohibited") {
    return refused(
      task,
      "ACTION_DENIED",
      "critical",
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read a fixture-only maintenance register and return an advisory audit); it cannot dispatch, schedule PM work, close work orders, purchase parts, predict reliability, or mutate any record`
    );
  }

  // ---- Charged context walk (CS-001 / DOC-002 fix): the registry is
  // charged under the SAME budget as domain candidates, before any of
  // them are touched. ----
  let ctx;
  try {
    ctx = chargeContext(context, budget);
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", `context: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  if (ctx.principal.revoked) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(ctx.principal.valid_from);
  const expiresAt = Date.parse(ctx.principal.expires_at);
  if (!(validFrom <= ctx.clock && ctx.clock <= expiresAt)) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  if (!hasReadGrant(validatedTask.register_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for register ${validatedTask.register_ref.repo}/${validatedTask.register_ref.path}`);
  }
  let registerResolved;
  try {
    registerResolved = resolveSourceRef(validatedTask.register_ref, ctx.sources, budget, "register source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `register: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  let rawRegister;
  let parsed;
  try {
    parsed = JSON.parse(registerResolved.text);
  } catch {
    return refused(task, "INVALID_INPUT", "error", "register is not valid JSON");
  }
  if (maxContainerDepth(parsed) > MAX_CONTAINER_DEPTH) {
    return refused(task, "INPUT_LIMIT", "error", `register exceeds the maximum container nesting depth of ${MAX_CONTAINER_DEPTH}`);
  }
  try {
    rawRegister = validateRegisterShape(parsed, "register");
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    throw e;
  }

  // ---- Charged pass over assets[] (MM-S1-001): one countObject() per
  // asset, strictly before that asset's own value is read (type check +
  // duplicate check both count as "reading" it). Previously this walked
  // up to 128 assets completely outside the budget. ----
  const assetSeen = new Set();
  let budgetExceeded = false;
  for (let i = 0; i < rawRegister.assets.length; i++) {
    try {
      budget.countObject(`assets[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) { budgetExceeded = true; break; }
      throw e;
    }
    const a = rawRegister.assets[i];
    if (typeof a !== "string") return refused(task, "INVALID_INPUT", "error", "every registered asset id must be a string");
    if (assetSeen.has(a)) return refused(task, "INVALID_INPUT", "error", `duplicate registered asset id '${a}'`);
    assetSeen.add(a);
  }
  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining assets`);
  }
  const registeredAssets = assetSeen;

  // ---- Charged pass over work_orders[]: one countObject() per work
  // order, strictly before any field of that work order is read. ----
  const workOrders = [];
  const seenWoIds = new Set();
  for (let i = 0; i < rawRegister.work_orders.length; i++) {
    try {
      budget.countObject(`work_orders[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) { budgetExceeded = true; break; }
      throw e;
    }
    let wo;
    try {
      wo = validateWorkOrder(rawRegister.work_orders[i], `work_orders[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
      throw e;
    }
    if (seenWoIds.has(wo.work_order_id)) return refused(task, "INVALID_INPUT", "error", `duplicate work_order_id '${wo.work_order_id}'`);
    seenWoIds.add(wo.work_order_id);
    workOrders.push(wo);
  }
  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining work orders`);
  }

  // ---- Charged pass over pm_occurrences[]. ----
  const pmOccurrences = [];
  const seenOccIds = new Set();
  for (let i = 0; i < rawRegister.pm_occurrences.length; i++) {
    try {
      budget.countObject(`pm_occurrences[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) { budgetExceeded = true; break; }
      throw e;
    }
    let occ;
    try {
      occ = validatePmOccurrence(rawRegister.pm_occurrences[i], `pm_occurrences[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
      throw e;
    }
    if (seenOccIds.has(occ.occurrence_id)) return refused(task, "INVALID_INPUT", "error", `duplicate occurrence_id '${occ.occurrence_id}'`);
    seenOccIds.add(occ.occurrence_id);
    pmOccurrences.push(occ);
  }
  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining PM occurrences`);
  }

  // ---- Content resolution + injection scan for every distinct
  // content_ref used by an admitted work order / PM occurrence, and
  // citation-span verification for each. Quarantine on one record's
  // notes flags that record only; its structured fields are still used
  // (per the brief: "Quarantined dispatch/close instructions do not
  // alter structured states and never produce control actions"). ----
  const contentCache = new Map();
  const quarantined_sources = [];
  const usedContentRefs = [];
  function resolveContent(ref, what) {
    const key = `${ref.repo}|${ref.path}|${ref.commit}`;
    let resolved = contentCache.get(key);
    if (resolved) return resolved;
    if (!hasReadGrant(ref, ctx.readGrants)) {
      throw new ResolutionError("READ_DENIED", `read grant missing for ${what} content ${ref.repo}/${ref.path}`);
    }
    resolved = resolveSourceRef(ref, ctx.sources, budget, `content for ${what}`);
    contentCache.set(key, resolved);
    return resolved;
  }

  const asOfMs = validatedTask.as_of_ms;
  const asOfDay = dayIndexOfMs(asOfMs);

  const classified = [];
  const workOrderById = new Map();
  const workOrderIntegrityIds = new Set();
  for (const wo of workOrders) {
    let resolved;
    try {
      resolved = resolveContent(wo.content_ref, `work order ${wo.work_order_id}`);
    } catch (e) {
      if (e instanceof ResolutionError) return refused(task, e.code, "error", e.message);
      if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
      throw e;
    }
    const injection = scanAnyDocText([wo.notes]);
    if (injection.injected) {
      quarantined_sources.push({ work_order_id: wo.work_order_id, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
    }
    // MM-S1-002: never fail open. A verified span becomes a VERIFIED
    // citation attached to this record's eventual finding/classification;
    // anything else (SPAN_MISMATCH) becomes an explicit UNVERIFIED
    // citation, which classifyWorkOrder turns into its own integrity
    // finding rather than silently keeping the record "clean".
    let citation;
    try {
      const spanResult = verifySpanBounds(resolved.bytes, wo.span, budget, `work_orders[${wo.work_order_id}].span`);
      citation = buildVerifiedCitation(wo.content_ref, spanResult);
    } catch (e) {
      if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
      citation = buildUnverifiedCitation(wo.content_ref, wo.span);
    }
    if (!injection.injected && citation.verification === "VERIFIED") {
      usedContentRefs.push(wo.content_ref);
    }
    const c = classifyWorkOrder(wo, { asOfMs, asOfDay, registeredAssets, citation });
    classified.push(c);
    workOrderById.set(wo.work_order_id, { ...c, completed_ms: wo.completed_ms });
    if (c.kind === "integrity") workOrderIntegrityIds.add(wo.work_order_id);
  }

  const occCitations = new Map();
  for (const occ of pmOccurrences) {
    let resolved;
    try {
      resolved = resolveContent(occ.content_ref, `PM occurrence ${occ.occurrence_id}`);
    } catch (e) {
      if (e instanceof ResolutionError) return refused(task, e.code, "error", e.message);
      if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
      throw e;
    }
    let citation;
    try {
      const spanResult = verifySpanBounds(resolved.bytes, occ.span, budget, `pm_occurrences[${occ.occurrence_id}].span`);
      citation = buildVerifiedCitation(occ.content_ref, spanResult);
    } catch (e) {
      if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
      citation = buildUnverifiedCitation(occ.content_ref, occ.span);
    }
    occCitations.set(occ.occurrence_id, citation);
    if (citation.verification === "VERIFIED") usedContentRefs.push(occ.content_ref);
  }

  const { backlog, overdue, cancelled_count, integrityFindings } = aggregateWorkOrders(classified);

  const populationMatches = validatedTask.population.declared_total === rawRegister.assets.length;
  const populationComplete = validatedTask.population.complete === true && populationMatches;
  const hasIntegrityFindings = integrityFindings.length > 0;
  const population = {
    declared_total: validatedTask.population.declared_total,
    complete: validatedTask.population.complete,
    actual_total: rawRegister.assets.length,
    evidence_state: !validatedTask.population.complete ? "unverifiable" : hasIntegrityFindings ? "mismatch" : populationMatches ? "verified" : "mismatch",
  };

  const { section: pmSection, additionalFindings } = computePmCompliance(
    pmOccurrences,
    {
      asOfMs,
      windowStartMs: validatedTask.window.start_ms,
      windowEndMs: validatedTask.window.end_ms,
      registeredAssets,
      workOrderById,
      workOrderIntegrityIds,
      citations: occCitations,
    },
    populationComplete
  );
  const allFindings = [...integrityFindings, ...additionalFindings];

  // MM-S1-003: header claims are compared, never allowed to overwrite the
  // computed value; an unmatched or unknown-evidence comparison keeps the
  // whole rollup out of REPORT_READY, same as any other incompleteness.
  const header_comparisons = computeHeaderComparisons(validatedTask.claimed_summary, pmSection);
  const headerAllMatch = header_comparisons.every((h) => h.evidence_state === "MATCH");

  const fullyComplete = population.evidence_state === "verified" && !hasIntegrityFindings && additionalFindings.length === 0 && headerAllMatch;
  let coverageState;
  const admittedCount = workOrders.length + pmOccurrences.length - allFindings.length;
  if (admittedCount === 0 && workOrders.length === 0 && pmOccurrences.length === 0) coverageState = population.evidence_state === "verified" ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  else coverageState = fullyComplete ? "COMPLETE" : "PARTIAL";
  const status = workOrders.length === 0 && pmOccurrences.length === 0 ? "EMPTY" : fullyComplete ? "REPORT_READY" : "PARTIAL";

  const report = {
    population,
    backlog,
    overdue,
    cancelled_count,
    pm_compliance: pmSection,
    header_comparisons,
    integrity_findings: allFindings.sort((a, b) => (a.record_id < b.record_id ? -1 : a.record_id > b.record_id ? 1 : 0)),
    excluded_ids: {
      future_created: allFindings.filter((f) => f.code === "FUTURE_CREATED").map((f) => f.record_id).sort(),
      orphan_asset_work_orders: allFindings.filter((f) => f.code === "ORPHAN_ASSET" && f.record_type === "work_order").map((f) => f.record_id).sort(),
      invalid_completion: allFindings.filter((f) => f.code === "INVALID_COMPLETION").map((f) => f.record_id).sort(),
      orphan_asset_pm_occurrences: allFindings.filter((f) => f.code === "ORPHAN_ASSET" && f.record_type === "pm_occurrence").map((f) => f.record_id).sort(),
      unverifiable_citation_work_orders: allFindings.filter((f) => f.code === "UNVERIFIABLE_CITATION" && f.record_type === "work_order").map((f) => f.record_id).sort(),
      unverifiable_citation_pm_occurrences: allFindings.filter((f) => f.code === "UNVERIFIABLE_CITATION" && f.record_type === "pm_occurrence").map((f) => f.record_id).sort(),
    },
    coverage: { state: coverageState, admitted_count: Math.max(admittedCount, 0), excluded_count: allFindings.length },
  };

  const source_refs = [];
  const seenRefs = new Set();
  for (const r of [validatedTask.register_ref, ...usedContentRefs]) {
    const k = refKey(r);
    if (seenRefs.has(k)) continue;
    seenRefs.add(k);
    source_refs.push({ repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision });
  }

  const result = envelope(task, {
    status,
    complete: true,
    source_refs,
    diagnostics: [],
    quarantined_sources,
    routing_flags: [],
    report,
  });

  if (outputRecordsOf(result) > BUDGET_LIMITS.maxOutputRecords || canonicalByteLength(result) > BUDGET_LIMITS.maxOutputBytes) {
    return refused(task, "OUTPUT_LIMIT", "error", `final output envelope exceeds the ${BUDGET_LIMITS.maxOutputRecords}-record / ${BUDGET_LIMITS.maxOutputBytes}-byte output bounds`);
  }
  return result;
}

function outputRecordsOf(result) {
  const r = result.report;
  return (
    r.integrity_findings.length +
    r.header_comparisons.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.routing_flags.length +
    result.source_refs.length +
    1
  );
}

export { validateTask, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
