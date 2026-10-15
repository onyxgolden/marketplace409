/**
 * index.js — public entry for the Customer Success Agent prototype.
 * Pure Node 24 ESM, zero runtime dependencies, zero model calls.
 *
 * run(task, context) -> result. Deterministic ticket triage (taxonomy
 * classification + priority), two inert fixed-template response drafts
 * per eligible ticket, and independently recomputed support metrics over
 * a fixture-only ticket bundle. The agent has no file-write API, no
 * network, no send/account-mutation capability: it returns a detached
 * advisory JSON snapshot. Policy/taxonomy rules come from the trusted,
 * host-injected context — never from task content.
 *
 * Budget discipline (the bug class that has bitten every other agent in
 * this program): every candidate object — the policy source, the ticket
 * bundle source, and EACH ticket inside it — is charged with
 * budget.countObject() as the FIRST statement before any of its own
 * fields are read. Attempt 65 refuses before that candidate (or any
 * later one) is inspected at all.
 */

import { canonicalJson, sha256HexUtf8, canonicalByteLength, rational, numberToExactRational, rEquals } from "./canonical.js";
import { validateTask, validateContext, validateTicket, validateTicketBundleShape, SchemaError } from "./schemas.js";
import { resolveSourceRef, verifySpan, hasReadGrant, makeBudget, BudgetError, ResolutionError, BUDGET_LIMITS } from "./resolver.js";
import { scanAnyTicketText } from "./injection.js";
import { classifyTicket } from "./taxonomy.js";
import { ticketValidity, timeMetric, slaComplianceMetric, csatMetrics, meanMinutesExact, slaRatioExact, csatExact } from "./metrics.js";
import { buildDrafts } from "./drafts.js";

export const AGENT_ID = "customer-success-agent";
export const SCHEMA_VERSION = "1";

const RULE_QUOTES = {
  PRECEDENCE: "Category precedence order is ACCOUNT_CLOSURE, then BILLING, then TECHNICAL, then FEATURE_REQUEST, then OTHER.",
  PRIORITY: "A TECHNICAL ticket with OUTAGE impact is HIGH priority; ACCOUNT_CLOSURE tickets and BILLING tickets with NEGATIVE sentiment are MEDIUM priority; FEATURE_REQUEST-only tickets are LOW priority; all remaining tickets are NORMAL priority.",
};

const UNDEFINED_METRIC = { numerator: 0, denominator: 0, exact_value: null, display: "UNDEFINED", evidence_state: "unverifiable" };

function emptyReport() {
  return {
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
    ticket_results: [],
    metrics: {
      response_time: { ...UNDEFINED_METRIC, pending_count: 0, excluded_count: 0, total_population: 0 },
      resolution_time: { ...UNDEFINED_METRIC, pending_count: 0, excluded_count: 0, total_population: 0 },
      sla_compliance: { ...UNDEFINED_METRIC, pending_count: 0, excluded_count: 0, total_population: 0 },
      csat_mean: { ...UNDEFINED_METRIC },
      csat_positive_share: { ...UNDEFINED_METRIC },
    },
    header_comparisons: [],
    pending_ids: [],
    excluded_ids: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0, pending_count: 0 },
  };
}

function taskIdOf(task) {
  try {
    return `cs-${sha256HexUtf8(canonicalJson(task)).slice(0, 16)}`;
  } catch {
    return "cs-invalid-task";
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

/** Resolve + verify-once a named rule quote from the policy document.
 *  Cached per call to run() so N tickets citing the same rule only cost
 *  one span check total, never N (no re-resolution per ticket). */
function makeRuleCiter(policyRef, policyBytes, budget) {
  const cache = new Map();
  return function cite(ruleId) {
    if (cache.has(ruleId)) return cache.get(ruleId);
    const quoted = RULE_QUOTES[ruleId];
    const span = verifySpan(policyBytes, quoted, budget, `policy rule ${ruleId}`);
    const citation = {
      repo: policyRef.repo,
      path: policyRef.path,
      commit: policyRef.commit,
      blob: policyRef.blob,
      algorithm: "git-sha1",
      revision: policyRef.revision,
      quoted_span: span.quoted_text,
      span,
      verification: "VERIFIED",
      rule_id: ruleId,
    };
    cache.set(ruleId, citation);
    return citation;
  };
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
      `prohibited operation '${validatedTask.operation}': this agent only supports 'analyze' (read fixture-only tickets and return an advisory report); it cannot send, refund, cancel, contact a customer, or mutate any record`
    );
  }

  let ctx;
  try {
    ctx = validateContext(context);
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", `context: ${e.message}`);
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

  // Resolve the trusted policy/taxonomy document FIRST: nothing can be
  // classified or cited without it, and task content never supplies it.
  if (!hasReadGrant(ctx.criteria.policy_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for policy source ${ctx.criteria.policy_ref.repo}/${ctx.criteria.policy_ref.path}`);
  }
  let policyResolved;
  try {
    policyResolved = resolveSourceRef(ctx.criteria.policy_ref, ctx.sources, budget, "policy source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `policy source: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }
  const policyInjection = scanAnyTicketText([policyResolved.text]);
  if (policyInjection.injected) {
    return refused(task, "INSTRUCTION_INJECTION", "critical", "the trusted policy/taxonomy source contains a seeded directive family; quarantined, no draft or classification is possible without a trustworthy rule source", {
      quarantined_sources: [{ repo: ctx.criteria.policy_ref.repo, path: ctx.criteria.policy_ref.path, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" }],
    });
  }
  const cite = makeRuleCiter(ctx.criteria.policy_ref, policyResolved.bytes, budget);
  let precedenceCitation, priorityCitation;
  try {
    precedenceCitation = cite("PRECEDENCE");
    priorityCitation = cite("PRIORITY");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `policy source: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  // Resolve the ticket bundle.
  if (!hasReadGrant(validatedTask.ticket_bundle_ref, ctx.readGrants)) {
    return refused(task, "READ_DENIED", "error", `read grant missing for ticket bundle ${validatedTask.ticket_bundle_ref.repo}/${validatedTask.ticket_bundle_ref.path}`);
  }
  let bundleResolved;
  try {
    bundleResolved = resolveSourceRef(validatedTask.ticket_bundle_ref, ctx.sources, budget, "ticket bundle source");
  } catch (e) {
    if (e instanceof ResolutionError) return refused(task, e.code, "error", `ticket bundle: ${e.message}`);
    if (e instanceof BudgetError) return refused(task, e.code, "error", e.message);
    throw e;
  }

  let rawTickets;
  try {
    const parsed = JSON.parse(bundleResolved.text);
    rawTickets = validateTicketBundleShape(parsed, "ticket bundle");
  } catch (e) {
    if (e instanceof SchemaError) return refused(task, "INVALID_INPUT", "error", e.message);
    return refused(task, "INVALID_INPUT", "error", "ticket bundle is not valid JSON");
  }

  // ---- Charged pass: one countObject() per ticket, strictly before any
  // field of that ticket is read. Attempt 65 (overall, including the two
  // fixture-source charges above) refuses before that ticket or any
  // later ticket is touched at all. ----
  const provisional = []; // in bundle order; later deduped by ticket_id
  const malformed = [];
  let budgetExceeded = false;
  for (let i = 0; i < rawTickets.length; i++) {
    try {
      budget.countObject(`ticket[${i}]`);
    } catch (e) {
      if (e instanceof BudgetError) {
        budgetExceeded = true;
        break;
      }
      throw e;
    }
    const raw = rawTickets[i];
    let ticket;
    try {
      ticket = validateTicket(raw, `ticket bundle[${i}]`);
    } catch (e) {
      if (e instanceof SchemaError) {
        const fallbackId = raw && typeof raw === "object" && typeof raw.ticket_id === "string" ? raw.ticket_id : `malformed-index-${i}`;
        malformed.push(fallbackId);
        continue;
      }
      throw e;
    }
    provisional.push(ticket);
  }

  if (budgetExceeded) {
    return refused(task, "BUDGET_EXCEEDED", "error", `candidate object count exceeds ${BUDGET_LIMITS.maxObjects}; refusing before inspecting the remaining tickets`);
  }

  // ---- Unrestricted post-processing over already-charged, already-
  // inspected results only: no new candidate is read here. ----
  const byId = new Map();
  for (const t of provisional) {
    if (!byId.has(t.ticket_id)) byId.set(t.ticket_id, []);
    byId.get(t.ticket_id).push(t);
  }
  const excluded_ids = [];
  for (const id of malformed) excluded_ids.push({ ticket_id: id, reason: "MALFORMED_RECORD" });

  const admitted = [];
  for (const [id, group] of byId) {
    if (group.length > 1) {
      // One excluded_ids entry PER RAW OCCURRENCE, not one per colliding
      // ID — every raw ticket must be accounted for exactly once across
      // ticket_results/pending_ids/excluded_ids, and totalPopulation
      // (rawTickets.length) must always equal admitted + excluded.
      for (let n = 0; n < group.length; n++) excluded_ids.push({ ticket_id: id, reason: "DUPLICATE_ID" });
      continue;
    }
    admitted.push(group[0]);
  }

  const pending_ids = [];
  const responseMsAll = [];
  const resolutionMsAll = [];
  const responseMinutesExact = [];
  const ratings = [];
  const ticket_results = [];

  for (const ticket of admitted) {
    const validity = ticketValidity(ticket, ctx.clock);
    if (validity.state === "invalid") {
      excluded_ids.push({ ticket_id: ticket.ticket_id, reason: validity.reason });
      continue;
    }
    if (validity.state === "pending") {
      pending_ids.push(ticket.ticket_id);
    } else {
      responseMsAll.push(validity.responseMs);
      responseMinutesExact.push(rational(validity.responseMs, 60000));
      if (validity.resolutionMs !== null) resolutionMsAll.push(validity.resolutionMs);
    }
    if (ticket.rating !== null) ratings.push(ticket.rating);

    const classification = classifyTicket(ticket);
    const textScan = scanAnyTicketText([ticket.subject, ticket.body, ticket.notes]);
    const noVerifiedTopic = classification.category === "OTHER" && classification.secondary_categories.length === 0;

    let drafts = [];
    let suppression_reason = null;
    const quarantinedHere = [];
    if (textScan.injected) {
      suppression_reason = "QUARANTINED_INPUT";
      quarantinedHere.push({ ticket_id: ticket.ticket_id, reason: "INSTRUCTION_INJECTION_SEEDED_FAMILY" });
    } else if (noVerifiedTopic) {
      suppression_reason = "NO_VERIFIED_TOPIC";
    } else {
      drafts = buildDrafts(ticket.ticket_id, classification);
    }

    ticket_results.push({
      ticket_id: ticket.ticket_id,
      classification,
      taxonomy_version: ctx.criteria.taxonomy_version,
      drafts,
      suppression_reason,
      citations: [precedenceCitation, priorityCitation],
      _quarantined: quarantinedHere,
    });
  }

  const excludedCount = excluded_ids.length;
  const pendingCount = pending_ids.length;
  const admittedCount = ticket_results.length;
  const totalPopulation = rawTickets.length;

  const populationMatches = validatedTask.population.declared_total === totalPopulation;
  const populationVerified = validatedTask.population.complete === true && populationMatches;
  const population = {
    declared_total: validatedTask.population.declared_total,
    complete: validatedTask.population.complete,
    actual_total: totalPopulation,
    evidence_state: !validatedTask.population.complete ? "unverifiable" : populationMatches ? "verified" : "mismatch",
  };

  const responseMetric = timeMetric(responseMsAll, pendingCount, excludedCount, totalPopulation, populationVerified);
  const resolutionMetric = timeMetric(resolutionMsAll, pendingCount, excludedCount, totalPopulation, populationVerified);
  const slaMetric = slaComplianceMetric(responseMinutesExact, ctx.criteria.response_sla_minutes, pendingCount, excludedCount, totalPopulation, populationVerified);
  const csat = csatMetrics(ratings, populationVerified);

  const header_comparisons = [];
  const hc = validatedTask.header_claims;
  function compareHeader(metricName, claimed, computedExact, computedDisplay) {
    if (claimed === null) return;
    let evidence_state;
    if (computedExact === null) {
      evidence_state = "unverifiable";
    } else {
      const claimedExact = numberToExactRational(claimed);
      evidence_state = rEquals(claimedExact, computedExact) ? "verified" : "mismatch";
    }
    header_comparisons.push({ metric: metricName, claimed, computed_display: computedDisplay, evidence_state });
  }
  // Re-derive the exact values (not the JSON-string projections) for the
  // header-vs-computed comparison, from the SAME pure functions the
  // metrics themselves were built from — so equality is decided on
  // identical exact rationals, never on rounded display strings, and
  // never on a second, separately-written (and possibly diverging)
  // calculation of the same thing.
  const responseExactForCompare = meanMinutesExact(responseMsAll);
  const resolutionExactForCompare = meanMinutesExact(resolutionMsAll);
  const slaExactForCompare = slaRatioExact(responseMinutesExact, ctx.criteria.response_sla_minutes).ratio;
  const csatForCompare = csatExact(ratings);
  const csatMeanExactForCompare = csatForCompare.mean;
  const csatPositiveExactForCompare = csatForCompare.positiveShare;

  // sla_compliance_pct / csat_positive_pct are claimed as percentages
  // (e.g. 70 meaning 70%); the underlying exact ratios are 0..1 — scale
  // before comparing, never compare across mismatched units.
  const asPercent = (r) => (r === null ? null : rational(r.num * 100n, r.den));

  compareHeader("avg_response_minutes", hc.avg_response_minutes, responseExactForCompare, responseMetric.display);
  compareHeader("avg_resolution_minutes", hc.avg_resolution_minutes, resolutionExactForCompare, resolutionMetric.display);
  compareHeader("sla_compliance_pct", hc.sla_compliance_pct, asPercent(slaExactForCompare), slaMetric.display);
  compareHeader("csat_mean", hc.csat_mean, csatMeanExactForCompare, csat.mean.display);
  compareHeader("csat_positive_pct", hc.csat_positive_pct, asPercent(csatPositiveExactForCompare), csat.positive_share.display);

  let coverageState;
  if (admittedCount === 0) coverageState = populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY";
  else coverageState = populationVerified ? "COMPLETE" : "PARTIAL";

  const status = admittedCount === 0 ? "EMPTY" : populationVerified ? "REPORT_READY" : "PARTIAL";

  const quarantined_sources = ticket_results.flatMap((t) => t._quarantined);
  const cleanTicketResults = ticket_results.map(({ _quarantined, ...rest }) => rest);

  const source_refs = [];
  const seenRefs = new Set();
  for (const r of [ctx.criteria.policy_ref, validatedTask.ticket_bundle_ref]) {
    const k = refKey(r);
    if (seenRefs.has(k)) continue;
    seenRefs.add(k);
    source_refs.push({ repo: r.repo, path: r.path, commit: r.commit, blob: r.blob, algorithm: r.algorithm, revision: r.revision });
  }

  const report = {
    population,
    ticket_results: cleanTicketResults,
    metrics: {
      response_time: responseMetric,
      resolution_time: resolutionMetric,
      sla_compliance: slaMetric,
      csat_mean: csat.mean,
      csat_positive_share: csat.positive_share,
    },
    header_comparisons,
    pending_ids,
    excluded_ids,
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount, pending_count: pendingCount },
  };

  // Dedupe: both draft variants on a ticket carry the identical flag, and
  // the top-level envelope list should name each (ticket, flag) once.
  const routing_flags = [];
  const seenFlags = new Set();
  for (const t of cleanTicketResults) {
    for (const d of t.drafts) {
      for (const f of d.routing_flags) {
        const k = `${f.code}|${f.ticket_id}`;
        if (seenFlags.has(k)) continue;
        seenFlags.add(k);
        routing_flags.push(f);
      }
    }
  }

  const result = envelope(task, {
    status,
    complete: true,
    source_refs,
    diagnostics: [],
    quarantined_sources,
    routing_flags,
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
    r.ticket_results.length +
    r.header_comparisons.length +
    r.pending_ids.length +
    r.excluded_ids.length +
    result.diagnostics.length +
    result.quarantined_sources.length +
    result.routing_flags.length +
    result.source_refs.length
  );
}

export { validateTask, validateContext, BUDGET_LIMITS, canonicalJson, sha256HexUtf8, makeBudget };
