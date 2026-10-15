/**
 * engine.js — deterministic recommendation engine for the property-manager
 * prototype.
 *
 * Advisory only. The engine resolves a fixture case through the registered
 * fixture store, checks permission evidence through the trusted registry,
 * binds relay records to escalation triggers, and assembles the JSON
 * exception dashboard. It cannot charge, message, waive, edit, dispatch,
 * advise legally, or execute anything: execution_authorized_for_agent is
 * always false.
 *
 * Rules (from the agent brief):
 * - Every tenant/money/legal touchpoint requires an escalation trigger,
 *   even below urgency thresholds. Document-only inquiry is the positive
 *   trigger-free exception.
 * - Spending/tenant-contact authorizer: Jason (or his authorized Muse
 *   relay). Executor: property operator, only after authorization.
 * - Legal interpretations route to a qualified reviewer; the agent makes
 *   no legal determination.
 * - Urgency: immediate = seeded emergency safety condition; high =
 *   confirmed deadline within 48h or urgent maintenance; routine = other.
 *   Spending amount changes urgency only (routine->high at the spend
 *   threshold); $0/small amounts never erase escalation. Unknown
 *   condition/config blocks rather than guessing priority/authority.
 * - Pinned relay records bind action/target/scope/time; operator identity
 *   alone never satisfies them. A valid existing relay record satisfies
 *   authorization without Jason repeating it.
 * - allowed_to_propose requires verified applicable permission evidence,
 *   never operational capability.
 */

import { canonicalJson, gitBlobId, sha256HexUtf8, HEX40 } from "./canonical.js";
import { isValidDateString } from "./schemas.js";
import { scanInjection, isLegalAdviceRequest } from "./injection.js";

export class EngineRefusal extends Error {
  constructor({ status, code, severity, reason, quarantine }) {
    super(reason);
    this.name = "EngineRefusal";
    this.status = status;
    this.code = code;
    this.severity = severity;
    this.reason = reason;
    this.quarantine = quarantine ?? [];
  }
}

const refuse = (fields) => {
  throw new EngineRefusal(fields);
};

function caseBytes(c) {
  return Buffer.from(canonicalJson(c), "utf8");
}

/** Resolve the task's case_ref through the registered fixture store. */
export function resolveCase(task, ctx, budget) {
  const ref = task.case_ref;
  const store = ctx.caseStore;
  budget.countResolution(`case:${ref.case_id}`);
  const c = store.cases.find((x) => x && x.case_id === ref.case_id);
  if (!c) {
    // Unregistered input: refuse without echoing the submitted identifier.
    refuse({
      status: "REFUSED",
      code: "READ_DENIED",
      severity: "error",
      reason: "case_ref does not resolve through the registered fixture store; unregistered input rejected without echo",
    });
  }
  const expectedBlob = gitBlobId(caseBytes(c));
  if (ref.blob !== expectedBlob) {
    refuse({
      status: "REFUSED",
      code: "HASH_MISMATCH",
      severity: "critical",
      reason: `case_ref blob does not match the registered fixture bytes for the case`,
    });
  }
  if (ref.repo !== store.repo) {
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "error",
      reason: "case_ref repo does not match the registered fixture store",
    });
  }
  const expectedPath = `cases/${ref.case_id}.json`;
  if (ref.path !== expectedPath) {
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "error",
      reason: "case_ref path does not match the registered fixture path",
    });
  }
  if (ref.commit !== store.commit_id) {
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "error",
      reason: "case_ref commit does not match the registered fixture store revision",
    });
  }
  return c;
}

export function checkWorkflow(task, c) {
  if (task.workflow !== c.workflow) {
    refuse({
      status: "REFUSED",
      code: "TARGET_MISMATCH",
      severity: "error",
      reason: `task workflow '${task.workflow}' does not match the fixture case workflow`,
    });
  }
}

export function checkScope(task, c) {
  if (!task.context_filters.property_fixture_ids.includes(c.property_fixture_id)) {
    refuse({
      status: "REFUSED",
      code: "READ_DENIED",
      severity: "error",
      reason: "case property is outside the granted context_filters scope; no cross-property access",
    });
  }
}

/** Free-text directive / legal screens, before any case work. */
export function screenNote(task) {
  if (!task.note) return;
  const inj = scanInjection(task.note);
  if (inj.injected) {
    refuse({
      status: "REFUSED",
      code: "INSTRUCTION_INJECTION",
      severity: "critical",
      reason: `task note contains seeded directive content (family: ${inj.family}); refused, no case work performed`,
      quarantine: [{ repo: "task", path: "task.note", reason: `seeded directive family: ${inj.family}` }],
    });
  }
  if (isLegalAdviceRequest(task.note)) {
    refuse({
      status: "REFUSED",
      code: "ACTION_DENIED",
      severity: "critical",
      reason: "legal interpretation requests are denied: legal questions route to a qualified reviewer, the agent makes no legal determination",
    });
  }
}

function noteCitation(store, note_id, budget) {
  budget.countSpan(`note:${note_id}`);
  const text = store.note_texts[note_id];
  if (typeof text !== "string") {
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "error",
      reason: "fixture case references an unregistered note",
    });
  }
  const quoted_span = text.slice(0, 120);
  const start_byte = 0;
  const end_byte = Buffer.byteLength(quoted_span, "utf8");
  const blob = gitBlobId(Buffer.from(text, "utf8"));
  return {
    repo: store.repo,
    path: `notes/${note_id}.md`,
    commit: store.commit_id,
    blob,
    algorithm: "git-sha1",
    revision: "v1",
    quoted_span,
    span: { start_byte, end_byte, quoted_text: quoted_span },
    verification: "VERIFIED",
  };
}

function permissionCitation(store, record, budget) {
  budget.countSpan(`permission:${record.permission_id}`);
  const blob = gitBlobId(Buffer.from(canonicalJson(record), "utf8"));
  return {
    repo: store.repo,
    path: `permissions/${record.permission_id}.json`,
    commit: store.commit_id,
    blob,
    algorithm: "git-sha1",
    revision: "v1",
    quoted_span: `permission ${record.permission_id} grants ${record.grants.actions.join(",")}`,
    span: { start_byte: 0, end_byte: 40, quoted_text: `permission ${record.permission_id} grants ${record.grants.actions.join(",")}` },
    verification: "VERIFIED",
  };
}

/**
 * allowed_to_propose requires verified applicable permission evidence:
 * registered, unrevoked, time-valid, and granting both the action and
 * the case property.
 */
export function checkPermission(store, c, template, clock, budget) {
  const evidence = [];
  let grounded = true;
  for (const pid of template.required_permission_ids) {
    budget.countResolution(`permission:${pid}`);
    const rec = store.permission_records.find((r) => r.permission_id === pid);
    const valid =
      rec &&
      rec.revoked === false &&
      Number.isFinite(rec.valid_from) &&
      Number.isFinite(rec.expires_at) &&
      rec.valid_from <= clock &&
      clock < rec.expires_at &&
      Array.isArray(rec.grants?.actions) &&
      rec.grants.actions.includes(template.action) &&
      Array.isArray(rec.grants?.property_fixture_ids) &&
      rec.grants.property_fixture_ids.includes(c.property_fixture_id);
    if (!valid) {
      grounded = false;
    } else {
      evidence.push(permissionCitation(store, rec, budget));
    }
  }
  if (template.grounding === "conflicted") grounded = false;
  return {
    validity: grounded ? "GROUNDED" : "UNGROUNDED",
    allowed_to_propose: grounded,
    evidence,
  };
}

/**
 * Urgency fixture table (trusted owner configuration, not live policy).
 * immediate = seeded emergency safety condition; high = confirmed
 * deadline within 48h or urgent maintenance; routine = other.
 * Spending amount changes urgency only; $0/small never erase escalation.
 * Unknown condition/config -> blocked uncertainty.
 */
export function computeUrgency(c, clock) {
  const t = c.fixture_urgency ?? {};
  const table = t.table;
  if (c.urgency_seed === "conflict") {
    refuse({
      status: "BLOCKED",
      code: "INVALID_INPUT",
      severity: "error",
      reason: "conflicting after-hours urgency rules in fixture configuration; blocked rather than guessing priority",
    });
  }
  const flags = c.facts?.condition_flags ?? [];
  if (!["immediate", "high", "routine"].includes(c.urgency_seed)) {
    refuse({
      status: "BLOCKED",
      code: "INVALID_INPUT",
      severity: "error",
      reason: `unknown urgency condition '${String(c.urgency_seed)}'; blocked rather than guessing priority`,
    });
  }
  let urgency = c.urgency_seed.toUpperCase();
  // Cross-check the seeded flags against the table (defense in depth):
  const seededEmergency = flags.includes("emergency_safety");
  const seededHigh = flags.includes("urgent_maintenance") || deadlineWithinHours(c.facts?.deadline_iso, clock, table.deadline_high_hours);
  if (urgency === "ROUTINE" && seededEmergency) urgency = "IMMEDIATE";
  if (urgency === "ROUTINE" && seededHigh) urgency = "HIGH";
  // Spending amount changes urgency only: large spend bumps routine -> high.
  const amount = Number(c.facts?.amount_usd ?? 0);
  if (urgency === "ROUTINE" && Number.isFinite(amount) && amount >= table.spend_bump_usd) urgency = "HIGH";
  return urgency;
}

function deadlineWithinHours(deadline_iso, clock, hours) {
  if (!isValidDateString(deadline_iso) || !Number.isFinite(hours)) return false;
  const t = Date.parse(deadline_iso);
  return t >= clock && t - clock <= hours * 3600 * 1000;
}

/**
 * Bind pinned relay records to one escalation trigger. A record satisfies
 * authorization only when: issuer is Jason or his authorized Muse relay
 * (operator identity alone never satisfies), resource binds the case,
 * the action binding covers the required action, the time window covers
 * the clock, it is not revoked, and (for money) the case amount is within
 * the record's amount limit.
 */
export function bindRelay(c, touchpoint, policyEntry, clock, trustRegistry, task, budget, diagnostics) {
  const requiredAction = policyEntry.required_action;
  const evidence_ids = [];
  let satisfied = false;
  const amount = Number(c.facts?.amount_usd ?? 0);
  for (const rec of trustRegistry.relay_records) {
    budget.countResolution(`relay:${rec.record_id}`);
    if (rec.revoked === true) continue;
    if (!(Number.isFinite(rec.valid_from) && Number.isFinite(rec.expires_at) && rec.valid_from <= clock && clock < rec.expires_at)) continue;
    const issuer = trustRegistry.principals[rec.issuer];
    if (!issuer || issuer.authorizes_escalation !== true) continue;
    if (rec.resource !== c.case_id && !(Array.isArray(rec.scope_ids) && rec.scope_ids.includes(c.property_fixture_id))) continue;
    if (!Array.isArray(rec.action_ids) || !rec.action_ids.includes(requiredAction)) continue;
    if (touchpoint === "money" && Number.isFinite(rec.amount_limit_usd) && Number.isFinite(amount) && amount > rec.amount_limit_usd) continue;
    evidence_ids.push(rec.record_id);
    satisfied = true;
  }
  // Claimed relay ids are lookup keys into the trusted registry only;
  // they never create authority. Diagnose failures precisely.
  for (const claimed of task.claimed_relay_ids) {
    if (evidence_ids.includes(claimed)) continue;
    budget.countResolution(`claimed:${claimed}`);
    const rec = trustRegistry.relay_records.find((r) => r.record_id === claimed);
    if (!rec) {
      diagnostics.push({
        code: "AUTH_UNVERIFIED",
        severity: "warning",
        source_ref: null,
        record_id: null,
        reason: `claimed relay record is not registered in the trusted registry`,
      });
      continue;
    }
    if (rec.revoked === true) {
      diagnostics.push({ code: "AUTH_UNVERIFIED", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "claimed relay record is revoked" });
    } else if (!(rec.valid_from <= clock && clock < rec.expires_at)) {
      diagnostics.push({ code: "STALE_EVIDENCE", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "claimed relay record is expired or not yet valid" });
    } else if (rec.resource !== c.case_id && !(rec.scope_ids ?? []).includes(c.property_fixture_id)) {
      diagnostics.push({ code: "TARGET_MISMATCH", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "claimed relay record binds a different target" });
    } else if (!(rec.action_ids ?? []).includes(requiredAction)) {
      diagnostics.push({ code: "TARGET_MISMATCH", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "claimed relay record binds a different action" });
    } else if (touchpoint === "money" && Number.isFinite(rec.amount_limit_usd) && amount > rec.amount_limit_usd) {
      diagnostics.push({ code: "AUTH_UNVERIFIED", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "claimed relay record amount limit is below the case amount" });
    } else {
      const issuer = trustRegistry.principals[rec.issuer];
      if (!issuer || issuer.authorizes_escalation !== true) {
        diagnostics.push({ code: "AUTH_UNVERIFIED", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "operator-issued record cannot satisfy this escalation" });
      }
    }
  }
  return { evidence_ids: [...new Set(evidence_ids)].sort(), satisfied };
}

function recommendationId(case_id, text) {
  return `rec-${sha256HexUtf8(`${case_id}|${text}`).slice(0, 12)}`;
}

/**
 * Build recommendations + escalation triggers for a resolved case.
 * Returns { recommendations, escalation_triggers, contradictions, diagnostics }.
 */
export function buildAdvisory(task, c, ctx, budget) {
  const store = ctx.caseStore;
  const clock = ctx.clock;
  const diagnostics = [];
  const contradictions = [];

  const urgency = computeUrgency(c, clock);

  const recommendations = [];
  for (const template of c.actions) {
    budget.countResolution(`action:${template.action}`);
    const permission_check = checkPermission(store, c, template, clock, budget);
    const basis = [];
    for (const note_id of c.note_ids) {
      const cit = noteCitation(store, note_id, budget);
      if (template.grounding === "conflicted") cit.verification = "UNVERIFIED";
      basis.push(cit);
    }
    recommendations.push({
      recommendation_id: recommendationId(c.case_id, template.text),
      text: template.text,
      basis,
      confidence: template.grounding === "conflicted" ? "LOW" : template.confidence,
      touchpoints: [...template.touchpoints].sort(),
      permission_check,
      escalation_ids: [],
    });
  }

  for (const conflict of c.conflicts ?? []) {
    contradictions.push({
      contradiction_id: `contra-${sha256HexUtf8(`${c.case_id}|${conflict.topic}`).slice(0, 12)}`,
      topic: conflict.topic,
      note_a: conflict.note_a,
      note_b: conflict.note_b,
    });
    diagnostics.push({
      code: "SOURCE_UNVERIFIED",
      severity: "warning",
      source_ref: null,
      record_id: null,
      reason: `conflicting fixture evidence on '${conflict.topic}'; affected recommendation left UNGROUNDED`,
    });
  }

  // Every seeded touchpoint requires an escalation trigger, even below
  // urgency thresholds. Document-only inquiry is the trigger-free exception.
  const touchpoints = [...new Set(c.seeded_touchpoints)].sort();
  const escalation_triggers = [];
  let n = 0;
  for (const tp of touchpoints) {
    const policy = store.escalation_policy[tp];
    if (!policy) {
      refuse({
        status: "BLOCKED",
        code: "INVALID_INPUT",
        severity: "error",
        reason: `unknown touchpoint '${tp}' in fixture configuration; blocked rather than guessing authority`,
      });
    }
    n += 1;
    const escalation_id = `esc-${c.case_id}-${tp}-${String(n).padStart(2, "0")}`;
    const binding = bindRelay(c, tp, policy, clock, ctx.trustRegistry, task, budget, diagnostics);
    escalation_triggers.push({
      escalation_id,
      touchpoint: tp,
      condition: policy.condition_template.replace("{amount}", String(c.facts?.amount_usd ?? 0)).replace("{case}", c.case_id),
      reason: policy.reason,
      required_authorizer: policy.authorizer,
      executor: policy.executor,
      urgency,
      authorization_evidence_ids: binding.evidence_ids,
      authorization_satisfied: binding.satisfied,
      execution_authorized_for_agent: false,
    });
  }

  // Link recommendations to the triggers covering their touchpoints.
  for (const rec of recommendations) {
    rec.escalation_ids = escalation_triggers
      .filter((t) => rec.touchpoints.includes(t.touchpoint))
      .map((t) => t.escalation_id)
      .sort();
  }

  const grounded = recommendations.filter((r) => r.permission_check.allowed_to_propose);
  const status = grounded.length > 0 ? "PROPOSED" : "BLOCKED";
  return { recommendations, escalation_triggers, contradictions, diagnostics, status, urgency };
}

export { HEX40 };
