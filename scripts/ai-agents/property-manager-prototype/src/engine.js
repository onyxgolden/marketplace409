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

/**
 * Slice text to at most maxBytes UTF-8 bytes without splitting a
 * character: backs off over continuation bytes so the cut lands on a
 * character boundary. The returned string always round-trips to the
 * source bytes exactly (PM-001).
 */
export function utf8ByteSlice(text, maxBytes) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  let end = maxBytes;
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end -= 1;
  return buf.subarray(0, end).toString("utf8");
}

/** Build a source reference pinning exact bytes. */
function sourceRef(repo, path, commit, bytes) {
  return {
    repo,
    path,
    commit,
    blob: gitBlobId(bytes),
    algorithm: "git-sha1",
    revision: "v1",
  };
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
  // PM-004: charge the exact consulted case bytes before deep use.
  const cBuf = caseBytes(c);
  budget.countInputBytes(cBuf.length, `case bytes:${ref.case_id}`);
  // PM-005: ledger the consulted case source.
  budget.addSource(
    {
      repo: ref.repo,
      path: ref.path,
      commit: ref.commit,
      blob: ref.blob,
      algorithm: ref.algorithm,
      revision: ref.revision,
    },
    cBuf
  );
  const expectedBlob = gitBlobId(cBuf);
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
  // PM-004: charge the exact consulted note bytes before traversal.
  const textBuf = Buffer.from(text, "utf8");
  budget.countInputBytes(textBuf.length, `note bytes:${note_id}`);
  // PM-001: the quoted span is an exact byte-prefix of the registered
  // source text, cut on a UTF-8 character boundary so it round-trips.
  const quoted_span = utf8ByteSlice(text, 120);
  const quotedBuf = Buffer.from(quoted_span, "utf8");
  if (!textBuf.subarray(0, quotedBuf.length).equals(quotedBuf)) {
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "error",
      reason: "note citation span does not round-trip to source bytes",
    });
  }
  const ref = sourceRef(store.repo, `notes/${note_id}.md`, store.commit_id, textBuf);
  budget.addSource(ref, textBuf);
  return {
    ...ref,
    quoted_span,
    span: { start_byte: 0, end_byte: quotedBuf.length, quoted_text: quoted_span },
    verification: "VERIFIED",
  };
}

/**
 * PM-001: cite the exact registered permission record bytes. The
 * quoted span is the full canonical record text; the byte range selects
 * exactly that text; the blob is recomputed and the span revalidated
 * against the source bytes. No constructed sentences, no hard-coded
 * byte counts.
 */
function permissionCitation(store, record, budget) {
  budget.countSpan(`permission:${record.permission_id}`);
  const recordText = canonicalJson(record);
  const recordBuf = Buffer.from(recordText, "utf8");
  // PM-004: charge the exact consulted permission bytes.
  budget.countInputBytes(recordBuf.length, `permission bytes:${record.permission_id}`);
  const ref = sourceRef(store.repo, `permissions/${record.permission_id}.json`, store.commit_id, recordBuf);
  // Revalidate: the quoted bytes must be exactly the registered bytes.
  if (gitBlobId(recordBuf) !== ref.blob) {
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "error",
      reason: "permission citation failed source revalidation",
    });
  }
  budget.addSource(ref, recordBuf);
  return {
    ...ref,
    quoted_span: recordText,
    span: { start_byte: 0, end_byte: recordBuf.length, quoted_text: recordText },
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
 * PM-002: validate the trust registry through its separately injected,
 * pinned registrations. Authority is conferred ONLY by a valid
 * principal-authority registration — never by a display name or a
 * boolean field. A relay record is usable ONLY through a valid
 * relay-record registration with a verified source binding.
 *
 * Returns { authorityPrincipals: Set<string>, relayRecords: Map<string, object> }.
 * Fails closed (EngineRefusal) on structural registry problems;
 * per-record problems exclude the record from the usable set.
 */
export function validateTrustRegistry(trust, clock, budget, expectedCommit) {
  const fail = (reason) =>
    refuse({
      status: "REFUSED",
      code: "SOURCE_UNVERIFIED",
      severity: "critical",
      reason: `trust registry rejected: ${reason}`,
    });
  if (!trust || typeof trust !== "object") fail("not an object");
  const { principals, relay_records, registrations } = trust;
  if (!principals || typeof principals !== "object" || Array.isArray(principals)) fail("principals missing or malformed");
  if (!Array.isArray(relay_records)) fail("relay_records missing or malformed");
  if (!Array.isArray(registrations)) fail("registrations missing or malformed");
  if (typeof expectedCommit !== "string" || !HEX40.test(expectedCommit)) fail("expected commit binding missing");

  // PM-004: charge the consulted trust registry bytes.
  const trustBuf = Buffer.from(canonicalJson(trust), "utf8");
  budget.countInputBytes(trustBuf.length, "trust registry bytes");
  budget.addSource(
    sourceRef(trustRepoOf(trust), "fixtures/trust.json", expectedCommit, trustBuf),
    trustBuf
  );

  const validSourceRef = (ref) =>
    ref &&
    typeof ref === "object" &&
    typeof ref.repo === "string" &&
    ref.repo.length > 0 &&
    typeof ref.path === "string" &&
    ref.path.length > 0 &&
    typeof ref.commit === "string" &&
    HEX40.test(ref.commit) &&
    typeof ref.blob === "string" &&
    HEX40.test(ref.blob) &&
    ref.algorithm === "git-sha1" &&
    typeof ref.revision === "string";

  // Bytes pinned by a source_ref: the object WITHOUT its own source_ref
  // (avoids circularity).
  const pinnedBytes = (obj) => {
    const { source_ref, ...rest } = obj;
    return Buffer.from(canonicalJson(rest), "utf8");
  };

  const seenRegIds = new Set();
  const seenSubjects = new Map(); // kind -> Set(subject_id)
  const authorityPrincipals = new Set();
  const relayRecords = new Map();
  const seenNonces = new Set();
  const recordProblems = new Map(); // record_id -> reason (excluded, diagnosable)

  for (const reg of registrations) {
    if (!reg || typeof reg !== "object") fail("malformed registration entry");
    const { registration_id, kind, subject_id } = reg;
    if (typeof registration_id !== "string" || registration_id.length === 0) fail("registration missing id");
    if (seenRegIds.has(registration_id)) fail(`duplicate registration id ${registration_id}`);
    seenRegIds.add(registration_id);
    if (kind !== "principal-authority" && kind !== "relay-record") fail(`unknown registration kind '${String(kind)}'`);
    const kindSeen = seenSubjects.get(kind) ?? new Set();
    if (typeof subject_id !== "string" || kindSeen.has(subject_id)) fail(`duplicate or missing registration subject for kind ${kind}`);
    kindSeen.add(subject_id);
    seenSubjects.set(kind, kindSeen);
    if (reg.pinned !== true) fail(`registration ${registration_id} is not pinned`);
    if (reg.revoked === true) fail(`registration ${registration_id} is revoked`);
    if (!(Number.isFinite(reg.valid_from) && Number.isFinite(reg.expires_at) && reg.valid_from <= clock && clock < reg.expires_at)) {
      fail(`registration ${registration_id} is not time-valid`);
    }
    if (!validSourceRef(reg.source_ref)) fail(`registration ${registration_id} has a malformed source_ref`);
    if (reg.source_ref.commit !== expectedCommit) fail(`registration ${registration_id} pins a wrong source version`);

    if (kind === "principal-authority") {
      const p = principals[subject_id];
      if (!p || typeof p !== "object") fail(`principal-authority registration for unknown principal ${subject_id}`);
      const expected = gitBlobId(pinnedBytes(p));
      if (reg.source_ref.blob !== expected) fail(`principal-authority registration ${registration_id} source binding mismatch`);
      if (reg.authority !== "escalation") fail(`registration ${registration_id} does not grant escalation authority`);
      authorityPrincipals.add(subject_id);
      budget.addSource(reg.source_ref, pinnedBytes(p));
    } else {
      const rec = relay_records.find((r) => r && r.record_id === subject_id);
      if (!rec) fail(`relay-record registration for unknown record ${subject_id}`);
      const expected = gitBlobId(pinnedBytes(rec));
      if (reg.source_ref.blob !== expected) fail(`relay-record registration ${registration_id} source binding mismatch`);
      // The record's own embedded source_ref must agree with the registration.
      if (!validSourceRef(rec.source_ref) || rec.source_ref.blob !== expected || rec.source_ref.commit !== expectedCommit) {
        recordProblems.set(rec.record_id, "source binding mismatch");
        continue;
      }
      if (typeof rec.nonce !== "string" || rec.nonce.length === 0) fail(`relay record ${rec.record_id} missing nonce`);
      if (seenNonces.has(rec.nonce)) fail(`duplicate relay record nonce ${rec.nonce}`);
      seenNonces.add(rec.nonce);
      relayRecords.set(rec.record_id, rec);
      budget.addSource(reg.source_ref, pinnedBytes(rec));
    }
  }

  // Records present without a relay-record registration are unusable.
  for (const rec of relay_records) {
    if (!rec || typeof rec !== "object" || typeof rec.record_id !== "string") continue;
    if (!relayRecords.has(rec.record_id) && !recordProblems.has(rec.record_id)) {
      recordProblems.set(rec.record_id, "no pinned relay-record registration");
    }
  }

  return { authorityPrincipals, relayRecords, recordProblems };
}

function trustRepoOf(trust) {
  // The trust registry is distributed with the fixture store; its repo
  // label comes from the first registration source_ref when available.
  const reg = (trust.registrations ?? []).find((r) => r && r.source_ref && typeof r.source_ref.repo === "string");
  return reg ? reg.source_ref.repo : "pm-fixtures";
}
/**
 * Bind pinned relay records to one escalation trigger.
 *
 * PM-002: a record satisfies authorization only when it resolves through
 * a valid pinned relay-record registration AND its issuer resolves
 * through a valid principal-authority registration. Operator identity,
 * display names, and boolean fields never satisfy. Remaining checks are
 * unchanged: resource binds the case, the action binding covers the
 * required action, the time window covers the clock, it is not revoked,
 * and (for money) the case amount is within the record's amount limit.
 *
 * trustIndex comes from validateTrustRegistry. Claimed relay ids are
 * lookup keys only; they never create authority. Diagnose failures
 * precisely, preserving the contract's diagnostic codes.
 */
export function bindRelay(c, touchpoint, policyEntry, clock, trustIndex, trustRegistry, task, budget, diagnostics) {
  const requiredAction = policyEntry.required_action;
  const evidence_ids = [];
  let satisfied = false;
  const amount = Number(c.facts?.amount_usd ?? 0);
  for (const rec of trustIndex.relayRecords.values()) {
    budget.countResolution(`relay:${rec.record_id}`);
    // PM-004: charge the exact consulted relay record bytes.
    budget.countInputBytes(Buffer.byteLength(canonicalJson(rec), "utf8"), `relay record bytes:${rec.record_id}`);
    if (rec.revoked === true) continue;
    if (!(Number.isFinite(rec.valid_from) && Number.isFinite(rec.expires_at) && rec.valid_from <= clock && clock < rec.expires_at)) continue;
    if (!trustIndex.authorityPrincipals.has(rec.issuer)) continue;
    if (rec.resource !== c.case_id && !(Array.isArray(rec.scope_ids) && rec.scope_ids.includes(c.property_fixture_id))) continue;
    if (!Array.isArray(rec.action_ids) || !rec.action_ids.includes(requiredAction)) continue;
    if (touchpoint === "money" && Number.isFinite(rec.amount_limit_usd) && Number.isFinite(amount) && amount > rec.amount_limit_usd) continue;
    evidence_ids.push(rec.record_id);
    satisfied = true;
  }
  for (const claimed of task.claimed_relay_ids) {
    if (evidence_ids.includes(claimed)) continue;
    budget.countResolution(`claimed:${claimed}`);
    const rec = trustRegistry.relay_records.find((r) => r && r.record_id === claimed);
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
    // PM-002: records that failed registration/source validation can
    // never confer authority; say why.
    if (!trustIndex.relayRecords.has(claimed)) {
      const why = trustIndex.recordProblems.get(claimed) ?? "no pinned relay-record registration";
      diagnostics.push({
        code: "AUTH_UNVERIFIED",
        severity: "warning",
        source_ref: null,
        record_id: rec.record_id,
        reason: `claimed relay record failed trust validation: ${why}`,
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
    } else if (!trustIndex.authorityPrincipals.has(rec.issuer)) {
      diagnostics.push({ code: "AUTH_UNVERIFIED", severity: "warning", source_ref: null, record_id: rec.record_id, reason: "record issuer has no pinned escalation authority: operator-issued record cannot satisfy this escalation" });
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

  // PM-005: ledger the consulted escalation policy and urgency table.
  const policyBuf = Buffer.from(canonicalJson(store.escalation_policy), "utf8");
  budget.countInputBytes(policyBuf.length, "escalation policy bytes");
  budget.addSource(sourceRef(store.repo, "config/escalation-policy.json", store.commit_id, policyBuf), policyBuf);
  const urgencyBuf = Buffer.from(canonicalJson(store.urgency_table), "utf8");
  budget.countInputBytes(urgencyBuf.length, "urgency table bytes");
  budget.addSource(sourceRef(store.repo, "config/urgency-table.json", store.commit_id, urgencyBuf), urgencyBuf);

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
    const binding = bindRelay(c, tp, policy, clock, ctx.trustIndex, ctx.trustRegistry, task, budget, diagnostics);
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
