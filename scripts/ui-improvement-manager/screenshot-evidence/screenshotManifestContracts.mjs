// Versioned, runtime-validated manifest contract for FB-UI-1 (requirement 7: "Store a manifest
// containing route, viewport, commit, timestamp, browser version, screenshot hash, and readiness
// evidence"). Mirrors scripts/repair-controller/repairContracts.mjs's validation style deliberately
// (fail closed on any unknown/malformed field, return a frozen object with a fixed key order) so the
// two subsystems stay recognizably consistent to a reader, without literally sharing repair-specific
// types that would be a category error for UI evidence -- see the FB-UI-0 checkpoint report, section
// 3.2 and 3.6.

import { VIEWPORT_NAMES } from "./viewportPresets.mjs";

export const SCREENSHOT_MANIFEST_SCHEMA_VERSION = "1.0";

export const CAPTURE_KIND = Object.freeze({ FULL_PAGE: "full-page", COMPONENT: "component" });

export const CAPTURE_ENVIRONMENT = Object.freeze({ LOCAL: "local", PREVIEW: "preview" });

export class MalformedScreenshotManifestEntryError extends Error {
  constructor(reason) {
    super(`Malformed ScreenshotManifestEntry: ${reason}`);
    this.name = "MalformedScreenshotManifestEntryError";
    this.reason = reason;
  }
}

function fail(reason) {
  throw new MalformedScreenshotManifestEntryError(reason);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isCommitSha(value) {
  return typeof value === "string" && /^[0-9a-f]{7,40}$/i.test(value);
}

function validateReadinessEvidence(readinessEvidence) {
  if (!Array.isArray(readinessEvidence)) fail("readinessEvidence must be an array");
  return readinessEvidence.map((entry, index) => {
    if (typeof entry !== "object" || entry === null) fail(`readinessEvidence[${index}] must be an object`);
    if (!isNonEmptyString(entry.type)) fail(`readinessEvidence[${index}].type must be a non-empty string`);
    if (!isNonEmptyString(entry.description)) fail(`readinessEvidence[${index}].description must be a non-empty string`);
    if (entry.satisfied !== true) fail(`readinessEvidence[${index}].satisfied must be true -- an entry only exists once a condition is actually satisfied`);
    if (!Number.isFinite(entry.waitedMs) || entry.waitedMs < 0) fail(`readinessEvidence[${index}].waitedMs must be a non-negative number`);
    return Object.freeze({ type: entry.type, description: entry.description, satisfied: true, waitedMs: entry.waitedMs });
  });
}

function validateRedaction(redaction) {
  if (typeof redaction !== "object" || redaction === null) fail("redaction must be an object");
  if (redaction.verified !== true) fail("redaction.verified must be true -- an unverified capture must never reach the manifest");
  if (!isStringArray(redaction.rulesApplied)) fail("redaction.rulesApplied must be an array of strings");
  return Object.freeze({ verified: true, rulesApplied: Object.freeze([...redaction.rulesApplied]) });
}

export function validateScreenshotManifestEntry(entry) {
  if (typeof entry !== "object" || entry === null) fail("entry must be an object");
  if (!isNonEmptyString(entry.entryId)) fail("entryId must be a non-empty string");
  if (!isNonEmptyString(entry.routeId)) fail("routeId must be a non-empty string");
  if (!isNonEmptyString(entry.routePath)) fail("routePath must be a non-empty string");
  if (!VIEWPORT_NAMES.includes(entry.viewport)) fail(`viewport must be one of ${VIEWPORT_NAMES.join(", ")}`);
  if (!Object.values(CAPTURE_KIND).includes(entry.kind)) fail(`kind must be one of ${Object.values(CAPTURE_KIND).join(", ")}`);
  if (entry.kind === CAPTURE_KIND.COMPONENT && !isNonEmptyString(entry.componentName)) {
    fail("componentName is required when kind is \"component\"");
  }
  if (entry.kind === CAPTURE_KIND.FULL_PAGE && entry.componentName != null) {
    fail("componentName must be null/absent when kind is \"full-page\"");
  }
  if (!Object.values(CAPTURE_ENVIRONMENT).includes(entry.environment)) {
    fail(`environment must be one of ${Object.values(CAPTURE_ENVIRONMENT).join(", ")}`);
  }
  if (!isCommitSha(entry.commit)) fail("commit must look like a git commit SHA (7-40 hex characters)");
  if (!isNonEmptyString(entry.capturedAt) || Number.isNaN(Date.parse(entry.capturedAt))) {
    fail("capturedAt must be a valid ISO-8601 timestamp string");
  }
  if (!isNonEmptyString(entry.browserVersion)) fail("browserVersion must be a non-empty string");
  if (!/^sha256:[0-9a-f]{64}$/.test(entry.screenshotHash || "")) fail("screenshotHash must be a sha256:<hex> string");
  const readinessEvidence = validateReadinessEvidence(entry.readinessEvidence);
  const redaction = validateRedaction(entry.redaction);
  if (!["synthetic-session", "none"].includes(entry.authMode)) fail('authMode must be "synthetic-session" or "none"');

  return Object.freeze({
    entryId: entry.entryId, routeId: entry.routeId, routePath: entry.routePath, viewport: entry.viewport,
    kind: entry.kind, componentName: entry.componentName ?? null, environment: entry.environment,
    commit: entry.commit, capturedAt: entry.capturedAt, browserVersion: entry.browserVersion,
    screenshotHash: entry.screenshotHash, readinessEvidence: Object.freeze(readinessEvidence),
    redaction, authMode: entry.authMode,
  });
}

export function validateScreenshotManifest(manifest) {
  if (typeof manifest !== "object" || manifest === null) fail("manifest must be an object");
  if (manifest.schemaVersion !== SCREENSHOT_MANIFEST_SCHEMA_VERSION) {
    fail(`schemaVersion must be exactly "${SCREENSHOT_MANIFEST_SCHEMA_VERSION}"`);
  }
  if (!Array.isArray(manifest.entries)) fail("entries must be an array");
  // Sorted by a fixed, deterministic key -- never insertion order alone -- so two runs over the same
  // set of captures always serialize identically (same requirement as
  // repairContracts.mjs's computeManifestHash relying on stable key order).
  const entries = manifest.entries
    .map((entry) => validateScreenshotManifestEntry(entry))
    .sort((a, b) => `${a.routeId}:${a.viewport}:${a.kind}:${a.componentName || ""}`.localeCompare(
      `${b.routeId}:${b.viewport}:${b.kind}:${b.componentName || ""}`,
    ));
  return Object.freeze({ schemaVersion: SCREENSHOT_MANIFEST_SCHEMA_VERSION, entries: Object.freeze(entries) });
}
