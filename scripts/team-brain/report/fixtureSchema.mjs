// Team Brain slice 1 — synthetic fixture schema validation.
//
// The CLI accepts ONLY synthetic fixtures: the top-level `synthetic` flag
// must be literally true and the schema version must be 1. Anything else is
// rejected. No live data, no network, no model calls.

import { CODES, fail } from "../ledger/errors.mjs";
import { assertNonEmptyString, assertStringArray, assertUtcIso } from "../ledger/validation.mjs";

const TOP_LEVEL_KEYS = new Set([
  "synthetic",
  "schemaVersion",
  "description",
  "obligations",
  "lifecycle",
  "handoffs",
  "trustedAuthorizations",
]);

export function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || Array.isArray(fixture)) {
    fail(CODES.INVALID_FIXTURE, "Fixture must be a JSON object");
  }
  for (const key of Object.keys(fixture)) {
    if (!TOP_LEVEL_KEYS.has(key)) {
      fail(CODES.INVALID_FIXTURE, `Fixture has unknown top-level key: ${key}`, { key });
    }
  }
  if (fixture.synthetic !== true) {
    fail(CODES.NON_SYNTHETIC_FIXTURE, "Fixture is not marked synthetic: refusing to run (synthetic fixtures only)");
  }
  if (fixture.schemaVersion !== 1) {
    fail(CODES.INVALID_FIXTURE, `Unsupported fixture schemaVersion: ${JSON.stringify(fixture.schemaVersion)}`, {
      schemaVersion: fixture.schemaVersion,
    });
  }
  const obligations = fixture.obligations || [];
  const lifecycle = fixture.lifecycle || [];
  const handoffs = fixture.handoffs || [];
  const trustedAuthorizations = fixture.trustedAuthorizations || [];
  if (!Array.isArray(obligations) || !Array.isArray(lifecycle) || !Array.isArray(handoffs)) {
    fail(CODES.INVALID_FIXTURE, "Fixture obligations/lifecycle/handoffs must be arrays");
  }
  if (!Array.isArray(trustedAuthorizations)) {
    fail(CODES.INVALID_FIXTURE, "Fixture trustedAuthorizations must be an array");
  }
  for (const o of obligations) validateObligationEntry(o);
  for (const op of lifecycle) validateLifecycleOp(op);
  for (const h of handoffs) validateHandoffEntry(h);
  for (const a of trustedAuthorizations) validateAuthorizationRecord(a);
  return { obligations, lifecycle, handoffs, trustedAuthorizations, description: fixture.description || "" };
}

function validateAuthorizationRecord(a) {
  if (!a || typeof a !== "object") fail(CODES.INVALID_FIXTURE, "Authorization record must be an object");
  assertNonEmptyString(a.id, "trustedAuthorizations.id");
  assertNonEmptyString(a.granter, "trustedAuthorizations.granter");
  assertNonEmptyString(a.itemId, "trustedAuthorizations.itemId");
  if (a.revoked !== undefined && typeof a.revoked !== "boolean") {
    fail(CODES.INVALID_FIXTURE, "trustedAuthorizations.revoked must be a boolean", { id: a.id });
  }
  if (a.rank !== undefined && (!Number.isInteger(a.rank) || a.rank < 0)) {
    fail(CODES.INVALID_FIXTURE, "trustedAuthorizations.rank must be a non-negative integer", { id: a.id });
  }
}

function validateObligationEntry(o) {
  if (!o || typeof o !== "object") fail(CODES.INVALID_FIXTURE, "Obligation entry must be an object");
  assertNonEmptyString(o.id, "obligation.id");
  assertNonEmptyString(o.kind, "obligation.kind");
  assertUtcIso(o.filedAt, "obligation.filedAt");
  if (!o.source || typeof o.source !== "object") {
    fail(CODES.INVALID_FIXTURE, `Obligation ${o.id}: source must be an object`, { id: o.id });
  }
  assertNonEmptyString(o.retentionDisposition, "obligation.retentionDisposition");
  if (o.dependencies !== undefined) assertStringArray(o.dependencies, "obligation.dependencies");
}

const LIFECYCLE_OPS = new Set([
  "note",
  "reping",
  "reportToJason",
  "recordVerification",
  "closeTask",
  "revokeAuthorization",
  "supersedeVerdict",
  "correctEvidence",
  "setRetention",
]);

function validateLifecycleOp(op) {
  if (!op || typeof op !== "object") fail(CODES.INVALID_FIXTURE, "Lifecycle op must be an object");
  if (!LIFECYCLE_OPS.has(op.op)) {
    fail(CODES.INVALID_FIXTURE, `Unknown lifecycle op: ${JSON.stringify(op.op)}`, { op: op.op });
  }
  if (op.op === "supersedeVerdict" || op.op === "correctEvidence") {
    assertNonEmptyString(op.oldId, "lifecycle.oldId");
    if (!op.new || typeof op.new !== "object") {
      fail(CODES.INVALID_FIXTURE, `Lifecycle op ${op.op}: new must be an obligation object`);
    }
    validateObligationEntry(op.new);
  } else {
    assertNonEmptyString(op.id, "lifecycle.id");
  }
  if (op.recordedAt !== undefined) assertUtcIso(op.recordedAt, "lifecycle.recordedAt");
  if (op.verifiedAt !== undefined) assertUtcIso(op.verifiedAt, "lifecycle.verifiedAt");
}

function validateHandoffEntry(h) {
  if (!h || typeof h !== "object") fail(CODES.INVALID_FIXTURE, "Handoff entry must be an object");
  assertNonEmptyString(h.id, "handoff.id");
  if (!Array.isArray(h.steps)) fail(CODES.INVALID_FIXTURE, `Handoff ${h.id}: steps must be an array`);
  const ops = new Set(["writeOutcome", "verifyReadback", "updateQueue", "complete"]);
  for (const s of h.steps) {
    if (!s || typeof s !== "object" || !ops.has(s.op)) {
      fail(CODES.INVALID_FIXTURE, `Handoff ${h.id}: unknown step op ${JSON.stringify(s && s.op)}`);
    }
  }
}
