/**
 * index.js — public entry for the Executive Manager Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Inert DRAFT executive rollup over
 * synthetic status-report fixtures: source-label-faithful per-report
 * projections, cross-report derived statements on two independent axes
 * (support strength, min-wins; flags, set union), exact-identity-value
 * metric dedup with full-quotation contradictions, two-layer metric
 * totals (per-population, then per-declared-disjoint-group), and
 * header-claim comparisons at their own grain. It reports; it never
 * tasks agents, suppresses findings, approves/deploys, or updates any
 * actual tracker. The agent has no file-write API, no network, no model
 * calls: it returns a detached advisory JSON snapshot.
 *
 * Budget discipline (two lessons carried forward from this program):
 *
 * 1. (Financial Manager precedent) Every candidate object with its own
 *    record identity — EACH report, EACH statement, EACH metric line,
 *    EACH header claim — is charged via budget.countObject() as the
 *    FIRST statement of its loop iteration, before any of its own
 *    fields are read. Attempt 65 refuses before that candidate (or any
 *    later one, in any of these arrays) is inspected at all. Byte-span
 *    verification against resolved content (source_label / metric and
 *    header citations) is a SEPARATE charge via countSpan() — these are
 *    simple byte-range checks, not independently-identified records.
 * 2. (Customer Success CS-001 / Document Agent DOC-002 precedent) The
 *    trusted context's OWN registry — principal, criteria, population
 *    groups, read grants, source keys, revisions — is charged under the
 *    exact same monotonic budget via contextGuard.chargeContext(),
 *    BEFORE any task-domain candidate is touched. An unused, oversized
 *    registry entry cannot bypass the budget just because nothing in
 *    this task happens to reference it.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength } from "./canonical.js";
import { validateTask, validateReport, validateReportSetShape, validateStatement, validateMetricLine, validateHeaderClaim, SchemaError } from "./schemas.js";
import { resolveSourceRef, verifySpanBounds, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { chargeContext } from "./contextGuard.js";
import { scanAnyDocText } from "./injection.js";
import { deriveStatement, computeMetricDedupAndContradictions, computePopulationTotals, computeGroupTotals, computeHeaderComparisons } from "./rollup.js";

export const AGENT_ID = "executive-manager-agent";
export const SCHEMA_VERSION = "1";

function emptyReport() {
  return {
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    source_reports: [],
    derived_statements: [],
    dedup_links: [],
    metric_totals: [],
    header_comparisons: [],
    contradictions: [],
    exceptions: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0 },
  };
}

function taskIdOf(task) {
  try {
    return `em-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "em-invalid-task";
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
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read fixture-only status reports and return an advisory rollup); it cannot task agents, suppress findings, approve, deploy, contact anyone, or mutate any record`
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

  // Authenticated request authority: Jason or his registered Muse relay,
  // through the host-injected principal only — task content, arbitrary
  // actor strings, paths or "approved" prose never carry authority.
  if (ctx.principal.revoked) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is revoked; no request authority`);
  }
  const validFrom = Date.parse(ctx.principal.valid_from);
  const expiresAt = Date.parse(ctx.principal.expires_at);
  if (!(validFrom <= ctx.clock && ctx.clock <= expiresAt)) {
    return refused(task, "ACTION_DENIED", "critical", `principal '${ctx.principal.principal_id}' is not valid at the current clock; no request authority`);
  }

  // Resolve the report-set bundle.
  if (!hasReadGrant(validatedTask.report_set_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for report set ${validatedTask.report_set_ref.repo}/${validatedTask.report_set_ref.path}`);
  }
  let bundleResolved;
  try {
    bundleResolved = resolveSourceRef(validatedTask.report_set_ref, ctx.sources, budget, "report set source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `report set: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  let rawSet;
  try {
    const parsed = JSON.parse(bundleResolved.text);
    rawSet = validateReportSetShape(parsed, "report set");
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    return refused(task, "INVALID_INPUT", "error", "report set is not valid JSON");
  }

  // ---- Charged pass over reports[]: one countObject() per report,
  // strictly before any field of that report is read. ----
  const provisional = [];
  const malformed = [];
  const seenReportIds = new Set();
  let budgetExceeded = false;
  for (let i = 0; i < rawSet.reports.length; i++) {
    try {
      budget.countObject(`report[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    const raw = rawSet.reports[i];
    let rep;
    try {
      rep = validateReport(raw, `report set.reports[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) {
        const fallbackId = raw && typeof raw === "object" && typeof raw.report_id === "string" ? raw.report_id : `malformed-index-${i}`;
        malformed.push({ report_id: fallbackId, reason: "MALFORMED_RECORD" });
        continue;
      }
      throw e;
    }
    if (seenReportIds.has(rep.report_id)) {
      return refused(task, "INVALID_INPUT", "error", `duplicate primary report_id '${rep.report_id}'`);
    }
    seenReportIds.add(rep.report_id);
    provisional.push(rep);
  }
  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining reports`);
  }

  // ---- Per-report content resolution, injection scan, and charged
  // passes over each report's statements[]/metrics[]/header_claims[]. ----
  const contentCache = new Map(); // sourceKey@commit -> {bytes, text}
  const quarantined_sources = [];
  const source_reports = [];
  const itemOccurrences = new Map(); // item_id -> [{report_id, support_strength, flags, source_label}]
  const metricsFlat = []; // [{report_id, line_item_id, metric_key, population_id, unit, period, currency, value, citation}]
  const headerClaimsFlat = []; // [{report_id, claim_id, metric_key, population_id, unit, period, currency, claimed_value, citation}]
  const usedContentRefs = [];

  for (let ri = 0; ri < provisional.length; ri++) {
    const rep = provisional[ri];

    const key = `${rep.content_ref.repo}|${rep.content_ref.path}|${rep.content_ref.commit}`;
    let resolved = contentCache.get(key);
    if (!resolved) {
      if (!hasReadGrant(rep.content_ref, ctx.readGrants)) {
        return refused(task, "READ_DENIED", "error", `read grant missing for report ${rep.report_id} content ${rep.content_ref.repo}/${rep.content_ref.path}`);
      }
      try {
        resolved = resolveSourceRef(rep.content_ref, ctx.sources, budget, `content for ${rep.report_id}`);
      } catch (e) {
        if (e instanceof ResolutionError) return refused(task, e.code, "error", `report ${rep.report_id} content: ${e.message}`);
        if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
        throw e;
      }
      contentCache.set(key, resolved);
    }

    const injection = scanAnyDocText([resolved.text, rep.source_principal]);
    const isQuarantined = injection.injected;
    if (isQuarantined) {
      quarantined_sources.push({ report_id: rep.report_id, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
    } else {
      usedContentRefs.push(rep.content_ref);
    }

    // ---- EM-001 fix: buffer this report's nested results LOCALLY. Each
    // nested candidate is charged via budget.countObject() BEFORE
    // validateStatement/validateMetricLine/validateHeaderClaim is called
    // on its raw, not-yet-validated value — never after. A schema failure
    // on any one nested candidate still invalidates the WHOLE report (the
    // same all-or-nothing granularity the prior eager validateReport()
    // had), but it's now determined AFTER each candidate was properly
    // charged first, not before. Nothing is merged into the global
    // itemOccurrences/metricsFlat/headerClaimsFlat/source_reports
    // accumulators until this report's nested pass completes cleanly —
    // budget charges already spent on this report's candidates are NOT
    // rolled back (charging happened; that's the point), only the
    // reported RESULT for this report is discarded. ----
    const statementsOut = [];
    const metricsOut = [];
    const headerClaimsOut = [];
    const localItemOccs = []; // [{item_id, report_id, support_strength, flags, source_label}]
    const localMetricsFlat = [];
    const localHeaderClaimsFlat = [];
    let reportMalformed = false;

    if (!isQuarantined) {
      const seenItemIds = new Set();
      for (let i = 0; i < rep.statements.length; i++) {
        try {
          budget.countObject(`report[${ri}].statements[${i}]`);
        } catch (e) {
          if (e instanceof BudgetError) {
            budgetExceeded = true;
            break;
          }
          throw e;
        }
        let s;
        try {
          s = validateStatement(rep.statements[i], `report[${ri}].statements[${i}]`, seenItemIds);
        } catch (e) {
          if (e instanceof SchemaError) {
            reportMalformed = true;
            break;
          }
          throw e;
        }
        let source_label = null;
        try {
          const span = verifySpanBounds(resolved.bytes, s.span, budget, `report[${ri}].statements[${i}].span`);
          source_label = span.quoted_text;
        } catch (e) {
          if (e instanceof ResolutionError) {
            // out-of-bounds span: source_label stays null, occurrence still
            // counted (support/flags are still structured, host-verified
            // fields independent of the label text itself).
          } else if (e instanceof BudgetError) {
            return refused(task, e.code, "error", e.message);
          } else {
            throw e;
          }
        }
        statementsOut.push({ item_id: s.item_id, support_strength: s.support_strength, flags: s.flags, source_label });
        localItemOccs.push({ item_id: s.item_id, report_id: rep.report_id, support_strength: s.support_strength, flags: s.flags, source_label });
      }
      if (budgetExceeded) {
        return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining statements`);
      }

      const seenLineItemIds = new Set();
      if (!reportMalformed) {
        for (let i = 0; i < rep.metrics.length; i++) {
          try {
            budget.countObject(`report[${ri}].metrics[${i}]`);
          } catch (e) {
            if (e instanceof BudgetError) {
              budgetExceeded = true;
              break;
            }
            throw e;
          }
          let m;
          try {
            m = validateMetricLine(rep.metrics[i], `report[${ri}].metrics[${i}]`, seenLineItemIds);
          } catch (e) {
            if (e instanceof SchemaError) {
              reportMalformed = true;
              break;
            }
            throw e;
          }
          let span;
          try {
            span = verifySpanBounds(resolved.bytes, m.span, budget, `report[${ri}].metrics[${i}].span`);
          } catch (e) {
            if (e instanceof ResolutionError) {
              // out-of-bounds metric citation: excluded from totals/dedup
              // entirely (a metric value with no verifiable citation cannot
              // support any claim).
              continue;
            }
            if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
            throw e;
          }
          const citation = {
            repo: rep.content_ref.repo,
            path: rep.content_ref.path,
            commit: rep.content_ref.commit,
            blob: rep.content_ref.blob,
            algorithm: "git-sha1",
            revision: rep.content_ref.revision,
            quoted_span: span.quoted_text,
            span,
            verification: "VERIFIED",
          };
          metricsOut.push({ line_item_id: m.line_item_id, metric_key: m.metric_key, population_id: m.population_id, unit: m.unit, period: m.period, currency: m.currency, value: m.value, numerator: m.numerator, denominator: m.denominator });
          localMetricsFlat.push({ report_id: rep.report_id, line_item_id: m.line_item_id, metric_key: m.metric_key, population_id: m.population_id, unit: m.unit, period: m.period, currency: m.currency, value: m.value, numerator: m.numerator, denominator: m.denominator, citation });
        }
      }
      if (budgetExceeded) {
        return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining metrics`);
      }

      const seenClaimIds = new Set();
      if (!reportMalformed) {
        for (let i = 0; i < rep.header_claims.length; i++) {
          try {
            budget.countObject(`report[${ri}].header_claims[${i}]`);
          } catch (e) {
            if (e instanceof BudgetError) {
              budgetExceeded = true;
              break;
            }
            throw e;
          }
          let h;
          try {
            h = validateHeaderClaim(rep.header_claims[i], `report[${ri}].header_claims[${i}]`, seenClaimIds);
          } catch (e) {
            if (e instanceof SchemaError) {
              reportMalformed = true;
              break;
            }
            throw e;
          }
          let span;
          try {
            span = verifySpanBounds(resolved.bytes, h.span, budget, `report[${ri}].header_claims[${i}].span`);
          } catch (e) {
            if (e instanceof ResolutionError) continue; // out-of-bounds header citation: excluded
            if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
            throw e;
          }
          const citation = {
            repo: rep.content_ref.repo,
            path: rep.content_ref.path,
            commit: rep.content_ref.commit,
            blob: rep.content_ref.blob,
            algorithm: "git-sha1",
            revision: rep.content_ref.revision,
            quoted_span: span.quoted_text,
            span,
            verification: "VERIFIED",
          };
          headerClaimsOut.push({ claim_id: h.claim_id, metric_key: h.metric_key, population_id: h.population_id, unit: h.unit, period: h.period, currency: h.currency, claimed_value: h.claimed_value });
          localHeaderClaimsFlat.push({ report_id: rep.report_id, claim_id: h.claim_id, metric_key: h.metric_key, population_id: h.population_id, unit: h.unit, period: h.period, currency: h.currency, claimed_value: h.claimed_value, citation });
        }
      }
      if (budgetExceeded) {
        return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining header claims`);
      }
    }

    if (reportMalformed) {
      malformed.push({ report_id: rep.report_id, reason: "MALFORMED_RECORD" });
      continue; // discard this report's buffered results; budget charges already spent stand.
    }

    for (const occ of localItemOccs) {
      const occList = itemOccurrences.get(occ.item_id) ?? itemOccurrences.set(occ.item_id, []).get(occ.item_id);
      occList.push({ report_id: occ.report_id, support_strength: occ.support_strength, flags: occ.flags, source_label: occ.source_label });
    }
    metricsFlat.push(...localMetricsFlat);
    headerClaimsFlat.push(...localHeaderClaimsFlat);

    source_reports.push({
      report_id: rep.report_id,
      source_principal: rep.source_principal,
      workstream: rep.workstream,
      scope: rep.scope,
      period: rep.period,
      quarantined: isQuarantined,
      statements: statementsOut,
      metrics: metricsOut,
      header_claims: headerClaimsOut,
    });
  }

  // ---- Cross-report rollup (pure computation, no further budget
  // charges — everything consulted here was already charged above). ----
  const derived_statements = [...itemOccurrences.entries()]
    .map(([item_id, occs]) => deriveStatement(item_id, occs))
    .sort((a, b) => (a.item_id < b.item_id ? -1 : a.item_id > b.item_id ? 1 : 0));

  const { dedupLinks, contradictions, resolvedByFullKey } = computeMetricDedupAndContradictions(metricsFlat);
  const populationTotals = computePopulationTotals(metricsFlat, resolvedByFullKey);
  const groupTotals = computeGroupTotals(populationTotals, ctx.criteria.population_groups);
  const headerComparisons = computeHeaderComparisons(headerClaimsFlat, populationTotals, groupTotals);

  const metric_totals = [
    ...[...populationTotals.values()].map((t) => ({ scope: "population", ...t })),
    ...[...groupTotals.values()].map((t) => ({ scope: "group", ...t })),
  ].sort((a, b) => {
    const ka = `${a.metric_key}|${a.scope}|${a.population_id ?? a.group_id}|${a.unit}|${a.period}|${a.currency ?? ""}`;
    const kb = `${b.metric_key}|${b.scope}|${b.population_id ?? b.group_id}|${b.unit}|${b.period}|${b.currency ?? ""}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });

  // EM-001 fix: a report can now become malformed during the LATER
  // charged nested-candidate pass (not only in the earlier container-
  // level validateReport() call), so true admission is source_reports
  // (reports that made it all the way through), not provisional.length.
  const exceptions = [...malformed];
  const admittedCount = source_reports.length;
  const excludedCount = exceptions.length;
  const totalPopulation = rawSet.reports.length;
  const hasMalformed = malformed.length > 0;

  const populationMatches = validatedTask.population.declared_total === totalPopulation;
  const populationVerified = validatedTask.population.complete === true && populationMatches && !hasMalformed;
  const population = {
    declared_total: validatedTask.population.declared_total,
    complete: validatedTask.population.complete,
    actual_total: totalPopulation,
    evidence_state: !validatedTask.population.complete ? "unverifiable" : hasMalformed ? "mismatch" : populationMatches ? "verified" : "mismatch",
  };

  const invalidStatementsPresent = derived_statements.some((d) => d.invalid);
  const contradictionsPresent = contradictions.length > 0;
  const unresolvedHeaderPresent = headerComparisons.some((h) => h.evidence_state === "unverifiable");
  const fullyComplete = populationVerified && !invalidStatementsPresent && !contradictionsPresent && !unresolvedHeaderPresent;

  let coverageState;
  if (admittedCount === 0) coverageState = populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  else coverageState = fullyComplete ? "COMPLETE" : "PARTIAL";
  const status = admittedCount === 0 ? "EMPTY" : fullyComplete ? "REPORT_READY" : "PARTIAL";

  const report = {
    population,
    source_reports,
    derived_statements,
    dedup_links: dedupLinks,
    metric_totals,
    header_comparisons: headerComparisons,
    contradictions,
    exceptions,
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount },
  };

  const source_refs = [];
  const seenRefs = new Set();
  for (const r of [validatedTask.report_set_ref, ...usedContentRefs]) {
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
    r.source_reports.length +
    r.derived_statements.length +
    r.dedup_links.length +
    r.metric_totals.length +
    r.header_comparisons.length +
    r.contradictions.length +
    r.exceptions.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.routing_flags.length +
    result.source_refs.length
  );
}

export { validateTask, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
