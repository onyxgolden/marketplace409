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
// Diagnostics carry reason codes and safe IDs only — never rejected values.

import { ENG_CODES, fail } from "./errors.mjs";
import { keySpecs } from "./admission.mjs";
import { assertUtcIso } from "../ledger/validation.mjs";

export const EVENT_KINDS = ["FILED", "PROGRESS", "BLOCKED", "COMPLETED", "VERDICT", "SUPERSEDED", "REVOKED"];
export const EVENT_STATUSES = ["OPEN", "IN_PROGRESS", "BLOCKED", "COMPLETE", "REVOKED", "SUPERSEDED"];

export const PIN_ALGOS = {
  "git-blob-sha1": /^[0-9a-f]{40}$/,
  sha256: /^[0-9a-f]{64}$/,
};

// Closed key schemas for descriptor-based admission.
export const EVENT_KEY_SPECS = keySpecs({
  eventId: null,
  taskId: null,
  source: { repo: null, path: null, pin: { algo: null, id: null } },
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
  // integrity does not authenticate the submitter.
  if (!host.registeredAuthorities.has(attribution.authorityRef)) {
    fail(ENG_CODES.FORGED_AUTHORITY, `Authority not registered by host at ${path}`, { path });
  }
  return { actor: attribution.actor, authorityRef: attribution.authorityRef };
}

/**
 * Validate the host configuration. The host is the trust root: approved
 * repos, approved engineering paths, registered principals, registered
 * authorities, denied sources, and prohibited value canaries. Path
 * allowlisting alone is insufficient — typed provenance (attribution) is
 * also required — but the allowlist itself must be exact: wildcards and
 * globs are rejected so a "broadened allowlist" mutation cannot silently
 * widen capture.
 */
export function assertHostConfig(host) {
  if (!host || typeof host !== "object") {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "Host config must be an object");
  }
  const need = ["approvedRepos", "approvedPaths", "registeredPrincipals", "registeredAuthorities"];
  for (const k of need) {
    if (!(host[k] instanceof Set) || host[k].size === 0) {
      fail(ENG_CODES.INVALID_HOST_CONFIG, `Host config needs a non-empty Set: ${k}`, { field: k });
    }
  }
  for (const p of host.approvedPaths) {
    if (typeof p !== "string" || /[*?[\]{}]/.test(p)) {
      fail(ENG_CODES.INVALID_HOST_CONFIG, "Approved paths must be exact literals, never globs", { field: "approvedPaths" });
    }
    if (p.startsWith("/") || p.includes("..")) {
      fail(ENG_CODES.INVALID_HOST_CONFIG, "Approved paths must be repo-relative without traversal", {
        field: "approvedPaths",
      });
    }
  }
  if (host.deniedSources !== undefined && !(host.deniedSources instanceof Set)) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "deniedSources must be a Set", { field: "deniedSources" });
  }
  if (host.prohibitedValues !== undefined && !Array.isArray(host.prohibitedValues)) {
    fail(ENG_CODES.INVALID_HOST_CONFIG, "prohibitedValues must be an array", { field: "prohibitedValues" });
  }
  return host;
}

/** Full closed-schema validation of an admitted event snapshot. */
export function validateEventSnapshot(snap, host) {
  assertIdString(snap.eventId, "$.eventId");
  assertIdString(snap.taskId, "$.taskId");
  if (!snap.source || typeof snap.source !== "object") {
    fail(ENG_CODES.INVALID_FIELD, "source is required", { field: "$.source" });
  }
  assertIdString(snap.source.repo, "$.source.repo");
  assertIdString(snap.source.path, "$.source.path");
  const pin = assertPin(snap.source.pin);
  assertIdString(snap.principal, "$.principal");
  assertUtcIso(snap.eventAt, "$.eventAt");
  if (!EVENT_KINDS.includes(snap.kind)) {
    fail(ENG_CODES.INVALID_KIND, "kind must be a known event kind", { field: "$.kind" });
  }
  if (!EVENT_STATUSES.includes(snap.status)) {
    fail(ENG_CODES.INVALID_STATUS, "status must be a known event status", { field: "$.status" });
  }
  const attribution = assertAttribution(snap.attribution, host);

  // Host authentication, separate from request contents.
  if (!host.approvedRepos.has(snap.source.repo)) {
    fail(ENG_CODES.UNAPPROVED_REPO, "Repository is not host-approved", { field: "$.source.repo" });
  }
  if (!host.approvedPaths.has(snap.source.path)) {
    fail(ENG_CODES.UNAPPROVED_PATH, "Path is not host-approved", { field: "$.source.path" });
  }
  if (!host.registeredPrincipals.has(snap.principal)) {
    fail(ENG_CODES.UNKNOWN_PRINCIPAL, "Principal is not host-registered", { field: "$.principal" });
  }
  return {
    eventId: snap.eventId,
    taskId: snap.taskId,
    source: { repo: snap.source.repo, path: snap.source.path, pin },
    principal: snap.principal,
    eventAt: snap.eventAt,
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
 */
export function scanForbidden(snap, host, path = "$") {
  if (snap === null || typeof snap !== "object") {
    if (typeof snap === "string" && host.prohibitedValues) {
      for (const canary of host.prohibitedValues) {
        if (typeof canary === "string" && canary !== "" && snap.includes(canary)) {
          fail(ENG_CODES.PROHIBITED_DATA, `Prohibited value detected at ${path}`, { path });
        }
      }
    }
    return;
  }
  for (const key of Object.keys(snap)) {
    const lowered = key.toLowerCase();
    for (const frag of FORBIDDEN_KEY_FRAGMENTS) {
      if (lowered.includes(frag)) {
        fail(ENG_CODES.PROHIBITED_DATA, `Forbidden key fragment at ${path}.${key}`, { path: `${path}.${key}` });
      }
    }
    scanForbidden(snap[key], host, `${path}.${key}`);
  }
}

/** Validate an admitted recall query snapshot. */
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
  }
  if (snap.until !== undefined) {
    assertUtcIso(snap.until, "$.until");
    out.until = snap.until;
  }
  if (Object.keys(out).length === 0) {
    fail(ENG_CODES.INVALID_QUERY, "Recall query needs at least one cue", {});
  }
  return out;
}
