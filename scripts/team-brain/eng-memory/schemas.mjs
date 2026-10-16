// Team Brain eng-memory slice 1 — closed schemas and host-config validation.
// Pure, no I/O, no network, no model calls.
//
// The capture input schema is CLOSED: engineering task ID, approved
// repository identity, repo-relative engineering artifact path, exact
// commit/blob pin (algorithm + identity), submitting principal reference,
// event time, event kind and status enums, and typed attribution. There is
// no free-text field, no tool-payload field, no body field. Unknown fields
// are rejected by admission before schema validation runs.
//
// Identity-bearing fields are REGISTRY-BOUND, not free text: taskId must
// be a host-registered engineering task, source must match a host source
// registration (exact repo/path tuple, optional commit and pin binding),
// principal must be host-registered, and the attribution's
// (authorityRef, principal, actor) triple must match a bounded host
// authority registration tying the principal/actor to permitted actions,
// task/source scope, and a validity window. Retention reasons are
// normalized safe codes, never arbitrary text.
//
// Diagnostics carry reason codes and safe IDs only — never rejected values.

import { ENG_CODES, fail } from "./errors.mjs";
import { keySpecs } from "./admission.mjs";
import { assertUtcIso, utcIsoToMs } from "../ledger/validation.mjs";

export const EVENT_KINDS = ["FILED", "PROGRESS", "BLOCKED", "COMPLETED", "VERDICT", "SUPERSEDED", "REVOKED"];
export const EVENT_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETE", "REVOKED", "SUPERSEDED"];

export const PIN_ALGOS = {
  "git-blob-sha1": /^[0-9a-f]{40}$/,
  sha256: /^[0-9a-f]{64}$/,
};

const COMMIT_SHA_RE = /^[0-9a-f]{40}$/;
const REASON_CODE_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const EVENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

// Closed key schemas for descriptor-based admission.
export const EVENT_KEY_SPECS = keySpecs({
  eventId: null,
  taskId: null,
  source: { repo: null, path: null, commit: null, pin: { algo: null, id: null } },
  principal: null,
  eventAt: null,
  kind: null,
  status: null,
  attribution: { actor: null, authorityRef: null },
});

export const QUERY_KEY_SPECS = keySpecs({
  taskId: null,
  sourceRepo: null,
  sourcePath: null,
  kind: null,
  since: null,
  until: null,
});

export const DENIAL_KEY_SPECS = keySpecs({
  repo: null,
  path: null,
  reason: null,
  attribution: { actor: null, authorityRef: null },
  revokedAt: null,
});

// Key-name fragments that are forbidden in capture inputs. Matching is on
// KEY NAMES only, case-insensitive substring. Forbidden VALUES are supplied
// by the host (canary tokens); the adapter never invents the list.
const FORBIDDEN_KEY_FRAGMENTS = [
  "tenant",
  "ledger",
  "financ",
  "payment",
  "schedul",
  "transcript",
  "cookie",
  "authoriz",
  "bearer",
  "token",
  "secret",
  "passwd",
  "vault",
  "ssn",
  "api_key",
  "apikey",
  "screenshot",
  "image_bytes",
  "card_",
  "bank_",
  "iban",
];

export function assertIdString(value, field) {
  if (typeof value !== "string" || value.trim() === "" || value.length > 128) {
    fail(ENG_CODES.INVALID_FIELD, `${field} must be a non-empty string (<=128 chars)`, { field });
  }
  return value;
}

/** Caller-chosen opaque event identifier: strict syntax, never free text. */
export function assertEventId(value, field = "$.eventId") {
  assertIdString(value, field);
  if (!EVENT_ID_RE.test(value)) {
    fail(ENG_CODES.INVALID_EVENT_ID, `${field} must match [A-Za-z0-9][A-Za-z0-9._-]{0,127}`, { field });
  }
  return value;
}

/** Retention reason: a normalized safe code, never arbitrary prose. */
export function assertReasonCode(value, field = "$.reason") {
  if (typeof value !== "string" || !REASON_CODE_RE.test(value)) {
    fail(ENG_CODES.INVALID_REASON, `${field} must be a normalized reason code [A-Za-z0-9][A-Za-z0-9_-]{0,63}`, {
      field,
    });
  }
  return value;
}

/** Exact commit identity when present; undefined stays undefined. */
export function assertCommitSha(value, field = "$.source.commit") {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !COMMIT_SHA_RE.test(value)) {
    fail(ENG_CODES.INVALID_FIELD, `${field} must be a 40-hex commit SHA when present`, { field });
  }
  return value;
}

export function assertPin(pin, path = "$.source.pin") {
  if (!pin || typeof pin !== "object") {
    fail(ENG_CODES.INVALID_PIN, `Pin must be an object at ${path}`, { path });
  }
  const { algo, id } = pin;
  const re = PIN_ALGOS[algo];
  if (!re) {
    fail(ENG_CODES.INVALID_PIN, `Unknown pin algorithm at ${path}`, { path });
  }
  if (typeof id !== "string" || !re.test(id)) {
    fail(ENG_CODES.INVALID_PIN, `Pin identity does not match ${algo} at ${path}`, { path });
  }
  return { algo, id };
}

export function assertAttribution(attribution, host, path = "$.attribution") {
  if (!attribution || typeof attribution !== "object") {
    fail(ENG_CODES.MISSING_ATTRIBUTION, `Attribution is required at ${path}`, { path });
  }
  assertIdString(attribution.actor, `${path}.actor`);
  assertIdString(attribution.authorityRef, `${path}.authorityRef`);
  // Typed provenance: the authorityRef must be host-registered. A
  // self-issued authorityRef never clears this gate — source content
  // integrity does not authenticate the submitter. Full principal/actor/
  // scope binding happens in authorizeAuthority, after the forbidden scan.
  if (!host.registeredAuthorities.has(attribution.authorityRef)) {
    fail(ENG_CODES.FORGED_AUTHORITY, `Authority not registered by host at ${path}`, { path });
  }
  return { actor: attribution.actor, authorityRef: attribution.authorityRef };
}

function assertExactPath(p, field) {
  if (typeof p !== "string" || /[*?[\]{}]/.test(p)) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "Approved paths must be exact literals, never globs", { field });
  }
  if (p.startsWith("/") || p.includes("..")) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "Approved paths must be repo-relative without traversal", { field });
  }
  return p;
}

function assertNonEmptyStringSet(value, field) {
  if (!(value instanceof Set) || value.size === 0) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `Host config needs a non-empty Set: ${field}`, { field });
  }
  return value;
}

function validateSourceRegistration(reg, i, budget) {
  const where = `sourceRegistrations[${i}]`;
  if (!reg || typeof reg !== "object") {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `Source registration must be an object at ${where}`, { field: where });
  }
  assertIdString(reg.repo, `${where}.repo`);
  assertExactPath(reg.path, `${where}.path`);
  if (reg.commit !== undefined) assertCommitSha(reg.commit, `${where}.commit`);
  if (reg.pinAlgo !== undefined && !PIN_ALGOS[reg.pinAlgo]) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `Unknown pinAlgo at ${where}`, { field: `${where}.pinAlgo` });
  }
  if (reg.pinId !== undefined) {
    if (reg.pinAlgo !== undefined) {
      if (typeof reg.pinId !== "string" || !PIN_ALGOS[reg.pinAlgo].test(reg.pinId)) {
        fail(ENG_CODES.INVALID_HOST_CONFIG, `pinId does not match pinAlgo at ${where}`, {
          field: `${where}.pinId`,
        });
      }
    } else {
      assertIdString(reg.pinId, `${where}.pinId`);
    }
  }
  return reg;
}

function validateAuthorityRegistration(reg, i) {
  const where = `authorityRegistrations[${i}]`;
  if (!reg || typeof reg !== "object") {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `Authority registration must be an object at ${where}`, { field: where });
  }
  assertIdString(reg.authorityRef, `${where}.authorityRef`);
  assertIdString(reg.principal, `${where}.principal`);
  assertIdString(reg.actor, `${where}.actor`);
  if (!Array.isArray(reg.actions) || reg.actions.length === 0 || !reg.actions.every((a) => typeof a === "string")) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `actions must be a non-empty string array at ${where}`, {
      field: `${where}.actions`,
    });
  }
  const tasksOk = reg.tasks === "any" || (Array.isArray(reg.tasks) && reg.tasks.every((t) => typeof t === "string"));
  if (!tasksOk) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `tasks must be "any" or a string array at ${where}`, {
      field: `${where}.tasks`,
    });
  }
  const sourcesOk =
    reg.sources === "any" ||
    (Array.isArray(reg.sources) &&
      reg.sources.every((s) => s && typeof s.repo === "string" && typeof s.path === "string"));
  if (!sourcesOk) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `sources must be "any" or a {repo,path} array at ${where}`, {
      field: `${where}.sources`,
    });
  }
  for (const f of ["notBeforeMs", "notAfterMs"]) {
    if (reg[f] !== undefined && !Number.isFinite(reg[f])) {
      fail(ENG_CODES.INVALID_HOST_CONFIG, `${f} must be a finite epoch-ms number at ${where}`, { field: `${where}.${f}` });
    }
  }
  if (reg.revoked !== undefined && typeof reg.revoked !== "boolean") {
    fail(ENG_CODES.INVALID_HOST_CONFIG, `revoked must be a boolean at ${where}`, { field: `${where}.revoked` });
  }
  return reg;
}

/**
 * Validate the host configuration. The host is the trust root: approved
 * repos, approved engineering paths, registered principals, registered
 * authorities, registered engineering tasks, exact source registrations,
 * bounded authority registrations, denied sources, and prohibited value
 * canaries. Path allowlisting alone is insufficient — typed provenance
 * (attribution) is also required — but the allowlist itself must be exact:
 * wildcards and globs are rejected so a "broadened allowlist" mutation
 * cannot silently widen capture.
 *
 * Registration collections are consulted under the given budget
 * (charge-before-inspect); pass no budget to skip charging.
 */
export function assertHostConfig(host, budget) {
  if (!host || typeof host !== "object") {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "Host config must be an object");
  }
  const need = ["approvedRepos", "approvedPaths", "registeredPrincipals", "registeredAuthorities"];
  for (const k of need) {
    assertNonEmptyStringSet(host[k], k);
  }
  for (const p of host.approvedPaths) {
    assertExactPath(p, "approvedPaths");
  }
  // Registered engineering tasks: taskId is registry-bound, never free text.
  // One charge for the set as a whole; entries are host-owned strings and
  // lookups are O(1).
  assertNonEmptyStringSet(host.registeredTasks, "registeredTasks");
  for (const t of host.registeredTasks) {
    if (typeof t !== "string" || t.trim() === "") {
      fail(ENG_CODES.INVALID_HOST_CONFIG, "registeredTasks must contain non-empty strings", {
        field: "registeredTasks",
      });
    }
  }
  if (budget) budget.charge(1, "host.registeredTasks");
  // Exact source registrations: approved (repo,path) tuples with optional
  // commit and pin bindings. A Cartesian product of independent repo/path
  // sets is NOT accepted — only registered tuples.
  if (!Array.isArray(host.sourceRegistrations) || host.sourceRegistrations.length === 0) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "Host config needs a non-empty array: sourceRegistrations", {
      field: "sourceRegistrations",
    });
  }
  host.sourceRegistrations.forEach((reg, i) => {
    if (budget) budget.charge(1, `host.sourceRegistrations[${i}]`);
    validateSourceRegistration(reg, i, budget);
  });
  // Bounded authority registrations: principal/actor bound to permitted
  // actions, task/source scope, validity window, and revocation state.
  if (!Array.isArray(host.authorityRegistrations) || host.authorityRegistrations.length === 0) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "Host config needs a non-empty array: authorityRegistrations", {
      field: "authorityRegistrations",
    });
  }
  host.authorityRegistrations.forEach((reg, i) => {
    if (budget) budget.charge(1, `host.authorityRegistrations[${i}]`);
    validateAuthorityRegistration(reg, i);
  });
  if (host.deniedSources !== undefined && !(host.deniedSources instanceof Set)) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "deniedSources must be a Set", { field: "deniedSources" });
  }
  if (host.revokedSources !== undefined && !(host.revokedSources instanceof Set)) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "revokedSources must be a Set", { field: "revokedSources" });
  }
  if (host.prohibitedValues !== undefined && !Array.isArray(host.prohibitedValues)) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "prohibitedValues must be an array", { field: "prohibitedValues" });
  }
  return host;
}

/**
 * Full closed-schema validation of an admitted event snapshot.
 *
 * Order (frozen for battery compatibility): admission errors first, then
 * byte budget, then structural schema (types/enums/pin/timestamps/
 * attribution-present), then caller binding, then the forbidden scan, then
 * host registration checks (authorizeEvent). The canary scan therefore
 * always precedes UNREGISTERED_TASK / AUTHORITY_* / UNAPPROVED_* codes.
 */
export function validateEventSnapshot(snap, host, ctx = {}) {
  assertEventId(snap.eventId, "$.eventId");
  assertIdString(snap.taskId, "$.taskId");
  if (!snap.source || typeof snap.source !== "object") {
    fail(ENG_CODES.INVALID_FIELD, "source is required", { field: "$.source" });
  }
  assertIdString(snap.source.repo, "$.source.repo");
  assertIdString(snap.source.path, "$.source.path");
  const commit = assertCommitSha(snap.source.commit, "$.source.commit");
  const pin = assertPin(snap.source.pin);
  assertIdString(snap.principal, "$.principal");
  assertUtcIso(snap.eventAt, "$.eventAt");
  const eventAtMs = utcIsoToMs(snap.eventAt, "$.eventAt");
  if (!EVENT_KINDS.includes(snap.kind)) {
    fail(ENG_CODES.INVALID_KIND, "kind must be a known event kind", { field: "$.kind" });
  }
  if (!EVENT_STATUSES.includes(snap.status)) {
    fail(ENG_CODES.INVALID_STATUS, "status must be a known event status", { field: "$.status" });
  }
  const attribution = assertAttribution(snap.attribution, host);
  // Caller binding: the separately injected authenticated caller identity
  // must equal the claimed principal. Knowing a registered principal string
  // is not the same as being that principal.
  if (ctx.caller === undefined) {
    fail(ENG_CODES.MISSING_CALLER, "Capture requires a separately injected caller identity", {});
  }
  if (ctx.caller !== snap.principal) {
    fail(ENG_CODES.CALLER_PRINCIPAL_MISMATCH, "Caller identity does not match the claimed principal", {
      field: "$.principal",
    });
  }
  return {
    eventId: snap.eventId,
    taskId: snap.taskId,
    source: { repo: snap.source.repo, path: snap.source.path, ...(commit !== undefined ? { commit } : {}), pin },
    principal: snap.principal,
    eventAt: snap.eventAt,
    eventAtMs,
    kind: snap.kind,
    status: snap.status,
    attribution,
  };
}

/**
 * Forbidden-data scan over an admitted snapshot. Key names are checked
 * against the fragment denylist; string values are checked against the
 * host's prohibited-value canaries. Refusal carries reason codes and field
 * paths only — the rejected value is never echoed. We never redact-and-
 * keep: any hit refuses the whole capture.
 *
 * Canary consultation is budgeted: each host canary is charged BEFORE its
 * value is read, descriptor-safely (a throwing getter on the canary list
 * dies on the charge or on INVALID_HOST_CONFIG with zero invocations).
 */
export function scanForbidden(snap, host, budget, path = "$") {
  const strings = [];
  const walkKeys = (node, p) => {
    if (node === null || typeof node !== "object") {
      if (typeof node === "string") strings.push({ value: node, path: p });
      return;
    }
    // The snapshot is admitted primitive-only: no accessors can remain,
    // so Object.keys + index reads are descriptor-safe here.
    for (const key of Object.keys(node)) {
      const lowered = key.toLowerCase();
      for (const frag of FORBIDDEN_KEY_FRAGMENTS) {
        if (lowered.includes(frag)) {
          fail(ENG_CODES.PROHIBITED_DATA, `Forbidden key fragment at ${p}.${key}`, { path: `${p}.${key}` });
        }
      }
      walkKeys(node[key], `${p}.${key}`);
    }
  };
  walkKeys(snap, path);

  const canaries = host.prohibitedValues || [];
  for (let i = 0; i < canaries.length; i += 1) {
    // Charge BEFORE reading the canary: the 65th canary never gets read.
    if (budget) budget.charge(1, `host.prohibitedValues[${i}]`);
    // Descriptor-safe read: only typeof desc.value, never a property read.
    // An accessor on the host canary list is a hostile host config.
    // (Reading .value on an accessor descriptor never invokes get/set;
    // the check below runs first for clarity.)
    const desc = Object.getOwnPropertyDescriptor(canaries, String(i));
    if (desc && (typeof desc.get === "function" || typeof desc.set === "function")) {
      fail(ENG_CODES.INVALID_HOST_CONFIG, "Host prohibitedValues must be data, never accessors", {
        field: `prohibitedValues[${i}]`,
      });
    }
    const raw = desc ? desc.value : undefined;
    if (typeof raw !== "string" || raw === "") continue;
    for (const s of strings) {
      if (s.value.includes(raw)) {
        fail(ENG_CODES.PROHIBITED_DATA, `Prohibited value detected at ${s.path}`, { path: s.path });
      }
    }
  }
}

function actionsMatch(actions, action) {
  return actions.includes("*") || actions.includes(action);
}

function taskInScope(reg, taskId) {
  if (taskId === undefined) return true;
  return reg.tasks === "any" || (Array.isArray(reg.tasks) && reg.tasks.includes(taskId));
}

function sourceInScope(reg, source) {
  if (source === undefined) return true;
  if (reg.sources === "any") return true;
  return (
    Array.isArray(reg.sources) && reg.sources.some((s) => s.repo === source.repo && s.path === source.path)
  );
}

function authoritiesFor(host, authorityRef) {
  return host.authorityRegistrations.filter((r) => r.authorityRef === authorityRef);
}

/**
 * Shared authority authorization for capture AND denial/revocation.
 * Binds (authorityRef, principal, actor) to a host authority registration
 * and enforces its action allowlist, task/source scope, validity window,
 * and revocation state. A content hash cannot authenticate the submitter;
 * only this registration — injected by the host, never derived from the
 * request — can.
 *
 * Lookup is staged: unknown authorityRef -> FORGED_AUTHORITY; known
 * authorityRef but unbound principal -> AUTHORITY_PRINCIPAL_MISMATCH;
 * bound (authorityRef, principal) but unbound actor ->
 * AUTHORITY_ACTOR_MISMATCH.
 */
export function authorizeAuthority(host, { authorityRef, principal, actor, action, taskId, source }, ctx = {}) {
  const candidates = authoritiesFor(host, authorityRef);
  if (candidates.length === 0) {
    fail(ENG_CODES.FORGED_AUTHORITY, "Authority not registered by host", {});
  }
  const reg = candidates.find((r) => r.principal === principal);
  if (!reg) {
    fail(ENG_CODES.AUTHORITY_PRINCIPAL_MISMATCH, "Authority registration is not bound to this principal", {});
  }
  if (reg.actor !== actor) {
    fail(ENG_CODES.AUTHORITY_ACTOR_MISMATCH, "Authority registration is not bound to this actor", {});
  }
  if (reg.revoked === true) {
    fail(ENG_CODES.AUTHORITY_REVOKED, "Authority registration has been revoked", {});
  }
  const nowMs = ctx.nowMs !== undefined ? ctx.nowMs : Date.now();
  if ((reg.notBeforeMs !== undefined && nowMs < reg.notBeforeMs) || (reg.notAfterMs !== undefined && nowMs > reg.notAfterMs)) {
    fail(ENG_CODES.AUTHORITY_EXPIRED, "Authority registration is outside its validity window", {});
  }
  if (!actionsMatch(reg.actions, action)) {
    fail(ENG_CODES.AUTHORITY_ACTION_DENIED, "Authority registration does not permit this action", {});
  }
  if (!taskInScope(reg, taskId) || !sourceInScope(reg, source)) {
    fail(ENG_CODES.AUTHORITY_SCOPE_DENIED, "Authority registration scope does not cover this task/source", {});
  }
  return reg;
}

/**
 * Host registration checks for a validated event. Runs AFTER the
 * forbidden scan so PROHIBITED_DATA keeps its frozen precedence.
 * Order: principal -> source tuple -> task -> authority binding.
 */
export function authorizeEvent(ev, host, ctx = {}) {
  const budget = ctx.budget;
  if (budget) budget.charge(1, "authorizeEvent.principal");
  if (!host.registeredPrincipals.has(ev.principal)) {
    fail(ENG_CODES.UNKNOWN_PRINCIPAL, "Principal is not host-registered", { field: "$.principal" });
  }

  // Exact source tuple: repo AND path must be registered TOGETHER, with
  // optional commit/pin bindings. Independent repo/path sets never combine.
  let repoHit = false;
  let pairHit = false;
  let pairReg = null;
  let fullMatch = null;
  for (const reg of host.sourceRegistrations) {
    if (budget) budget.charge(1, "authorizeEvent.sourceRegistrations");
    if (reg.repo !== ev.source.repo) continue;
    repoHit = true;
    if (reg.path !== ev.source.path) continue;
    pairHit = true;
    if (!pairReg) pairReg = reg;
    if (reg.commit !== undefined && ev.source.commit !== reg.commit) continue;
    if (reg.pinAlgo !== undefined && ev.source.pin.algo !== reg.pinAlgo) continue;
    if (reg.pinId !== undefined && ev.source.pin.id !== reg.pinId) continue;
    fullMatch = reg;
    break;
  }
  if (!repoHit) {
    fail(ENG_CODES.UNAPPROVED_REPO, "Repository is not host-approved", { field: "$.source.repo" });
  }
  if (!pairHit) {
    fail(ENG_CODES.UNAPPROVED_PATH, "Path is not host-approved for this repository", { field: "$.source.path" });
  }
  if (!fullMatch) {
    // The (repo,path) tuple is registered but a commit/pin binding failed.
    if (pairReg.commit !== undefined && ev.source.commit !== pairReg.commit) {
      fail(ENG_CODES.SOURCE_COMMIT_MISMATCH, "Source commit does not match the registered binding", {
        field: "$.source.commit",
      });
    }
    fail(ENG_CODES.SOURCE_PIN_MISMATCH, "Source pin does not match the registered binding", {
      field: "$.source.pin",
    });
  }

  if (budget) budget.charge(1, "authorizeEvent.task");
  if (!host.registeredTasks.has(ev.taskId)) {
    fail(ENG_CODES.UNREGISTERED_TASK, "Task is not a host-registered engineering task", { field: "$.taskId" });
  }

  if (budget) budget.charge(1, "authorizeEvent.authority");
  authorizeAuthority(
    host,
    {
      authorityRef: ev.attribution.authorityRef,
      principal: ev.principal,
      actor: ev.attribution.actor,
      action: ev.kind,
      taskId: ev.taskId,
      source: { repo: ev.source.repo, path: ev.source.path },
    },
    ctx,
  );
  return true;
}

/** Validate an admitted recall query snapshot. Timestamps become epoch-ms integers. */
export function validateQuerySnapshot(snap) {
  const out = {};
  if (snap.taskId !== undefined) out.taskId = assertIdString(snap.taskId, "$.taskId");
  if (snap.sourceRepo !== undefined) out.sourceRepo = assertIdString(snap.sourceRepo, "$.sourceRepo");
  if (snap.sourcePath !== undefined) out.sourcePath = assertIdString(snap.sourcePath, "$.sourcePath");
  if (snap.kind !== undefined) {
    if (!EVENT_KINDS.includes(snap.kind)) {
      fail(ENG_CODES.INVALID_QUERY, "kind must be a known event kind", { field: "$.kind" });
    }
    out.kind = snap.kind;
  }
  if (snap.since !== undefined) {
    assertUtcIso(snap.since, "$.since");
    out.since = snap.since;
    out.sinceMs = utcIsoToMs(snap.since, "$.since");
  }
  if (snap.until !== undefined) {
    assertUtcIso(snap.until, "$.until");
    out.until = snap.until;
    out.untilMs = utcIsoToMs(snap.until, "$.until");
  }
  if (out.sinceMs !== undefined && out.untilMs !== undefined && out.sinceMs > out.untilMs) {
    fail(ENG_CODES.INVALID_QUERY, "Recall query since must not be after until", { field: "$.since" });
  }
  if (Object.keys(out).length === 0) {
    fail(ENG_CODES.INVALID_QUERY, "Recall query needs at least one cue", {});
  }
  return out;
}
