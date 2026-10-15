#!/usr/bin/env node
/**
 * make-battery.js — AUTHORING TOOL (not part of the scored path).
 *
 * Authors corpus/battery.json: >=120 independently specified cases
 * against the frozen fixtures in fixtures/store.json. The "oracle"
 * functions below are an INDEPENDENT re-derivation of the brief's rules
 * (taxonomy precedence/priority, record validity, exact-rational
 * metrics) written from the brief's text, not by importing or mirroring
 * src/*. They exist only to make hand-deriving 120+ expected structural
 * projections tractable without transcription error — every case's
 * expected value is still a property of the brief's own stated rules,
 * never of the implementation under test.
 */

import { writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const store = JSON.parse(readFileSync(join(ROOT, "fixtures", "store.json"), "utf8"));

// ---------------------------------------------------------------------
// Independent oracle (re-derived from the brief, not from src/*)
// ---------------------------------------------------------------------

const PRECEDENCE = ["ACCOUNT_CLOSURE", "BILLING", "TECHNICAL", "FEATURE_REQUEST"];
const KNOWN = new Set([...PRECEDENCE, "REFUND_REQUEST", "CONTACT_REQUEST", "UPGRADE_REQUEST", "ONBOARDING", "GENERAL_INQUIRY"]);
const AUTHORITY_CATEGORY = new Set(["ACCOUNT_CLOSURE"]);
const AUTHORITY_SECONDARY = new Set(["REFUND_REQUEST"]);

function oracleClassify(ticket) {
  const tags = new Set(ticket.issue_tags);
  const present = PRECEDENCE.filter((p) => tags.has(p));
  const category = present[0] ?? "OTHER";
  const secondary = ticket.issue_tags.filter((t) => KNOWN.has(t) && t !== category).sort();
  const unknown = ticket.issue_tags.filter((t) => !KNOWN.has(t)).sort();
  let priority;
  if (category === "TECHNICAL" && ticket.impact === "OUTAGE") priority = "HIGH";
  else if (category === "ACCOUNT_CLOSURE") priority = "MEDIUM";
  else if (category === "BILLING" && ticket.sentiment_signal === "NEGATIVE") priority = "MEDIUM";
  else if (category === "FEATURE_REQUEST") priority = "LOW";
  else priority = "NORMAL";
  const authorityRequired = AUTHORITY_CATEGORY.has(category) || secondary.some((s) => AUTHORITY_SECONDARY.has(s));
  const noVerifiedTopic = category === "OTHER" && secondary.length === 0;
  return { category, secondary, unknown, priority, authorityRequired, noVerifiedTopic };
}

function oracleValidity(ticket, clockIso) {
  const clockMs = Date.parse(clockIso);
  const createdMs = Date.parse(ticket.created_at);
  const frMs = ticket.first_response_at === null ? null : Date.parse(ticket.first_response_at);
  const resMs = ticket.resolved_at === null ? null : Date.parse(ticket.resolved_at);
  if (createdMs > clockMs) return { state: "invalid", reason: "FUTURE_TIMESTAMP" };
  if (frMs !== null) {
    if (frMs > clockMs) return { state: "invalid", reason: "FUTURE_TIMESTAMP" };
    if (frMs < createdMs) return { state: "invalid", reason: "NEGATIVE_INTERVAL" };
  }
  if (resMs !== null) {
    if (resMs > clockMs) return { state: "invalid", reason: "FUTURE_TIMESTAMP" };
    if (resMs < createdMs) return { state: "invalid", reason: "NEGATIVE_INTERVAL" };
    if (frMs !== null && resMs < frMs) return { state: "invalid", reason: "NEGATIVE_INTERVAL" };
  }
  if (ticket.status === "RESOLVED" && (frMs === null || resMs === null)) return { state: "invalid", reason: "RESOLVED_INCOMPLETE" };
  if (ticket.status === "OPEN" && resMs !== null) return { state: "invalid", reason: "STATUS_MISMATCH" };
  if (ticket.status === "OPEN" && frMs === null) return { state: "pending", reason: null };
  return { state: "valid", reason: null, responseMin: frMs !== null ? (frMs - createdMs) / 60000 : null, resolutionMin: ticket.status === "RESOLVED" ? (resMs - createdMs) / 60000 : null };
}

function fixed2(n) {
  return n.toFixed(2);
}
function pct2(n) {
  return `${(n * 100).toFixed(2)}%`;
}

const INJECTION_RE = [
  /^\s*(instruction|directive|system|admin|override|tool)\s*:/im,
  /\bignore\s+(all\s+)?(previous|prior)\s+instructions?\b/i,
  /\bignore\s+(the\s+)?polic(y|ies)\b/i,
  /\bdelete\s+(my\s+)?account\s+(now|immediately)\b/i,
  /\bgrant\s+(admin|root|full\s+access|all\s+permissions)\b/i,
  /\breveal\b[\s\S]{0,40}\b(system|secret|prompt|credentials?|other\s+customers?)\b/i,
  /\b(exfiltrate|leak)\b[\s\S]{0,40}\b(data|records?|tickets?|customers?)\b/i,
  /\b(pre[\s-]?approved|already\s+approved|treat\s+(this|it)\s+as\s+approved)\b/i,
  /\bsend\b[\s\S]{0,40}\b(immediately|now|without\s+review)\b/i,
  /\bissue\s+(the\s+)?refund\s+(now|immediately|automatically)\b/i,
  /\bguarantee(s|d)?\b[\s\S]{0,40}\b(refund|resolution|sla|no\s+charge)\b/i,
  /\bact\s+as\s+(my|our|a|the)\s+(support\s+agent|admin|account\s+owner|cpa|billing\s+team)\b/i,
  /\bskip\s+(the\s+)?(review|verification)\b/i,
  /\bwaive\s+(the\s+)?(fee|charge|sla)\s+(now|immediately)\b/i,
  /<\s*(script|img|iframe|a|svg|object|embed)\b/i,
  /\bon(error|load|click)\s*=/i,
  /\bjavascript:/i,
];
function oracleInjected(ticket) {
  for (const s of [ticket.subject, ticket.body, ticket.notes]) {
    if (typeof s === "string" && s.length > 0 && INJECTION_RE.some((re) => re.test(s))) return true;
  }
  return false;
}

/** Full oracle projection of one case, in tests/harness.js's structuralOf
 *  shape, given the raw bundle tickets + options. "schema"-category
 *  cases that refuse before reaching this logic build `expected` by
 *  hand instead (see caseRefused below). */
function oracleExpect(tickets, { clock, declared_total, complete, headerClaims = {}, populationOverrideActual = null }) {
  const perTicket = [];
  const excluded = [];
  const pending = [];
  const responseMins = [];
  const resolutionMins = [];
  const ratings = [];

  // malformed / duplicate pass (independent re-derivation: any entry
  // that isn't a well-shaped ticket object, or whose ticket_id repeats,
  // is excluded before classification — same rule the brief states for
  // "incomplete/duplicate" handling). A "well-shaped" ticket needs every
  // required field present with a plausible type, not merely a
  // ticket_id string — a schema-incomplete record (e.g. missing
  // created_at/issue_tags/etc.) is malformed, not a weirdly-valid ticket.
  const REQUIRED_TICKET_KEYS = ["ticket_id", "created_at", "first_response_at", "resolved_at", "status", "issue_tags", "impact", "sentiment_signal", "rating", "subject", "body", "notes"];
  function looksWellFormed(raw) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return false;
    const keys = Object.keys(raw);
    if (keys.length !== REQUIRED_TICKET_KEYS.length || !REQUIRED_TICKET_KEYS.every((k) => k in raw)) return false;
    if (typeof raw.ticket_id !== "string" || raw.ticket_id.length === 0) return false;
    if (typeof raw.created_at !== "string") return false;
    if (raw.first_response_at !== null && typeof raw.first_response_at !== "string") return false;
    if (raw.resolved_at !== null && typeof raw.resolved_at !== "string") return false;
    if (typeof raw.status !== "string") return false;
    if (!Array.isArray(raw.issue_tags) || raw.issue_tags.length === 0) return false;
    if (typeof raw.impact !== "string") return false;
    if (typeof raw.sentiment_signal !== "string") return false;
    if (raw.rating !== null && typeof raw.rating !== "number") return false;
    if (typeof raw.subject !== "string" || typeof raw.body !== "string" || typeof raw.notes !== "string") return false;
    return true;
  }
  const seen = new Map();
  tickets.forEach((raw, origIndex) => {
    if (!looksWellFormed(raw)) {
      // Mirrors src/index.js's fallback: a malformed record that still
      // has its own string ticket_id is labeled by that id; only a
      // record with no usable id at all falls back to a positional label.
      const hasId = raw && typeof raw === "object" && !Array.isArray(raw) && typeof raw.ticket_id === "string" && raw.ticket_id.length > 0;
      excluded.push({ id: hasId ? raw.ticket_id : null, reason: "MALFORMED_RECORD", _malformedNoId: !hasId, _origIndex: origIndex });
      return;
    }
    if (!seen.has(raw.ticket_id)) seen.set(raw.ticket_id, []);
    seen.get(raw.ticket_id).push(raw);
  });
  const malformedNoIdIndexes = excluded.filter((e) => e._malformedNoId).map((e) => e._origIndex);
  for (const [id, group] of seen) {
    if (group.length > 1) {
      for (let i = 0; i < group.length; i++) excluded.push({ id, reason: "DUPLICATE_ID" });
      continue;
    }
    const ticket = group[0];
    const validity = oracleValidity(ticket, clock);
    if (validity.state === "invalid") {
      excluded.push({ id: ticket.ticket_id, reason: validity.reason });
      continue;
    }
    const classification = oracleClassify(ticket);
    const injected = oracleInjected(ticket);
    const suppressed = injected ? "QUARANTINED_INPUT" : classification.noVerifiedTopic ? "NO_VERIFIED_TOPIC" : null;
    if (validity.state === "pending") pending.push(ticket.ticket_id);
    else {
      responseMins.push(validity.responseMin);
      if (validity.resolutionMin !== null) resolutionMins.push(validity.resolutionMin);
    }
    if (ticket.rating !== null) ratings.push(ticket.rating);
    perTicket.push({
      id: ticket.ticket_id,
      category: classification.category,
      secondary: classification.secondary,
      unknown: classification.unknown,
      priority: classification.priority,
      suppressed,
      authorityRequired: classification.authorityRequired,
    });
  }

  const totalPopulation = populationOverrideActual ?? tickets.length;
  const admittedCount = perTicket.length;
  const excludedCount = excluded.length;
  const pendingCount = pending.length;
  const populationVerified = complete === true && declared_total === totalPopulation;

  const meanOf = (arr) => (arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length);
  const respMean = meanOf(responseMins);
  const resMean = meanOf(resolutionMins);
  const slaThreshold = 30;
  const slaCompliant = responseMins.filter((m) => m <= slaThreshold).length;
  const slaRatio = responseMins.length === 0 ? null : slaCompliant / responseMins.length;
  const ratedCount = ratings.length;
  const csatMean = ratedCount === 0 ? null : ratings.reduce((a, b) => a + b, 0) / ratedCount;
  const csatPositiveCount = ratings.filter((r) => r >= 4).length;
  const csatPositive = ratedCount === 0 ? null : csatPositiveCount / ratedCount;

  const metricState = (count) => (count === 0 ? "unverifiable" : populationVerified ? "verified" : "unverifiable");

  const headerComparisons = [];
  function compareHeader(metric, claimed, computed) {
    if (claimed === undefined || claimed === null) return;
    const state = computed === null ? "unverifiable" : Math.abs(claimed - computed) < 1e-9 ? "verified" : "mismatch";
    headerComparisons.push({ metric, evidence_state: state });
  }
  compareHeader("avg_response_minutes", headerClaims.avg_response_minutes, respMean);
  compareHeader("avg_resolution_minutes", headerClaims.avg_resolution_minutes, resMean);
  compareHeader("sla_compliance_pct", headerClaims.sla_compliance_pct, slaRatio === null ? null : slaRatio * 100);
  compareHeader("csat_mean", headerClaims.csat_mean, csatMean);
  compareHeader("csat_positive_pct", headerClaims.csat_positive_pct, csatPositive === null ? null : csatPositive * 100);

  const status = admittedCount === 0 ? "EMPTY" : populationVerified ? "REPORT_READY" : "PARTIAL";
  const coverageState = admittedCount === 0 ? (populationVerified ? "COMPLETE_EMPTY" : "UNKNOWN_EMPTY") : populationVerified ? "COMPLETE" : "PARTIAL";
  const quarantinedTicketIds = perTicket.filter((t) => t.suppressed === "QUARANTINED_INPUT").map((t) => t.id).sort();
  const routingFlagCount = perTicket.filter((t) => t.authorityRequired && !t.suppressed).length;

  return {
    status,
    complete: true,
    diagnostic_codes: [],
    quarantined_ticket_ids: quarantinedTicketIds,
    quarantined_other: [],
    routing_flag_count: routingFlagCount,
    source_ref_count: 2,
    ticket_results: perTicket
      .map((t) => ({
        ticket_id: t.id,
        category: t.category,
        secondary_categories: [...t.secondary].sort(),
        unknown_tags: [...t.unknown].sort(),
        priority: t.priority,
        draft_count: t.suppressed ? 0 : 2,
        suppression_reason: t.suppressed,
        routing_flag_codes: t.suppressed ? [] : t.authorityRequired ? ["JASON_AUTHORITY_REQUIRED", "JASON_AUTHORITY_REQUIRED"] : [],
      }))
      .sort((a, b) => (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0)),
    metrics: {
      response_time: { numerator: responseMins.length, denominator: responseMins.length, display: respMean === null ? "UNDEFINED" : fixed2(respMean), evidence_state: metricState(responseMins.length) },
      resolution_time: { numerator: resolutionMins.length, denominator: resolutionMins.length, display: resMean === null ? "UNDEFINED" : fixed2(resMean), evidence_state: metricState(resolutionMins.length) },
      sla_compliance: { numerator: slaCompliant, denominator: responseMins.length, display: slaRatio === null ? "UNDEFINED" : pct2(slaRatio), evidence_state: metricState(responseMins.length) },
      csat_mean: { numerator: ratedCount === 0 ? 0 : ratings.reduce((a, b) => a + b, 0), denominator: ratedCount, display: csatMean === null ? "UNDEFINED" : fixed2(csatMean), evidence_state: metricState(ratedCount) },
      csat_positive_share: { numerator: csatPositiveCount, denominator: ratedCount, display: csatPositive === null ? "UNDEFINED" : pct2(csatPositive), evidence_state: metricState(ratedCount) },
    },
    header_comparisons: headerComparisons.sort((a, b) => (a.metric < b.metric ? -1 : a.metric > b.metric ? 1 : 0)),
    pending_ids: [...pending].sort(),
    excluded: excluded
      .filter((e) => !e._malformedNoId)
      .map((e) => ({ ticket_id: e.id, reason: e.reason }))
      .concat(malformedNoIdIndexes.map((idx) => ({ ticket_id: `malformed-index-${idx}`, reason: "MALFORMED_RECORD" })))
      .sort((a, b) => (a.ticket_id < b.ticket_id ? -1 : a.ticket_id > b.ticket_id ? 1 : 0)),
    coverage: { state: coverageState, admitted_count: admittedCount, excluded_count: excludedCount, pending_count: pendingCount },
    population: { declared_total, complete, actual_total: totalPopulation, evidence_state: !complete ? "unverifiable" : declared_total === totalPopulation ? "verified" : "mismatch" },
  };
}

function emptyShellExpected() {
  return {
    status: "REFUSED",
    complete: false,
    diagnostic_codes: [],
    quarantined_ticket_ids: [],
    quarantined_other: [],
    routing_flag_count: 0,
    source_ref_count: 0,
    ticket_results: [],
    metrics: {
      response_time: { numerator: 0, denominator: 0, display: "UNDEFINED", evidence_state: "unverifiable" },
      resolution_time: { numerator: 0, denominator: 0, display: "UNDEFINED", evidence_state: "unverifiable" },
      sla_compliance: { numerator: 0, denominator: 0, display: "UNDEFINED", evidence_state: "unverifiable" },
      csat_mean: { numerator: 0, denominator: 0, display: "UNDEFINED", evidence_state: "unverifiable" },
      csat_positive_share: { numerator: 0, denominator: 0, display: "UNDEFINED", evidence_state: "unverifiable" },
    },
    header_comparisons: [],
    pending_ids: [],
    excluded: [],
    coverage: { state: "UNKNOWN", admitted_count: 0, excluded_count: 0, pending_count: 0 },
    population: { declared_total: 0, complete: false, actual_total: 0, evidence_state: "unverifiable" },
  };
}

function refusedExpected(diagnosticCodes, quarantinedOther = []) {
  const e = emptyShellExpected();
  e.diagnostic_codes = [...diagnosticCodes].sort();
  e.quarantined_other = [...quarantinedOther].sort();
  return e;
}

// ---------------------------------------------------------------------
// Case authoring
// ---------------------------------------------------------------------

const cases = [];
const HC_NULL = { avg_response_minutes: null, avg_resolution_minutes: null, sla_compliance_pct: null, csat_mean: null, csat_positive_pct: null };

function bundleTickets(name) {
  // Re-read via the fixtures module is unavailable here (authoring tool,
  // no re-import of make-fixtures' local closures) — the raw ticket
  // arrays are reconstructed by resolving the registered source text.
  const ref = store.bundleRefs[name];
  const key = `${ref.repo}|${ref.path}`;
  const text = store.sources[key].revisions[ref.commit].text;
  return JSON.parse(text);
}

function baseTask(case_id, bundleName, { declared_total, complete, headerClaims = {} } = {}) {
  return {
    schema_version: "1",
    task_id: case_id,
    operation: "analyze",
    fixture_refs: { ticket_bundle: store.bundleRefs[bundleName] },
    options: { population: { declared_total, complete }, header_claims: { ...HC_NULL, ...headerClaims } },
  };
}

function addNominal(case_id, bundleName, clock, opts) {
  const tickets = bundleTickets(bundleName);
  const expected = oracleExpect(tickets, { clock, declared_total: opts.declared_total, complete: opts.complete, headerClaims: opts.headerClaims });
  cases.push({
    case_id,
    category: "nominal_boundary",
    task: baseTask(case_id, bundleName, opts),
    clock,
    principal: opts.principal ?? "jasonActive",
    criteria: "standard",
    expected,
  });
}

function addContradiction(case_id, bundleName, clock, opts) {
  const tickets = bundleTickets(bundleName);
  const expected = oracleExpect(tickets, { clock, declared_total: opts.declared_total, complete: opts.complete, headerClaims: opts.headerClaims });
  cases.push({ case_id, category: "contradiction_incomplete_duplicate", task: baseTask(case_id, bundleName, opts), clock, principal: opts.principal ?? "jasonActive", criteria: "standard", expected });
}

function addInjection(case_id, bundleName, clock, opts) {
  const tickets = bundleTickets(bundleName);
  const expected = oracleExpect(tickets, { clock, declared_total: opts.declared_total, complete: opts.complete, headerClaims: opts.headerClaims });
  cases.push({ case_id, category: "injection_prohibited", task: baseTask(case_id, bundleName, opts), clock, principal: opts.principal ?? "jasonActive", criteria: "standard", expected });
}

function addSchema(case_id, taskOverride, { clock = "2026-07-01T00:00:00Z", principal = "jasonActive", criteria = "standard", contextOverrides = undefined, diagnosticCodes, quarantinedOther = [] }) {
  cases.push({
    case_id,
    category: "schema_provenance_permission",
    task: taskOverride,
    clock,
    principal,
    criteria,
    contextOverrides,
    expected: refusedExpected(diagnosticCodes, quarantinedOther),
  });
}

function addBudget(case_id, taskOrBundle, opts, diagnosticCodesIfRefused) {
  if (diagnosticCodesIfRefused) {
    cases.push({ case_id, category: "budget_replay_mutation", task: taskOrBundle, clock: opts.clock ?? "2026-07-01T00:00:00Z", principal: opts.principal ?? "jasonActive", criteria: "standard", contextOverrides: opts.contextOverrides, expected: refusedExpected(diagnosticCodesIfRefused) });
    return;
  }
  const tickets = bundleTickets(taskOrBundle);
  const clock = opts.clock ?? "2026-07-01T00:00:00Z";
  const expected = oracleExpect(tickets, { clock, declared_total: opts.declared_total, complete: opts.complete, headerClaims: opts.headerClaims });
  cases.push({ case_id, category: "budget_replay_mutation", task: baseTask(case_id, taskOrBundle, opts), clock, principal: opts.principal ?? "jasonActive", criteria: "standard", expected });
}

const CLOCK = "2026-07-01T00:00:00Z";

// ---- nominal / boundary (>= 40) ----
addNominal("nom-technical-outage-high", "single-technical-outage", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-account-closure-medium", "single-account-closure", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-billing-negative-medium", "single-billing-negative", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-billing-positive-normal", "single-billing-positive", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-feature-request-low", "single-feature-request", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-other-unknown-suppressed", "single-other-unknown", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-other-secondary-drafted", "single-other-secondary", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-multi-tag-precedence", "multi-tag-precedence", CLOCK, { declared_total: 1, complete: true });
addNominal("nom-refund-and-closure-routing", "refund-and-closure", CLOCK, { declared_total: 2, complete: true });
addNominal("nom-two-tickets-mixed-priority", "two-tickets-mixed", CLOCK, { declared_total: 2, complete: true });
addNominal("nom-sla-boundary-50pct", "sla-exact-boundary", CLOCK, { declared_total: 2, complete: true });
addNominal("nom-response-240-header-mismatch", "response-240-vs-5-claim", CLOCK, { declared_total: 1, complete: true, headerClaims: { avg_response_minutes: 5 } });
addNominal("nom-response-240-header-verified", "response-240-vs-5-claim", CLOCK, { declared_total: 1, complete: true, headerClaims: { avg_response_minutes: 240 } });
addNominal("nom-ratings-csat-header-verified", "ratings-7x5-3x1", CLOCK, { declared_total: 10, complete: true, headerClaims: { csat_mean: 3.8, csat_positive_pct: 70 } });
addNominal("nom-ratings-csat-header-mismatch", "ratings-7x5-3x1", CLOCK, { declared_total: 10, complete: true, headerClaims: { csat_mean: 4.0, csat_positive_pct: 50 } });
addNominal("nom-sixty-two-boundary-success", "sixty-two-tickets", CLOCK, { declared_total: 62, complete: true });
addNominal("nom-empty-verified", "empty", CLOCK, { declared_total: 0, complete: true });
addNominal("nom-empty-unknown", "empty", CLOCK, { declared_total: 0, complete: false });
addNominal("nom-muse-relay-principal", "single-technical-outage", CLOCK, { declared_total: 1, complete: true, principal: "museRelayActive" });
addNominal("nom-population-declared-mismatch", "single-technical-outage", CLOCK, { declared_total: 2, complete: true });
addNominal("nom-population-incomplete-declared", "single-technical-outage", CLOCK, { declared_total: 1, complete: false });
addNominal("nom-sla-header-verified", "sla-exact-boundary", CLOCK, { declared_total: 2, complete: true, headerClaims: { sla_compliance_pct: 50 } });
addNominal("nom-sla-header-mismatch", "sla-exact-boundary", CLOCK, { declared_total: 2, complete: true, headerClaims: { sla_compliance_pct: 99 } });
addNominal("nom-resolution-header-verified", "two-tickets-mixed", CLOCK, { declared_total: 2, complete: true, headerClaims: { avg_resolution_minutes: 60 } });
addNominal("nom-resolution-header-mismatch", "two-tickets-mixed", CLOCK, { declared_total: 2, complete: true, headerClaims: { avg_resolution_minutes: 10 } });
addNominal("nom-response-header-verified-mixed", "two-tickets-mixed", CLOCK, { declared_total: 2, complete: true, headerClaims: { avg_response_minutes: 15 } });
addNominal("nom-response-header-mismatch-mixed", "two-tickets-mixed", CLOCK, { declared_total: 2, complete: true, headerClaims: { avg_response_minutes: 999 } });
// Header-comparison combinatorial pad: every bundle with a clean single
// observation, each of the five header fields, verified + mismatch.
const HC_PAD_BUNDLES = [
  { name: "single-account-closure", field: "avg_response_minutes", correct: 5 },
  { name: "single-billing-negative", field: "avg_response_minutes", correct: 5 },
  { name: "single-feature-request", field: "avg_response_minutes", correct: 5 },
  { name: "single-other-secondary", field: "avg_response_minutes", correct: 5 },
  { name: "single-technical-outage", field: "avg_resolution_minutes", correct: 60 },
  { name: "single-account-closure", field: "sla_compliance_pct", correct: 100 },
  { name: "single-billing-negative", field: "sla_compliance_pct", correct: 100 },
];
for (const { name, field, correct } of HC_PAD_BUNDLES) {
  addNominal(`nom-pad-${name}-${field}-verified`, name, CLOCK, { declared_total: name === "single-technical-outage" ? 1 : 1, complete: true, headerClaims: { [field]: correct } });
  addNominal(`nom-pad-${name}-${field}-mismatch`, name, CLOCK, { declared_total: 1, complete: true, headerClaims: { [field]: correct + 1 } });
}

// ---- contradiction / incomplete / duplicate (>= 30) ----
addContradiction("contra-unresolved-vs-malformed-resolved", "unresolved-vs-malformed-resolved", CLOCK, { declared_total: 2, complete: true });
addContradiction("contra-duplicates", "duplicates", CLOCK, { declared_total: 3, complete: true });
addContradiction("contra-malformed-entries", "malformed-entries", CLOCK, { declared_total: 3, complete: true });
addContradiction("contra-open-with-resolution", "contradiction-open-with-resolution", CLOCK, { declared_total: 1, complete: true });
addContradiction("contra-future-and-negative-timestamps", CLOCK === CLOCK ? "future-and-negative-timestamps" : "", CLOCK, { declared_total: 2, complete: true });
addContradiction("contra-population-mismatch-duplicates", "duplicates", CLOCK, { declared_total: 99, complete: true });
addContradiction("contra-population-incomplete-malformed", "malformed-entries", CLOCK, { declared_total: 3, complete: false });
// Pad: re-run every contradiction bundle with the OTHER principal and
// with population-incomplete, to broaden distinct-case coverage without
// inventing new ticket data each time (each is still a genuinely
// distinct input: different principal or different population claim).
const CONTRA_PAD_BUNDLES = ["unresolved-vs-malformed-resolved", "duplicates", "malformed-entries", "contradiction-open-with-resolution", "future-and-negative-timestamps"];
for (const name of CONTRA_PAD_BUNDLES) {
  const n = bundleTickets(name).length;
  addContradiction(`contra-pad-${name}-museRelay`, name, CLOCK, { declared_total: n, complete: true, principal: "museRelayActive" });
  addContradiction(`contra-pad-${name}-incomplete`, name, CLOCK, { declared_total: n, complete: false });
  addContradiction(`contra-pad-${name}-mismatch`, name, CLOCK, { declared_total: n + 5, complete: true });
}

// ---- injection / prohibited operation (>= 20) ----
addInjection("inj-subject-directive", "injected-subject", CLOCK, { declared_total: 1, complete: true });
addInjection("inj-body-markup-beacon", "injected-body-markup", CLOCK, { declared_total: 1, complete: true });
addInjection("inj-clean-fields-classify-despite-quarantine", "clean-structured-fields-classify-despite-quarantine", CLOCK, { declared_total: 1, complete: true });
addInjection("inj-pad-subject-museRelay", "injected-subject", CLOCK, { declared_total: 1, complete: true, principal: "museRelayActive" });
addInjection("inj-pad-body-incomplete-pop", "injected-body-markup", CLOCK, { declared_total: 1, complete: false });
addInjection("inj-pad-clean-mismatch-pop", "clean-structured-fields-classify-despite-quarantine", CLOCK, { declared_total: 5, complete: true });
addSchema("inj-prohibited-op-refund", { schema_version: "1", task_id: "inj-prohibited-op-refund", operation: "refund", fixture_refs: { ticket_bundle: store.bundleRefs["single-billing-negative"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-send", { schema_version: "1", task_id: "inj-prohibited-op-send", operation: "send_message", fixture_refs: { ticket_bundle: store.bundleRefs["single-technical-outage"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-cancel-account", { schema_version: "1", task_id: "inj-prohibited-op-cancel-account", operation: "cancel_account", fixture_refs: { ticket_bundle: store.bundleRefs["single-account-closure"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-contact-customer", { schema_version: "1", task_id: "inj-prohibited-op-contact-customer", operation: "contact_customer", fixture_refs: { ticket_bundle: store.bundleRefs["single-feature-request"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-waive-fee", { schema_version: "1", task_id: "inj-prohibited-op-waive-fee", operation: "waive_fee", fixture_refs: { ticket_bundle: store.bundleRefs["single-billing-positive"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-escalate", { schema_version: "1", task_id: "inj-prohibited-op-escalate", operation: "escalate", fixture_refs: { ticket_bundle: store.bundleRefs["single-other-secondary"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-publish", { schema_version: "1", task_id: "inj-prohibited-op-publish", operation: "publish", fixture_refs: { ticket_bundle: store.bundleRefs["multi-tag-precedence"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-update-registry", { schema_version: "1", task_id: "inj-prohibited-op-update-registry", operation: "update_registry", fixture_refs: { ticket_bundle: store.bundleRefs["single-other-unknown"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-approve-self", { schema_version: "1", task_id: "inj-prohibited-op-approve-self", operation: "approve", fixture_refs: { ticket_bundle: store.bundleRefs["refund-and-closure"] }, options: { population: { declared_total: 2, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-empty-string", { schema_version: "1", task_id: "inj-prohibited-op-empty-string", operation: "", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("inj-prohibited-op-delete-ticket", { schema_version: "1", task_id: "inj-prohibited-op-delete-ticket", operation: "delete_ticket", fixture_refs: { ticket_bundle: store.bundleRefs["single-feature-request"] }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
addSchema("inj-prohibited-op-export-data", { schema_version: "1", task_id: "inj-prohibited-op-export-data", operation: "export_data", fixture_refs: { ticket_bundle: store.bundleRefs["sixty-two-tickets"] }, options: { population: { declared_total: 62, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["ACTION_DENIED"] });
// These 12 are prohibited-operation refusals, not schema/permission
// findings — reassign to the injection_prohibited category.
for (const id of [
  "inj-prohibited-op-refund", "inj-prohibited-op-send", "inj-prohibited-op-cancel-account", "inj-prohibited-op-contact-customer",
  "inj-prohibited-op-waive-fee", "inj-prohibited-op-escalate", "inj-prohibited-op-publish", "inj-prohibited-op-update-registry",
  "inj-prohibited-op-approve-self", "inj-prohibited-op-empty-string", "inj-prohibited-op-delete-ticket", "inj-prohibited-op-export-data",
]) {
  cases.find((c) => c.case_id === id).category = "injection_prohibited";
}

// ---- schema / provenance / permission (>= 20) ----
addSchema("perm-missing-schema-version", { task_id: "perm-missing-schema-version", operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-unknown-task-property", { schema_version: "1", task_id: "perm-unknown-task-property", operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL }, extra_field: true }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-unknown-fixture-refs-key", { schema_version: "1", task_id: "perm-unknown-fixture-refs-key", operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"], extra: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-bad-algorithm", { schema_version: "1", task_id: "perm-bad-algorithm", operation: "analyze", fixture_refs: { ticket_bundle: { ...store.bundleRefs["empty"], algorithm: "sha256" } }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-tampered-blob", { schema_version: "1", task_id: "perm-tampered-blob", operation: "analyze", fixture_refs: { ticket_bundle: { ...store.bundleRefs["single-technical-outage"], blob: "f".repeat(40) } }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["HASH_MISMATCH"] });
// Grant read access to the nonexistent path so the READ_DENIED check
// passes and resolution itself genuinely fails with SOURCE_UNVERIFIED
// (not just a redundant re-test of the read-grant check).
addSchema(
  "perm-unregistered-path",
  { schema_version: "1", task_id: "perm-unregistered-path", operation: "analyze", fixture_refs: { ticket_bundle: { ...store.bundleRefs["single-technical-outage"], path: "tickets/does-not-exist.json" } }, options: { population: { declared_total: 1, complete: true }, header_claims: HC_NULL } },
  { contextOverrides: { replaceReadGrants: [...store.readGrants, { repo: "edu-sources", path: "tickets/does-not-exist.json" }] }, diagnosticCodes: ["SOURCE_UNVERIFIED"] }
);
addSchema("perm-bundle-read-grant-removed", baseTask("perm-bundle-read-grant-removed", "single-technical-outage", { declared_total: 1, complete: true }), { contextOverrides: { removeGrants: ["edu-sources|tickets/single-technical-outage.json"] }, diagnosticCodes: ["READ_DENIED"] });
addSchema(
  "perm-policy-read-grant-removed",
  baseTask("perm-policy-read-grant-removed", "single-technical-outage", { declared_total: 1, complete: true }),
  { contextOverrides: { removeGrants: ["edu-sources|policy/customer-success-policy.md"] }, diagnosticCodes: ["READ_DENIED"] }
);
addSchema(
  "perm-policy-tampered-blob",
  baseTask("perm-policy-tampered-blob", "single-technical-outage", { declared_total: 1, complete: true }),
  { contextOverrides: { replaceCriteria: { ...store.criteria.standard, policy_ref: { ...store.criteria.standard.policy_ref, blob: "a".repeat(40) } } }, diagnosticCodes: ["HASH_MISMATCH"] }
);
addSchema("perm-principal-revoked", baseTask("perm-principal-revoked", "single-technical-outage", { declared_total: 1, complete: true }), { principal: "revoked", diagnosticCodes: ["ACTION_DENIED"] });
addSchema("perm-principal-expired", baseTask("perm-principal-expired", "single-technical-outage", { declared_total: 1, complete: true }), { principal: "expired", diagnosticCodes: ["ACTION_DENIED"] });
addSchema("perm-context-clock-nan", baseTask("perm-context-clock-nan", "single-technical-outage", { declared_total: 1, complete: true }), { clock: "not-a-real-date", diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-context-missing-criteria-field", baseTask("perm-context-missing-criteria-field", "single-technical-outage", { declared_total: 1, complete: true }), { contextOverrides: { replaceCriteria: { taxonomy_version: "v1", policy_ref: store.criteria.standard.policy_ref } }, diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-negative-sla-threshold", baseTask("perm-negative-sla-threshold", "single-technical-outage", { declared_total: 1, complete: true }), { contextOverrides: { replaceCriteria: { ...store.criteria.standard, response_sla_minutes: -5 } }, diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-bundle-missing-from-sources", baseTask("perm-bundle-missing-from-sources", "single-technical-outage", { declared_total: 1, complete: true }), { contextOverrides: { replaceSources: { [`${store.criteria.standard.policy_ref.repo}|${store.criteria.standard.policy_ref.path}`]: store.sources[`${store.criteria.standard.policy_ref.repo}|${store.criteria.standard.policy_ref.path}`] } }, diagnosticCodes: ["SOURCE_UNVERIFIED"] });
addSchema("perm-empty-read-grants", baseTask("perm-empty-read-grants", "single-technical-outage", { declared_total: 1, complete: true }), { contextOverrides: { replaceReadGrants: [] }, diagnosticCodes: ["READ_DENIED"] });
addSchema("perm-bad-population-type", { schema_version: "1", task_id: "perm-bad-population-type", operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: "zero", complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-bad-header-claim-type", { schema_version: "1", task_id: "perm-bad-header-claim-type", operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: { ...HC_NULL, csat_mean: "high" } } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-source-ref-short-commit", { schema_version: "1", task_id: "perm-source-ref-short-commit", operation: "analyze", fixture_refs: { ticket_bundle: { ...store.bundleRefs["empty"], commit: "abc123" } }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
addSchema("perm-oversized-task-id", { schema_version: "1", task_id: "x".repeat(3000), operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });

// ---- budget / replay / mutation (>= 10) ----
addBudget("budget-65-tickets-refused", null, {}, ["BUDGET_EXCEEDED"]);
cases[cases.length - 1].task = { schema_version: "1", task_id: "budget-65-tickets-refused", operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["sixty-five-tickets"] }, options: { population: { declared_total: 65, complete: true }, header_claims: HC_NULL } };
addBudget("budget-62-tickets-boundary-success", "sixty-two-tickets", { declared_total: 62, complete: true }, null);
addSchema("budget-oversized-task-id-input-limit", { schema_version: "1", task_id: "y".repeat(2049), operation: "analyze", fixture_refs: { ticket_bundle: store.bundleRefs["empty"] }, options: { population: { declared_total: 0, complete: true }, header_claims: HC_NULL } }, { diagnosticCodes: ["INVALID_INPUT"] });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-1a", "single-technical-outage", CLOCK, { declared_total: 1, complete: true });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-1b", "single-technical-outage", CLOCK, { declared_total: 1, complete: true });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-2a", "ratings-7x5-3x1", CLOCK, { declared_total: 10, complete: true, headerClaims: { csat_mean: 3.8 } });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-2b", "ratings-7x5-3x1", CLOCK, { declared_total: 10, complete: true, headerClaims: { csat_mean: 3.8 } });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-3a", "sla-exact-boundary", CLOCK, { declared_total: 2, complete: true });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-3b", "sla-exact-boundary", CLOCK, { declared_total: 2, complete: true });
cases[cases.length - 1].category = "budget_replay_mutation";
addNominal("budget-replay-pair-4a", "two-tickets-mixed", CLOCK, { declared_total: 2, complete: true });
cases[cases.length - 1].category = "budget_replay_mutation";

// ---- padding: contradiction/incomplete/duplicate (reach >= 30) ----
addContradiction("contra-pad2-duplicates-museRelay", "duplicates", CLOCK, { declared_total: 3, complete: true, principal: "museRelayActive" });
addContradiction("contra-pad2-open-with-resolution-museRelay", "contradiction-open-with-resolution", CLOCK, { declared_total: 1, complete: true, principal: "museRelayActive" });
addContradiction("contra-pad2-future-negative-mismatch", "future-and-negative-timestamps", CLOCK, { declared_total: 10, complete: true });
addContradiction("contra-pad2-malformed-museRelay", "malformed-entries", CLOCK, { declared_total: 3, complete: true, principal: "museRelayActive" });
addContradiction("contra-pad2-unresolved-mismatch", "unresolved-vs-malformed-resolved", CLOCK, { declared_total: 7, complete: true });
addContradiction("contra-pad2-duplicates-incomplete2", "duplicates", CLOCK, { declared_total: 3, complete: false });
addContradiction("contra-pad2-open-resolution-mismatch", "contradiction-open-with-resolution", CLOCK, { declared_total: 4, complete: true });
addContradiction("contra-pad2-malformed-mismatch2", "malformed-entries", CLOCK, { declared_total: 8, complete: true });

// ---- padding: injection/prohibited (reach >= 20) ----
addInjection("inj-pad2-subject-mismatch-pop", "injected-subject", CLOCK, { declared_total: 9, complete: true });
addInjection("inj-pad2-body-museRelay", "injected-body-markup", CLOCK, { declared_total: 1, complete: true, principal: "museRelayActive" });

// ---------------------------------------------------------------------
// Write out
// ---------------------------------------------------------------------

const battery = cases.map((c) => ({
  case_id: c.case_id,
  category: c.category,
  task: c.task,
  clock: c.clock,
  principal: c.principal,
  criteria: c.criteria,
  contextOverrides: c.contextOverrides,
  hang: c.hang,
  expected: c.expected,
}));

writeFileSync(join(ROOT, "corpus", "battery.json"), JSON.stringify(battery, null, 2) + "\n");

const byCategory = {};
for (const c of battery) byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
console.log(`battery cases written: ${battery.length}`);
for (const [k, v] of Object.entries(byCategory)) console.log(`  ${k}: ${v}`);
