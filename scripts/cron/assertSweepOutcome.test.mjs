import { describe, expect, it } from "vitest";
import {
  assertSweepOutcome,
  diagnosticSummary,
  normalizeEndpoint,
} from "./assertSweepOutcome.mjs";

// ---------------------------------------------------------------------------
// Fixture builders — one per endpoint shape, mirroring the production
// response contracts in src/app/api/*/cron/*/route.js.
// ---------------------------------------------------------------------------

function receiptBody(overrides = {}) {
  return {
    success: true,
    dryRun: false,
    sendingEnabled: true,
    reconciled: 0,
    skippedAtDetection: 0,
    reconcileSkipped: false,
    sent: 0,
    failed: 0,
    skippedDisabled: 0,
    skippedNotAllowlisted: 0,
    ledgerErrors: 0,
    deferredQuietHours: 0,
    wouldSend: [],
    ...overrides,
  };
}

function ownerNotificationBody(overrides = {}) {
  return {
    success: true,
    dryRun: false,
    asOfDate: "2026-10-13",
    sendingEnabled: true,
    upcomingDetected: 0,
    queued: 0,
    alreadyQueued: 0,
    reconciled: 0,
    alreadyReconciled: 0,
    reconciledInitiated: 0,
    alreadyReconciledInitiated: 0,
    reconcileSkipped: false,
    sent: 0,
    wouldSend: [],
    failed: 0,
    skippedDisabled: 0,
    superseded: 0,
    deferredQuietHours: 0,
    skippedNotAllowlisted: 0,
    skippedTenantNotAllowlisted: 0,
    ...overrides,
  };
}

function tenantInviteBody(overrides = {}) {
  return { success: true, action: "already_claimed", dryRun: false, ...overrides };
}

function pfReminderBody(overrides = {}) {
  return {
    success: true,
    dryRun: false,
    asOfDate: "2026-10-13",
    accountsEvaluated: 2,
    sent: 0,
    wouldSend: [],
    failed: 0,
    alreadySent: 0,
    skipped: 0,
    unavailable: 0,
    ...overrides,
  };
}

function rentReminderBody(overrides = {}) {
  return {
    success: true,
    dryRun: false,
    asOfDate: "2026-10-13",
    chargesEnsured: 1,
    chargesEvaluated: 1,
    sent: 0,
    wouldSend: [],
    failed: 0,
    alreadySent: 0,
    skipped: 0,
    superseded: 0,
    ...overrides,
  };
}

const PF_RECEIPTS = "/api/private-financing/cron/payment-receipt-notifications";
const TENANT_RECEIPTS = "/api/rental/cron/tenant-payment-receipts";
const OWNER_NOTIFS = "/api/rental/cron/owner-payment-notifications";
const TENANT_INVITE = "/api/rental/cron/tenant-invite";
const PF_REMINDERS = "/api/private-financing/cron/payment-due-reminders";
const RENT_REMINDERS = "/api/rental/cron/rent-due-reminders";

function check(endpoint, httpStatus, body) {
  return assertSweepOutcome({ endpoint, httpStatus, body });
}

// ---------------------------------------------------------------------------
// normalizeEndpoint
// ---------------------------------------------------------------------------

describe("normalizeEndpoint", () => {
  it("strips manual-dispatch query strings", () => {
    expect(normalizeEndpoint("/api/rental/cron/tenant-invite?trigger=manual")).toBe(
      "/api/rental/cron/tenant-invite",
    );
  });
  it("passes plain paths through", () => {
    expect(normalizeEndpoint(TENANT_RECEIPTS)).toBe(TENANT_RECEIPTS);
  });
  it("handles non-strings safely", () => {
    expect(normalizeEndpoint(undefined)).toBe("");
    expect(normalizeEndpoint(null)).toBe("");
  });
});

// ---------------------------------------------------------------------------
// Unknown endpoint / transport / shape
// ---------------------------------------------------------------------------

describe("unknown endpoint and transport", () => {
  it("fails an unregistered endpoint", () => {
    const r = check("/api/rental/cron/nonexistent", 200, { success: true });
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("unknown_endpoint");
  });
  it("fails HTTP 500", () => {
    const r = check(PF_RECEIPTS, 500, { error: "boom" });
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("transport_error");
  });
  it("fails HTTP 000 (curl timeout / no response)", () => {
    const r = check(PF_RECEIPTS, "000", {});
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("transport_error");
  });
  it("fails HTTP 401", () => {
    const r = check(PF_RECEIPTS, 401, { error: "Unauthorized." });
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("transport_error");
  });
  it("fails a non-object body", () => {
    for (const body of [null, [], "ok", 42]) {
      const r = check(PF_RECEIPTS, 200, body);
      expect(r.pass).toBe(false);
      expect(r.outcome).toBe("schema_error");
    }
  });
});

// ---------------------------------------------------------------------------
// Strict count validation — no strings, booleans, negatives, fractions,
// null, or missing required fields; no implicit coercion or silent defaults.
// ---------------------------------------------------------------------------

describe("strict field validation", () => {
  const badCounts = ["5", true, -1, 1.5, NaN, Infinity, null];
  it.each(badCounts)("rejects sent=%p", (bad) => {
    const r = check(PF_RECEIPTS, 200, receiptBody({ sent: bad }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("schema_error");
    expect(r.notes.join(" ")).toContain('"sent"');
  });
  it("rejects a missing required field (no silent default to zero)", () => {
    const body = receiptBody();
    delete body.failed;
    const r = check(PF_RECEIPTS, 200, body);
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("schema_error");
    expect(r.notes.join(" ")).toContain("missing required field");
  });
  it("rejects a wrong-typed boolean", () => {
    const r = check(PF_RECEIPTS, 200, receiptBody({ success: "true" }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("schema_error");
  });
  it("rejects an unexpected deferredQuietHours value", () => {
    const r = check(PF_RECEIPTS, 200, receiptBody({ deferredQuietHours: "later" }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("schema_error");
  });
  it("rejects a non-array wouldSend", () => {
    const r = check(PF_RECEIPTS, 200, receiptBody({ wouldSend: "nobody@example.com" }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("schema_error");
  });
});

// ---------------------------------------------------------------------------
// Receipt endpoints (PF + tenant share the contract)
// ---------------------------------------------------------------------------

describe.each([
  ["pf", PF_RECEIPTS],
  ["tenant", TENANT_RECEIPTS],
])("receipt endpoint (%s)", (_name, endpoint) => {
  it("passes a clean delivery", () => {
    const r = check(endpoint, 200, receiptBody({ sent: 2, reconciled: 2 }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("delivered");
  });
  it("passes a legitimate idle no-op", () => {
    const r = check(endpoint, 200, receiptBody());
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("no_op");
  });
  it("fails success:false", () => {
    const r = check(endpoint, 200, receiptBody({ success: false }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("delivery_failed");
  });
  it("fails partial failure (some sent, some errored)", () => {
    const r = check(endpoint, 200, receiptBody({ sent: 3, failed: 2 }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("delivery_failed");
  });
  it("fails ledgerErrors even when delivery succeeded — labeled evidence failure, not delivery failure", () => {
    const r = check(endpoint, 200, receiptBody({ sent: 2, ledgerErrors: 1 }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("evidence_failed");
    expect(r.notes.join(" ")).toMatch(/do NOT blind-resend/i);
  });
  it("fails a scheduled dryRun", () => {
    const r = check(endpoint, 200, receiptBody({ dryRun: true, wouldSend: [{ to: "x", subject: "y" }] }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("dry_run_not_a_sweep");
  });
  it("passes whole-run quiet-hours deferral as an explicit deferral, not delivery proof", () => {
    const r = check(endpoint, 200, receiptBody({ deferredQuietHours: "whole_run_deferred" }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("deferred_quiet_hours");
  });
  it("passes mid-run quiet-hours stop as an explicit deferral", () => {
    const r = check(
      endpoint,
      200,
      receiptBody({ sent: 1, deferredQuietHours: "run_stopped_at_quiet_hours" }),
    );
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("deferred_quiet_hours");
  });
  it("passes sending-disabled as an explicit policy category", () => {
    const r = check(endpoint, 200, receiptBody({ sendingEnabled: false, skippedDisabled: 3 }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("sending_disabled");
  });
  it("surfaces reconcileSkipped as a visible flag on an otherwise passing run", () => {
    const r = check(endpoint, 200, receiptBody({ reconcileSkipped: true }));
    expect(r.pass).toBe(true);
    expect(r.notes.join(" ")).toContain("reconciler skipped");
  });
});

// ---------------------------------------------------------------------------
// Owner payment notifications
// ---------------------------------------------------------------------------

describe("owner-payment-notifications", () => {
  it("passes a clean delivery", () => {
    const r = check(OWNER_NOTIFS, 200, ownerNotificationBody({ sent: 1, queued: 1 }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("delivered");
  });
  it("passes a legitimate idle no-op", () => {
    const r = check(OWNER_NOTIFS, 200, ownerNotificationBody());
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("no_op");
  });
  it("fails on failed items", () => {
    const r = check(OWNER_NOTIFS, 200, ownerNotificationBody({ failed: 1 }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("delivery_failed");
  });
  it("passes quiet-hours item deferral as an explicit category (count shape here)", () => {
    const r = check(OWNER_NOTIFS, 200, ownerNotificationBody({ deferredQuietHours: 4 }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("deferred_quiet_hours");
  });
  it("fails a dry run", () => {
    const r = check(OWNER_NOTIFS, 200, ownerNotificationBody({ dryRun: true }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("dry_run_not_a_sweep");
  });
  it("rejects a string deferredQuietHours (count shape, no coercion)", () => {
    const r = check(OWNER_NOTIFS, 200, ownerNotificationBody({ deferredQuietHours: "whole_run_deferred" }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("schema_error");
  });
});

// ---------------------------------------------------------------------------
// Tenant invite (action-based contract)
// ---------------------------------------------------------------------------

describe("tenant-invite", () => {
  it("passes already_claimed as a no-op", () => {
    const r = check(TENANT_INVITE, 200, tenantInviteBody({ action: "already_claimed" }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("no_op");
  });
  it("passes already_sent as a no-op", () => {
    const r = check(TENANT_INVITE, 200, tenantInviteBody({ action: "already_sent" }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("no_op");
  });
  it("passes a real send", () => {
    const r = check(TENANT_INVITE, 200, tenantInviteBody({ action: "sent" }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("delivered");
  });
  it("fails would_send (dry run)", () => {
    const r = check(TENANT_INVITE, 200, tenantInviteBody({ action: "would_send", dryRun: true }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("dry_run_not_a_sweep");
  });
  it("passes deferred_claim_held on HTTP 409 as an explicit deferral", () => {
    const r = check(
      TENANT_INVITE,
      409,
      tenantInviteBody({ success: false, action: "deferred_claim_held" }),
    );
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("deferred_claim_held");
  });
  it("fails blocked_attempts_exhausted", () => {
    const r = check(
      TENANT_INVITE,
      500,
      tenantInviteBody({ success: false, action: "blocked_attempts_exhausted" }),
    );
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("delivery_failed");
  });
  it("fails blocked_ledger as evidence failure", () => {
    const r = check(TENANT_INVITE, 500, tenantInviteBody({ success: false, action: "blocked_ledger" }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("evidence_failed");
  });
  it("fails blocked_provider_failed", () => {
    const r = check(
      TENANT_INVITE,
      500,
      tenantInviteBody({ success: false, action: "blocked_provider_failed" }),
    );
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("delivery_failed");
  });
  it("fails an unrecognized action", () => {
    const r = check(TENANT_INVITE, 200, tenantInviteBody({ action: "teleported" }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("unknown_outcome");
  });
  it("fails a 409 that does not carry the recognized deferral contract", () => {
    const r = check(TENANT_INVITE, 409, { success: false, action: "blocked_ledger" });
    expect(r.pass).toBe(false);
    // 409 is allowed through transport, but blocked_ledger is an evidence failure
    expect(r.outcome).toBe("evidence_failed");
  });
});

// ---------------------------------------------------------------------------
// Reminder endpoints
// ---------------------------------------------------------------------------

describe.each([
  ["pf-payment-due", PF_REMINDERS, pfReminderBody],
  ["rent-due", RENT_REMINDERS, rentReminderBody],
])("reminder endpoint (%s)", (_name, endpoint, builder) => {
  it("passes a clean delivery", () => {
    const r = check(endpoint, 200, builder({ sent: 2 }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("delivered");
  });
  it("passes an idle no-op", () => {
    const r = check(endpoint, 200, builder());
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("no_op");
  });
  it("fails on failed items", () => {
    const r = check(endpoint, 200, builder({ failed: 1 }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("delivery_failed");
  });
  it("fails a dry run", () => {
    const r = check(endpoint, 200, builder({ dryRun: true }));
    expect(r.pass).toBe(false);
    expect(r.outcome).toBe("dry_run_not_a_sweep");
  });
  it("notes alreadySent/skipped on a passing no-op", () => {
    const r = check(endpoint, 200, builder({ alreadySent: 2, skipped: 1 }));
    expect(r.pass).toBe(true);
    expect(r.outcome).toBe("no_op");
    expect(r.notes.join(" ")).toContain("already sent");
  });
});

// ---------------------------------------------------------------------------
// Diagnostic summary redaction — the allowlisted summary must never leak
// recipient identifiers, message content, or tokens.
// ---------------------------------------------------------------------------

describe("diagnosticSummary redaction", () => {
  it("never prints wouldSend recipients, subjects, or tokens", () => {
    const body = receiptBody({
      sent: 1,
      wouldSend: [
        { to: "tenant@example.com", subject: "Your receipt" },
        { token: "secret-token-value" },
      ],
    });
    const result = check(PF_RECEIPTS, 200, body);
    const summary = diagnosticSummary({ endpoint: PF_RECEIPTS, httpStatus: 200, result });
    expect(summary).not.toContain("tenant@example.com");
    expect(summary).not.toContain("Your receipt");
    expect(summary).not.toContain("secret-token-value");
    expect(summary).toContain("outcome=delivered");
    expect(summary).toContain("result=PASS");
  });
  it("marks failures without leaking body content", () => {
    const result = check(PF_RECEIPTS, 200, receiptBody({ failed: 2 }));
    const summary = diagnosticSummary({ endpoint: PF_RECEIPTS, httpStatus: 200, result });
    expect(summary).toContain("result=FAIL");
    expect(summary).toContain("2 failed item(s)");
  });
});
