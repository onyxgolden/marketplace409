#!/usr/bin/env node
/**
 * assertSweepOutcome.mjs — fail-loud assertion for scheduled sweep endpoints.
 *
 * Watchdog Part 1 (fail-loud workflows). The GitHub Actions sweep workflow
 * curls a cron endpoint and invokes this helper with the raw HTTP status and
 * response body. The helper validates the response against the endpoint's
 * registered contract and exits:
 *   0 — the sweep ran honestly: delivered, legitimate no-op, or an explicit
 *       policy deferral (each with a distinct outcome label; deferrals and
 *       no-ops are NOT delivery proof).
 *   1 — assertion failed: transport error, schema violation, genuine send
 *       failure, partial failure, evidence/bookkeeping failure, dry run, or
 *       unknown endpoint/shape.
 *   2 — helper usage error (bad args, unreadable response file).
 *
 * The helper is read-only: it never retries, refires, or sends anything.
 * Diagnostic output is an allowlisted summary — counts, labels, and outcome
 * notes only. Recipient identifiers, message content, provider errors, and
 * tokens are never printed.
 *
 * Usage:
 *   node scripts/cron/assertSweepOutcome.mjs \
 *     --endpoint /api/rental/cron/tenant-payment-receipts \
 *     --response-file /tmp/sweep-response.json \
 *     --http-status 200
 */

import { readFileSync } from "node:fs";

// ---------------------------------------------------------------------------
// Strict field validators. Counts must be finite nonnegative safe integers —
// no strings, booleans, null, negatives, fractions, NaN, or Infinity, and no
// implicit coercion or silent defaults.
// ---------------------------------------------------------------------------

function isCount(v) {
  return typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
}

function isBoolean(v) {
  return typeof v === "boolean";
}

function isString(v) {
  return typeof v === "string";
}

function isArray(v) {
  return Array.isArray(v);
}

/**
 * Validate one field. Spec: { type: "count"|"boolean"|"string"|"array",
 * required: bool, oneOf?: [...] }. Returns null when valid, else an error
 * string naming the field and the violation.
 */
function validateField(name, value, spec) {
  if (value === undefined || value === null) {
    if (spec.required) return `missing required field "${name}"`;
    return null;
  }
  if (spec.oneOf) {
    if (!spec.oneOf.includes(value))
      return `field "${name}" has unexpected value ${JSON.stringify(value)}; expected one of ${JSON.stringify(spec.oneOf)}`;
    return null;
  }
  const ok =
    spec.type === "count"
      ? isCount(value)
      : spec.type === "boolean"
        ? isBoolean(value)
        : spec.type === "string"
          ? isString(value)
          : spec.type === "array"
            ? isArray(value)
            : false;
  if (!ok)
    return `field "${name}" failed strict type check (expected ${spec.type}, got ${describeValue(value)})`;
  return null;
}

function describeValue(v) {
  if (v === null) return "null";
  if (Array.isArray(v)) return "array";
  const t = typeof v;
  if (t === "number") {
    if (Number.isNaN(v)) return "NaN";
    if (!Number.isFinite(v)) return "non-finite number";
    if (!Number.isInteger(v)) return "fractional number";
    if (v < 0) return "negative number";
    if (!Number.isSafeInteger(v)) return "unsafe integer";
    return "number";
  }
  return t;
}

// ---------------------------------------------------------------------------
// Outcome labels. PASS outcomes are explicit and never claim delivery proof
// for deferrals or idle no-ops. FAIL outcomes distinguish delivery failure
// from evidence/bookkeeping failure: an accepted provider send followed by
// failed bookkeeping must NOT trigger a blind resend.
// ---------------------------------------------------------------------------

const OUTCOMES = {
  delivered: { pass: true, label: "delivered" },
  no_op: { pass: true, label: "no_op" },
  deferred_quiet_hours: { pass: true, label: "deferred_quiet_hours" },
  deferred_claim_held: { pass: true, label: "deferred_claim_held" },
  sending_disabled: { pass: true, label: "sending_disabled" },
  delivery_failed: { pass: false, label: "delivery_failed" },
  evidence_failed: { pass: false, label: "evidence_failed" },
  dry_run: { pass: false, label: "dry_run_not_a_sweep" },
  transport_error: { pass: false, label: "transport_error" },
  schema_error: { pass: false, label: "schema_error" },
  unknown_endpoint: { pass: false, label: "unknown_endpoint" },
  unknown_outcome: { pass: false, label: "unknown_outcome" },
  config_error: { pass: false, label: "config_error" },
};

// ---------------------------------------------------------------------------
// Endpoint registry. Each entry: required response schema + classifier.
// The classifier receives the validated body and returns
// { outcome: <OUTCOMES key>, notes: [strings] }.
// ---------------------------------------------------------------------------

const RECEIPT_SCHEMA = {
  success: { type: "boolean", required: true },
  dryRun: { type: "boolean", required: true },
  sendingEnabled: { type: "boolean", required: true },
  reconciled: { type: "count", required: true },
  skippedAtDetection: { type: "count", required: true },
  reconcileSkipped: { type: "boolean", required: true },
  sent: { type: "count", required: true },
  failed: { type: "count", required: true },
  skippedDisabled: { type: "count", required: true },
  skippedNotAllowlisted: { type: "count", required: true },
  ledgerErrors: { type: "count", required: true },
  deferredQuietHours: { required: true, oneOf: [0, "whole_run_deferred", "run_stopped_at_quiet_hours"] },
  wouldSend: { type: "array", required: true },
};

function classifyReceipt(body) {
  const notes = [];
  if (body.dryRun === true)
    return { outcome: "dry_run", notes: ["scheduled dryRun is not a successful send sweep"] };
  if (body.success === false)
    return { outcome: "delivery_failed", notes: ["endpoint reported success:false"] };
  if (body.failed > 0)
    return { outcome: "delivery_failed", notes: [`${body.failed} failed item(s)`] };
  if (body.ledgerErrors > 0)
    return {
      outcome: "evidence_failed",
      notes: [
        `${body.ledgerErrors} ledger/bookkeeping error(s) after provider send — delivery may have succeeded; do NOT blind-resend; reconcile the ledger`,
      ],
    };
  if (body.deferredQuietHours)
    return {
      outcome: "deferred_quiet_hours",
      notes: [`quiet-hours deferral (${body.deferredQuietHours}) — not delivery proof`],
    };
  if (body.sendingEnabled === false)
    return {
      outcome: "sending_disabled",
      notes: [`${body.skippedDisabled} row(s) terminally skipped_disabled per policy`],
    };
  if (body.reconcileSkipped === true)
    notes.push("reconciler skipped (activation cutoff unset — fail-closed by design)");
  if (body.sent > 0)
    return { outcome: "delivered", notes: [`${body.sent} sent, 0 failed, 0 ledger errors`, ...notes] };
  return {
    outcome: "no_op",
    notes: ["sweep ran honestly, nothing to send — idle, not delivery proof", ...notes],
  };
}

const OWNER_NOTIFICATION_SCHEMA = {
  success: { type: "boolean", required: true },
  dryRun: { type: "boolean", required: true },
  asOfDate: { type: "string", required: true },
  sendingEnabled: { type: "boolean", required: true },
  upcomingDetected: { type: "count", required: true },
  queued: { type: "count", required: true },
  alreadyQueued: { type: "count", required: true },
  reconciled: { type: "count", required: true },
  alreadyReconciled: { type: "count", required: true },
  reconciledInitiated: { type: "count", required: true },
  alreadyReconciledInitiated: { type: "count", required: true },
  reconcileSkipped: { type: "boolean", required: true },
  sent: { type: "count", required: true },
  wouldSend: { type: "array", required: true },
  failed: { type: "count", required: true },
  skippedDisabled: { type: "count", required: true },
  superseded: { type: "count", required: true },
  deferredQuietHours: { type: "count", required: true },
  skippedNotAllowlisted: { type: "count", required: true },
  skippedTenantNotAllowlisted: { type: "count", required: true },
};

function classifyOwnerNotifications(body) {
  const notes = [];
  if (body.dryRun === true)
    return { outcome: "dry_run", notes: ["scheduled dryRun is not a successful send sweep"] };
  if (body.success === false)
    return { outcome: "delivery_failed", notes: ["endpoint reported success:false"] };
  if (body.failed > 0)
    return { outcome: "delivery_failed", notes: [`${body.failed} failed item(s)`] };
  if (body.deferredQuietHours > 0)
    return {
      outcome: "deferred_quiet_hours",
      notes: [`${body.deferredQuietHours} item(s) deferred by quiet-hours policy — not delivery proof`],
    };
  if (body.sendingEnabled === false)
    return {
      outcome: "sending_disabled",
      notes: [`${body.skippedDisabled} row(s) terminally skipped_disabled per policy`],
    };
  if (body.reconcileSkipped === true)
    notes.push("reconciler skipped (activation cutoff unset — fail-closed by design)");
  if (body.sent > 0)
    return { outcome: "delivered", notes: [`${body.sent} sent, 0 failed`, ...notes] };
  return {
    outcome: "no_op",
    notes: ["sweep ran honestly, nothing to send — idle, not delivery proof", ...notes],
  };
}

const TENANT_INVITE_KNOWN_ACTIONS = new Set([
  "already_claimed",
  "already_sent",
  "would_send",
  "sent",
  "blocked_attempts_exhausted",
  "deferred_claim_held",
  "blocked_provider_failed",
  "blocked_ledger",
  "blocked_payload_changed",
]);

const TENANT_INVITE_SCHEMA = {
  success: { type: "boolean", required: true },
  action: { type: "string", required: true },
  dryRun: { type: "boolean", required: false },
};

function classifyTenantInvite(body) {
  if (!TENANT_INVITE_KNOWN_ACTIONS.has(body.action))
    return { outcome: "unknown_outcome", notes: [`unrecognized action "${body.action}"`] };
  switch (body.action) {
    case "already_claimed":
      return { outcome: "no_op", notes: ["tenant already claimed the portal — nothing to send"] };
    case "already_sent":
      return { outcome: "no_op", notes: ["invite already sent (reconciled) — nothing to send"] };
    case "sent":
      return { outcome: "delivered", notes: ["invite sent and recorded"] };
    case "would_send":
      return { outcome: "dry_run", notes: ["dryRun would_send is not a successful send sweep"] };
    case "deferred_claim_held":
      return {
        outcome: "deferred_claim_held",
        notes: ["ledger claim held by another run — deferred, not a failure, not delivery proof"],
      };
    case "blocked_attempts_exhausted":
      return { outcome: "delivery_failed", notes: ["send attempts exhausted"] };
    case "blocked_provider_failed":
      return { outcome: "delivery_failed", notes: ["provider failed the send"] };
    case "blocked_ledger":
      return {
        outcome: "evidence_failed",
        notes: ["ledger claim/write failed — delivery did not occur; do NOT blind-resend; reconcile the ledger"],
      };
    case "blocked_payload_changed":
      return { outcome: "delivery_failed", notes: ["payload changed under the claim — failed closed by design"] };
    default:
      return { outcome: "unknown_outcome", notes: [`unhandled action "${body.action}"`] };
  }
}

const REMINDER_SCHEMAS = {
  "/api/private-financing/cron/payment-due-reminders": {
    success: { type: "boolean", required: true },
    dryRun: { type: "boolean", required: true },
    asOfDate: { type: "string", required: true },
    accountsEvaluated: { type: "count", required: true },
    sent: { type: "count", required: true },
    wouldSend: { type: "array", required: true },
    failed: { type: "count", required: true },
    alreadySent: { type: "count", required: true },
    skipped: { type: "count", required: true },
    unavailable: { type: "count", required: true },
  },
  "/api/rental/cron/rent-due-reminders": {
    success: { type: "boolean", required: true },
    dryRun: { type: "boolean", required: true },
    asOfDate: { type: "string", required: true },
    chargesEnsured: { type: "count", required: true },
    chargesEvaluated: { type: "count", required: true },
    sent: { type: "count", required: true },
    wouldSend: { type: "array", required: true },
    failed: { type: "count", required: true },
    alreadySent: { type: "count", required: true },
    skipped: { type: "count", required: true },
    superseded: { type: "count", required: true },
  },
};

function classifyReminder(body) {
  if (body.dryRun === true)
    return { outcome: "dry_run", notes: ["scheduled dryRun is not a successful send sweep"] };
  if (body.success === false)
    return { outcome: "delivery_failed", notes: ["endpoint reported success:false"] };
  if (body.failed > 0)
    return { outcome: "delivery_failed", notes: [`${body.failed} failed item(s)`] };
  if (body.sent > 0)
    return { outcome: "delivered", notes: [`${body.sent} sent, 0 failed`] };
  const notes = ["sweep ran honestly, nothing to send — idle, not delivery proof"];
  if (body.alreadySent > 0) notes.push(`${body.alreadySent} already sent (idempotent no-op)`);
  if (body.skipped > 0) notes.push(`${body.skipped} skipped per policy`);
  return { outcome: "no_op", notes };
}

const ENDPOINT_REGISTRY = {
  "/api/private-financing/cron/payment-receipt-notifications": {
    schema: RECEIPT_SCHEMA,
    classify: classifyReceipt,
  },
  "/api/rental/cron/tenant-payment-receipts": {
    schema: RECEIPT_SCHEMA,
    classify: classifyReceipt,
  },
  "/api/rental/cron/owner-payment-notifications": {
    schema: OWNER_NOTIFICATION_SCHEMA,
    classify: classifyOwnerNotifications,
  },
  "/api/rental/cron/tenant-invite": {
    schema: TENANT_INVITE_SCHEMA,
    classify: classifyTenantInvite,
    // tenant-invite uses 409 for the recognized "claim held by another run"
    // deferral and 500 for its blocked_* action contract; any other non-2xx
    // is a transport/config failure. Unexpected 500 bodies (no action) fail
    // schema validation.
    allowedNon2xx: [409, 500],
  },
  "/api/private-financing/cron/payment-due-reminders": {
    schema: REMINDER_SCHEMAS["/api/private-financing/cron/payment-due-reminders"],
    classify: classifyReminder,
  },
  "/api/rental/cron/rent-due-reminders": {
    schema: REMINDER_SCHEMAS["/api/rental/cron/rent-due-reminders"],
    classify: classifyReminder,
  },
};

// ---------------------------------------------------------------------------
// Pure assertion entry point. Returns { pass, outcome, notes }.
// Exported for unit tests; the CLI below is the workflow-facing wrapper.
// ---------------------------------------------------------------------------

export function normalizeEndpoint(raw) {
  if (typeof raw !== "string") return "";
  const q = raw.indexOf("?");
  const path = (q === -1 ? raw : raw.slice(0, q)).trim();
  return path;
}

export function assertSweepOutcome({ endpoint, httpStatus, body }) {
  const path = normalizeEndpoint(endpoint);
  const entry = ENDPOINT_REGISTRY[path];
  if (!entry) {
    return {
      pass: false,
      outcome: "unknown_endpoint",
      notes: [`no registered contract for endpoint "${path}" — refusing to green an unrecognized sweep`],
    };
  }

  const status = Number(httpStatus);
  const statusOk =
    Number.isSafeInteger(status) && status >= 200 && status < 300;
  const allowedDeferralStatus =
    Number.isSafeInteger(status) &&
    (entry.allowedNon2xx || []).includes(status);
  if (!statusOk && !allowedDeferralStatus) {
    return {
      pass: false,
      outcome: "transport_error",
      notes: [`HTTP ${String(httpStatus)} is not a successful sweep response`],
    };
  }

  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return {
      pass: false,
      outcome: "schema_error",
      notes: ["response body is not a JSON object"],
    };
  }

  for (const [name, spec] of Object.entries(entry.schema)) {
    const err = validateField(name, body[name], spec);
    if (err) {
      return { pass: false, outcome: "schema_error", notes: [err] };
    }
  }

  const { outcome, notes } = entry.classify(body);
  const meta = OUTCOMES[outcome];
  if (!meta) {
    return {
      pass: false,
      outcome: "unknown_outcome",
      notes: [`classifier returned unrecognized outcome "${outcome}"`],
    };
  }
  return { pass: meta.pass, outcome: meta.label, notes: notes || [] };
}

// ---------------------------------------------------------------------------
// Allowlisted diagnostic summary. Prints endpoint, HTTP status, outcome
// label, counts, and notes — never recipient identifiers, message content,
// provider errors, or tokens.
// ---------------------------------------------------------------------------

export function diagnosticSummary({ endpoint, httpStatus, result }) {
  const lines = [];
  lines.push(`[sweep-assert] endpoint=${normalizeEndpoint(endpoint)} http=${String(httpStatus)}`);
  lines.push(`[sweep-assert] outcome=${result.outcome} result=${result.pass ? "PASS" : "FAIL"}`);
  for (const note of result.notes || []) lines.push(`[sweep-assert] note: ${note}`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--endpoint") out.endpoint = argv[++i];
    else if (a === "--response-file") out.responseFile = argv[++i];
    else if (a === "--http-status") out.httpStatus = argv[++i];
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.endpoint || !args.responseFile || args.httpStatus === undefined) {
    console.error(
      "Usage: node scripts/cron/assertSweepOutcome.mjs --endpoint <path> --response-file <file> --http-status <code>",
    );
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(args.responseFile, "utf8");
  } catch (e) {
    console.log(`[sweep-assert] outcome=transport_error result=FAIL`);
    console.log(`[sweep-assert] note: cannot read response file "${args.responseFile}": ${e.message}`);
    process.exit(1);
  }
  let body;
  try {
    body = JSON.parse(raw);
  } catch {
    console.log(`[sweep-assert] outcome=schema_error result=FAIL`);
    console.log(`[sweep-assert] note: response body is not valid JSON`);
    process.exit(1);
  }
  const result = assertSweepOutcome({ endpoint: args.endpoint, httpStatus: args.httpStatus, body });
  console.log(diagnosticSummary({ endpoint: args.endpoint, httpStatus: args.httpStatus, result }));
  // Exit 3 (distinct from 1) when the endpoint has no registered contract:
  // the workflow falls back to the legacy generic check for sweeps not yet
  // under the strict contract. Every other failure exits 1.
  if (!result.pass && result.outcome === "unknown_endpoint") process.exit(3);
  process.exit(result.pass ? 0 : 1);
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (isMain) main();
