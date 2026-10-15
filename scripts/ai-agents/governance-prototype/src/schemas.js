/**
 * schemas.js — strict runtime schemas for the governance prototype.
 *
 * Every control-bearing object rejects unknown properties, absent required
 * fields, wrong types, invalid enum values, duplicate IDs, invalid dates
 * and abbreviated/malformed pins. A malformed request yields a structured
 * REFUSED/INVALID_INPUT denial — never an exception and never a success.
 */

import { HEX40, HEX64, STABLE_ID } from "./canonical.js";

export class SchemaError extends Error {
  constructor(message) {
    super(message);
    this.name = "SchemaError";
  }
}

const ACTION_TYPES = ["read", "propose", "write", "approve", "merge", "deploy", "activate"];
const REQUESTED_ACTIONS = ["classify", "execute_action"];

function isObj(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function fail(msg) {
  throw new SchemaError(msg);
}

function reqStr(o, key, where, max = 256) {
  const v = o[key];
  if (typeof v !== "string" || v.length === 0 || v.length > max) fail(`${where}.${key} must be a non-empty string (<=${max})`);
  return v;
}

function reqId(o, key, where) {
  const v = reqStr(o, key, where, 128);
  if (!STABLE_ID.test(v)) fail(`${where}.${key} is not a stable identifier`);
  return v;
}

/** Reject any property not in the allowed list. */
function noUnknown(o, allowed, where) {
  for (const k of Object.keys(o)) {
    if (!allowed.includes(k)) fail(`${where}: unknown control field '${k}'`);
  }
}

function uniqueStrings(arr, where) {
  const seen = new Set();
  for (const v of arr) {
    if (typeof v !== "string") fail(`${where}: expected string entries`);
    if (seen.has(v)) fail(`${where}: duplicate entry '${v}'`);
    seen.add(v);
  }
  return arr;
}

export function validateSourceRef(sr, where) {
  if (!isObj(sr)) fail(`${where}: SourceRef must be an object`);
  noUnknown(sr, ["repo", "path", "commit", "blob", "algorithm", "revision"], where);
  const repo = reqStr(sr, "repo", where, 200);
  const path = reqStr(sr, "path", where, 500);
  if (
    path.startsWith("/") || path.includes("\\") || path === "" ||
    /(^|\/)\.\.(\/|$)/.test(path) || path.includes("//")
  ) {
    fail(`${where}.path is not a canonical repo-relative allowlisted path`);
  }
  const commit = reqStr(sr, "commit", where, 40);
  const blob = reqStr(sr, "blob", where, 40);
  if (!HEX40.test(commit)) fail(`${where}.commit must be a full lowercase 40-hex Git object ID (no abbreviations)`);
  if (!HEX40.test(blob)) fail(`${where}.blob must be a full lowercase 40-hex Git object ID (no abbreviations)`);
  if (sr.algorithm !== "git-sha1") fail(`${where}.algorithm must be "git-sha1"`);
  const revision = reqStr(sr, "revision", where, 64);
  return { repo, path, commit, blob, algorithm: "git-sha1", revision };
}

export function validateTask(task) {
  if (!isObj(task)) fail("task must be an object");
  noUnknown(task, ["request_id", "requested_action", "actor_ref", "action_type", "target", "payload_context"], "task");
  const request_id = reqId(task, "request_id", "task");
  if (!REQUESTED_ACTIONS.includes(task.requested_action)) {
    fail(`task.requested_action must be one of [${REQUESTED_ACTIONS.join(", ")}]`);
  }
  const requested_action = task.requested_action;
  const actor_ref = reqId(task, "actor_ref", "task");
  if (!ACTION_TYPES.includes(task.action_type)) {
    fail(`task.action_type must be one of [${ACTION_TYPES.join(", ")}]`);
  }
  const action_type = task.action_type;

  if (!isObj(task.target)) fail("task.target must be an object");
  noUnknown(task.target, ["repo", "resource_id", "resource_class", "scope_ids", "head", "source_ref"], "task.target");
  const repo = reqStr(task.target, "repo", "task.target", 200);
  const resource_id = reqId(task.target, "resource_id", "task.target");
  const resource_class = reqId(task.target, "resource_class", "task.target");
  if (!Array.isArray(task.target.scope_ids) || task.target.scope_ids.length === 0) {
    fail("task.target.scope_ids must be a non-empty array of scope identifiers");
  }
  const scope_ids = uniqueStrings(task.target.scope_ids, "task.target.scope_ids");
  for (const s of scope_ids) {
    if (!STABLE_ID.test(s)) fail("task.target.scope_ids entries must be stable identifiers");
  }
  const head = reqStr(task.target, "head", "task.target", 40);
  if (!HEX40.test(head)) fail("task.target.head must be a full lowercase 40-hex head (no abbreviations)");
  const source_ref = validateSourceRef(task.target.source_ref, "task.target.source_ref");

  if (!isObj(task.payload_context)) fail("task.payload_context must be an object");
  noUnknown(task.payload_context, ["evidence_record_ids"], "task.payload_context");
  const ids = task.payload_context.evidence_record_ids;
  if (!Array.isArray(ids)) fail("task.payload_context.evidence_record_ids must be an array");
  const evidence_record_ids = uniqueStrings(ids, "task.payload_context.evidence_record_ids");

  return { request_id, requested_action, actor_ref, action_type, target: { repo, resource_id, resource_class, scope_ids, head, source_ref }, payload_context: { evidence_record_ids } };
}

function validDate(v) {
  if (typeof v !== "number" || !Number.isFinite(v)) return false;
  const d = new Date(v);
  return !Number.isNaN(d.getTime());
}

function validateRecord(r, where, extra) {
  if (!isObj(r)) fail(`${where}: AuthenticatedRecord must be an object`);
  noUnknown(r, ["record_id", "issuer", "subject_ref", "resource", "scope_ids", "action_ids", "valid_from", "expires_at", "revoked", "nonce", "source_ref", ...(extra ?? [])], where);
  const record_id = reqId(r, "record_id", where);
  const issuer = reqId(r, "issuer", where);
  const subject_ref = reqStr(r, "subject_ref", where, 256);
  const resource = reqStr(r, "resource", where, 256);
  if (!Array.isArray(r.scope_ids)) fail(`${where}.scope_ids must be an array`);
  const scope_ids = uniqueStrings(r.scope_ids, `${where}.scope_ids`);
  if (!Array.isArray(r.action_ids)) fail(`${where}.action_ids must be an array`);
  const action_ids = uniqueStrings(r.action_ids, `${where}.action_ids`);
  for (const a of action_ids) {
    if (!ACTION_TYPES.includes(a)) fail(`${where}.action_ids contains unsupported action '${a}'`);
  }
  if (!validDate(r.valid_from)) fail(`${where}.valid_from must be a finite UTC ms timestamp`);
  if (!validDate(r.expires_at)) fail(`${where}.expires_at must be a finite UTC ms timestamp`);
  if (typeof r.revoked !== "boolean") fail(`${where}.revoked must be a boolean`);
  const revoked = r.revoked;
  const nonce = reqStr(r, "nonce", where, 128);
  const source_ref = validateSourceRef(r.source_ref, `${where}.source_ref`);
  const extras = {};
  for (const k of extra ?? []) extras[k] = r[k];
  return { record_id, issuer, subject_ref, resource, scope_ids, action_ids, valid_from: r.valid_from, expires_at: r.expires_at, revoked, nonce, source_ref, ...extras };
}

function validatePolicy(p) {
  const where = `policies[${p?.policy_id ?? "?"}]`;
  if (!isObj(p)) fail(`${where}: policy must be an object`);
  noUnknown(p, ["policy_id", "version", "action_ids", "resource_classes", "scope_ids", "rules", "steward_ref", "source_ref", "policy_sha256", "effective_from", "effective_to", "supersedes", "precedence", "citation_doc", "rule_spans"], where);
  const policy_id = reqId(p, "policy_id", where);
  const version = reqStr(p, "version", where, 32);
  if (!/^[0-9]+$/.test(version)) fail(`${where}.version must be a numeric string`);
  if (!Array.isArray(p.action_ids) || p.action_ids.length === 0) fail(`${where}.action_ids must be a non-empty array`);
  const action_ids = uniqueStrings(p.action_ids, `${where}.action_ids`);
  for (const a of action_ids) {
    if (!ACTION_TYPES.includes(a)) fail(`${where}.action_ids contains unsupported action '${a}'`);
  }
  if (!Array.isArray(p.resource_classes) || p.resource_classes.length === 0) fail(`${where}.resource_classes must be a non-empty array`);
  const resource_classes = uniqueStrings(p.resource_classes, `${where}.resource_classes`);
  if (!Array.isArray(p.scope_ids) || p.scope_ids.length === 0) fail(`${where}.scope_ids must be a non-empty array`);
  const scope_ids = uniqueStrings(p.scope_ids, `${where}.scope_ids`);
  if (!Array.isArray(p.rules) || p.rules.length === 0) fail(`${where}.rules must be a non-empty array`);
  const rule_ids = new Set();
  for (const r of p.rules) {
    if (!isObj(r)) fail(`${where}.rules entries must be objects`);
    noUnknown(r, ["rule_id", "effect", "action_ids", "gates", "condition"], `${where}.rules`);
    const rid = reqId(r, "rule_id", `${where}.rules`);
    if (rule_ids.has(rid)) fail(`${where}.rules: duplicate rule_id '${rid}'`);
    rule_ids.add(rid);
    if (!["allow", "deny", "require-approval"].includes(r.effect)) fail(`${where}.rules rule effect must be allow|deny|require-approval`);
    if (!Array.isArray(r.action_ids)) fail(`${where}.rules action_ids must be an array`);
    const ra = uniqueStrings(r.action_ids, `${where}.rules.action_ids`);
    for (const a of ra) {
      if (!ACTION_TYPES.includes(a)) fail(`${where}.rules contains unsupported action '${a}'`);
    }
    if (!Array.isArray(r.gates)) fail(`${where}.rules gates must be an array`);
    uniqueStrings(r.gates, `${where}.rules.gates`);
    if (r.condition !== null && typeof r.condition !== "string") fail(`${where}.rules condition must be string|null`);
  }
  const steward_ref = reqId(p, "steward_ref", where);
  const source_ref = validateSourceRef(p.source_ref, `${where}.source_ref`);
  if (!HEX64.test(p.policy_sha256 ?? "")) fail(`${where}.policy_sha256 must be 64-hex`);
  if (!validDate(p.effective_from) || !validDate(p.effective_to)) fail(`${where}.effective_from/effective_to must be finite UTC ms timestamps`);
  let supersedes = null;
  if (p.supersedes !== null) {
    if (!isObj(p.supersedes)) fail(`${where}.supersedes must be null or an object`);
    noUnknown(p.supersedes, ["policy_id", "scope_ids"], `${where}.supersedes`);
    supersedes = { policy_id: reqId(p.supersedes, "policy_id", `${where}.supersedes`), scope_ids: uniqueStrings(p.supersedes.scope_ids ?? [], `${where}.supersedes.scope_ids`) };
  }
  if (!Number.isInteger(p.precedence) || p.precedence < 0) fail(`${where}.precedence must be a non-negative integer`);
  const citation_doc = validateSourceRef(p.citation_doc, `${where}.citation_doc`);
  if (!isObj(p.rule_spans)) fail(`${where}.rule_spans must be an object`);
  for (const [rid, sp] of Object.entries(p.rule_spans)) {
    if (!rule_ids.has(rid)) fail(`${where}.rule_spans references unknown rule_id '${rid}'`);
    if (!isObj(sp)) fail(`${where}.rule_spans[${rid}] must be an object`);
    noUnknown(sp, ["start_byte", "end_byte", "quoted_text"], `${where}.rule_spans[${rid}]`);
    if (!Number.isInteger(sp.start_byte) || !Number.isInteger(sp.end_byte) || sp.start_byte < 0 || sp.end_byte <= sp.start_byte) {
      fail(`${where}.rule_spans[${rid}] has invalid byte offsets`);
    }
    if (typeof sp.quoted_text !== "string" || sp.quoted_text.length === 0) fail(`${where}.rule_spans[${rid}].quoted_text must be non-empty`);
  }
  return { policy_id, version, action_ids, resource_classes, scope_ids, rules: p.rules, steward_ref, source_ref, policy_sha256: p.policy_sha256, effective_from: p.effective_from, effective_to: p.effective_to, supersedes, precedence: p.precedence, citation_doc, rule_spans: p.rule_spans };
}

function validateVerdict(v) {
  const where = `verdicts[${v?.verdict_id ?? "?"}]`;
  if (!isObj(v)) fail(`${where}: verdict must be an object`);
  noUnknown(v, ["verdict_id", "reviewer_ref", "designated", "verdict", "repo", "resource_id", "scope_ids", "head", "source_ref", "digest", "valid_from", "expires_at", "revoked", "superseded_by", "order_seq"], where);
  const verdict_id = reqId(v, "verdict_id", where);
  const reviewer_ref = reqId(v, "reviewer_ref", where);
  if (typeof v.designated !== "boolean") fail(`${where}.designated must be boolean`);
  if (!["GO", "NEEDS-CHANGES", "NO-GO"].includes(v.verdict)) fail(`${where}.verdict must be GO|NEEDS-CHANGES|NO-GO`);
  const repo = reqStr(v, "repo", where, 200);
  const resource_id = reqId(v, "resource_id", where);
  const scope_ids = uniqueStrings(v.scope_ids ?? [], `${where}.scope_ids`);
  const head = reqStr(v, "head", where, 40);
  if (!HEX40.test(head)) fail(`${where}.head must be full 40-hex`);
  const source_ref = validateSourceRef(v.source_ref, `${where}.source_ref`);
  if (!HEX64.test(v.digest ?? "")) fail(`${where}.digest must be 64-hex`);
  if (!validDate(v.valid_from) || !validDate(v.expires_at)) fail(`${where}.valid_from/expires_at must be finite UTC ms timestamps`);
  if (typeof v.revoked !== "boolean") fail(`${where}.revoked must be boolean`);
  if (v.superseded_by !== null && typeof v.superseded_by !== "string") fail(`${where}.superseded_by must be null or string`);
  if (!Number.isInteger(v.order_seq) || v.order_seq < 0) fail(`${where}.order_seq must be a non-negative integer`);
  return { verdict_id, reviewer_ref, designated: v.designated, verdict: v.verdict, repo, resource_id, scope_ids, head, source_ref, digest: v.digest, valid_from: v.valid_from, expires_at: v.expires_at, revoked: v.revoked, superseded_by: v.superseded_by, order_seq: v.order_seq };
}

function validateAgreement(a) {
  const where = `agreements[${a?.agreement_id ?? "?"}]`;
  if (!isObj(a)) fail(`${where}: agreement must be an object`);
  noUnknown(a, ["agreement_id", "agent_ref", "verdict_ref", "head", "head_match", "no_conflict_markers", "safe_scope", "sound_reasoning", "valid_from", "expires_at", "revoked", "digest"], where);
  const agreement_id = reqId(a, "agreement_id", where);
  const agent_ref = reqId(a, "agent_ref", where);
  const verdict_ref = reqId(a, "verdict_ref", where);
  const head = reqStr(a, "head", where, 40);
  if (!HEX40.test(head)) fail(`${where}.head must be full 40-hex`);
  for (const k of ["head_match", "no_conflict_markers", "safe_scope", "sound_reasoning"]) {
    if (typeof a[k] !== "boolean") fail(`${where}.${k} must be boolean`);
  }
  if (!validDate(a.valid_from) || !validDate(a.expires_at)) fail(`${where}.valid_from/expires_at must be finite UTC ms timestamps`);
  if (typeof a.revoked !== "boolean") fail(`${where}.revoked must be boolean`);
  if (!HEX64.test(a.digest ?? "")) fail(`${where}.digest must be 64-hex`);
  return { agreement_id, agent_ref, verdict_ref, head, head_match: a.head_match, no_conflict_markers: a.no_conflict_markers, safe_scope: a.safe_scope, sound_reasoning: a.sound_reasoning, valid_from: a.valid_from, expires_at: a.expires_at, revoked: a.revoked, digest: a.digest };
}

function validateRelay(r) {
  const where = `relays[${r?.relay_id ?? "?"}]`;
  if (!isObj(r)) fail(`${where}: relay must be an object`);
  noUnknown(r, ["relay_id", "origin_ref", "relay_ref", "issuer", "valid_from", "expires_at", "revoked", "digest"], where);
  const relay_id = reqId(r, "relay_id", where);
  const origin_ref = reqId(r, "origin_ref", where);
  const relay_ref = reqId(r, "relay_ref", where);
  const issuer = reqId(r, "issuer", where);
  if (!validDate(r.valid_from) || !validDate(r.expires_at)) fail(`${where}.valid_from/expires_at must be finite UTC ms timestamps`);
  if (typeof r.revoked !== "boolean") fail(`${where}.revoked must be boolean`);
  if (!HEX64.test(r.digest ?? "")) fail(`${where}.digest must be 64-hex`);
  return { relay_id, origin_ref, relay_ref, issuer, valid_from: r.valid_from, expires_at: r.expires_at, revoked: r.revoked, digest: r.digest };
}

export function validateContext(context, budget) {
  if (!isObj(context)) fail("context must be an object");
  noUnknown(context, ["clock", "principals", "policies", "registrations", "verdicts", "agreements", "relays", "heads", "readGrants", "blobs", "evidence"], "context");
  if (!Number.isFinite(context.clock)) fail("context.clock must be a finite number (UTC ms)");
  const clock = context.clock;

  if (!Array.isArray(context.principals)) fail("context.principals must be an array");
  const principalIds = new Set();
  const principals = context.principals.map((p) => {
    if (!isObj(p)) fail("principals entries must be objects");
    noUnknown(p, ["principal_id", "role", "display", "channel"], "principals");
    const principal_id = reqId(p, "principal_id", "principals");
    if (principalIds.has(principal_id)) fail(`duplicate principal_id '${principal_id}'`);
    principalIds.add(principal_id);
    const role = reqStr(p, "role", "principals", 64);
    const display = reqStr(p, "display", "principals", 128);
    if (p.channel !== "SIMULATED") fail("principals channel must be \"SIMULATED\"");
    return { principal_id, role, display, channel: "SIMULATED" };
  });

  if (!Array.isArray(context.policies)) fail("context.policies must be an array");
  const policies = context.policies.map(validatePolicy);
  const policyKeys = new Set(policies.map((p) => `${p.policy_id}@${p.version}`));
  if (policyKeys.size !== policies.length) fail("duplicate policy_id@version");

  if (!Array.isArray(context.registrations)) fail("context.registrations must be an array");
  const registrations = context.registrations.map((r) => validateRecord(r, "registrations", ["binding_sha256", "policy_version"]));
  for (const r of registrations) {
    if (!HEX64.test(r.binding_sha256 ?? "")) fail(`registrations[${r.record_id}].binding_sha256 must be 64-hex`);
    if (!/^[0-9]+$/.test(r.policy_version ?? "")) fail(`registrations[${r.record_id}].policy_version must be numeric`);
  }
  const regIds = new Set(registrations.map((r) => r.record_id));
  if (regIds.size !== registrations.length) fail("duplicate registration record_id");

  if (!Array.isArray(context.verdicts)) fail("context.verdicts must be an array");
  const verdicts = context.verdicts.map(validateVerdict);
  const verdictIds = new Set(verdicts.map((v) => v.verdict_id));
  if (verdictIds.size !== verdicts.length) fail("duplicate verdict_id");

  if (!Array.isArray(context.agreements)) fail("context.agreements must be an array");
  const agreements = context.agreements.map(validateAgreement);
  const agreementIds = new Set(agreements.map((a) => a.agreement_id));
  if (agreementIds.size !== agreements.length) fail("duplicate agreement_id");

  if (!Array.isArray(context.relays)) fail("context.relays must be an array");
  const relays = context.relays.map(validateRelay);
  const relayIds = new Set(relays.map((r) => r.relay_id));
  if (relayIds.size !== relays.length) fail("duplicate relay_id");

  if (!Array.isArray(context.heads)) fail("context.heads must be an array");
  const heads = context.heads.map((h) => {
    if (!isObj(h)) fail("heads entries must be objects");
    noUnknown(h, ["repo", "resource_id", "head", "source_ref"], "heads");
    const repo = reqStr(h, "repo", "heads", 200);
    const resource_id = reqId(h, "resource_id", "heads");
    const head = reqStr(h, "head", "heads", 40);
    if (!HEX40.test(head)) fail("heads.head must be full 40-hex");
    const source_ref = validateSourceRef(h.source_ref, "heads.source_ref");
    return { repo, resource_id, head, source_ref };
  });
  const headKeys = new Set(heads.map((h) => `${h.repo}|${h.resource_id}`));
  if (headKeys.size !== heads.length) fail("duplicate head target");

  if (!Array.isArray(context.readGrants)) fail("context.readGrants must be an array");
  const readGrants = context.readGrants.map((g) => {
    if (!isObj(g)) fail("readGrants entries must be objects");
    noUnknown(g, ["repo", "path"], "readGrants");
    return { repo: reqStr(g, "repo", "readGrants", 200), path: reqStr(g, "path", "readGrants", 500) };
  });

  if (!isObj(context.blobs)) fail("context.blobs must be an object");
  const blobs = {};
  for (const [k, b] of Object.entries(context.blobs)) {
    if (!isObj(b) || typeof b.content !== "string") fail(`blobs[${k}] must be {content: string}`);
    noUnknown(b, ["content"], `blobs[${k}]`);
    blobs[k] = { content: b.content };
  }

  if (!isObj(context.evidence)) fail("context.evidence must be an object");
  const evidence = {};
  for (const [k, e] of Object.entries(context.evidence)) {
    if (!isObj(e)) fail(`evidence[${k}] must be an object`);
    noUnknown(e, ["sha256", "bytes", "fixture_kind"], `evidence[${k}]`);
    if (!HEX64.test(e.sha256 ?? "")) fail(`evidence[${k}].sha256 must be 64-hex`);
    if (typeof e.bytes !== "string") fail(`evidence[${k}].bytes must be a string`);
    if (typeof e.fixture_kind !== "string" || !/^[a-z0-9][a-z0-9:_\-.@]{0,127}$/.test(e.fixture_kind)) fail(`evidence[${k}].fixture_kind must be a stable id`);
    evidence[k] = { sha256: e.sha256, bytes: e.bytes, fixture_kind: e.fixture_kind };
  }

  if (budget) budget.countContextObjects({ principals, policies, registrations, verdicts, agreements, relays, heads, blobs: Object.keys(blobs).length, evidence: Object.keys(evidence).length });

  return { clock, principals, policies, registrations, verdicts, agreements, relays, heads, readGrants, blobs, evidence };
}
