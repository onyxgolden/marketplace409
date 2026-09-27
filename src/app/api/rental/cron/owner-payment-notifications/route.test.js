import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));
vi.mock("@/infrastructure/billing/StripeBillingProvider", () => ({
  createStripeBillingProvider: vi.fn(() => ({ provider: "stripe", mode: "test" })),
}));
vi.mock("@/infrastructure/notifications/ResendRentalEmailProvider", () => ({
  createResendRentalEmailProvider: vi.fn(),
}));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { createResendRentalEmailProvider } from "@/infrastructure/notifications/ResendRentalEmailProvider";
import { GET } from "./route.js";

// Obvious fixtures only — never real tenant, lease, or financial data.
const OWNER = "owner_fixture";

function isoTodayPlus(days) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function qb(result) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    in: vi.fn(() => node),
    order: vi.fn(() => node),
    gte: vi.fn(() => node),
    is: vi.fn(() => node),
    range: vi.fn(() => node),
    update: vi.fn(() => node),
    upsert: vi.fn(() => node),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => resolve(result),
  };
  return node;
}

// Deterministic mock db: tableSequences maps each table to the list of query
// builders consumed in call order.
function sequenceDb(tableSequences) {
  const counters = {};
  return {
    from: vi.fn((table) => {
      const seq = tableSequences[table];
      if (!seq) throw new Error(`unexpected from(${table}) call`);
      const i = counters[table] || 0;
      counters[table] = i + 1;
      if (i >= seq.length) throw new Error(`too many from(${table}) calls`);
      return seq[i];
    }),
  };
}

function authedRequest(url = "https://test/api") {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

const ENROLLMENT = { id: "enr_fixture", owner_id: OWNER, lease_id: "lease_fixture" };
function chargeRow() {
  return {
    id: "charge_fixture", owner_id: OWNER, lease_id: "lease_fixture",
    due_date: isoTodayPlus(3), amount_cents: 160000, paid_amount_cents: 0,
    status: "due", charge_type: "rent",
  };
}
const LEASE_TENANTS = [{ lease_id: "lease_fixture", rental_tenants: { id: "tenant_fixture", display_name: "Test Tenant" } }];

function queuedRow() {
  return {
    owner_id: OWNER, id: `opn_${OWNER}_upcoming_autopay_enr_fixture_charge_fixture_${isoTodayPlus(3)}`,
    event_type: "upcoming_autopay", status: "queued", attempt_count: 0,
    first_attempted_at: null, last_attempted_at: null, charge_id: "charge_fixture",
    payload: { tenant_name: "Test Tenant", amount_cents: 160000, due_date: isoTodayPlus(3), charge_type: "rent", is_autopay: true },
  };
}

function queuedRowWithEnrollment() {
  const row = queuedRow();
  row.payload = { ...row.payload, enrollment_id: "enr_fixture" };
  return row;
}

function terminalPaymentRow() {
  return {
    id: "rental_payment_fixture", owner_id: OWNER, charge_id: "charge_fixture",
    lease_id: "lease_fixture", tenant_id: "tenant_fixture", amount_cents: 160000,
    failure_code: null, status: "succeeded",
    succeeded_at: "2026-09-26T12:00:00Z", updated_at: "2026-09-26T12:00:00Z",
  };
}

function reconciledCandidateRow() {
  return {
    owner_id: OWNER, id: `opn_${OWNER}_manual_payment_received_rental_payment_fixture`,
    event_type: "manual_payment_received", status: "queued", attempt_count: 0,
    first_attempted_at: null, last_attempted_at: null, charge_id: "charge_fixture",
    payload: { tenant_name: "Test Tenant", amount_cents: 160000, is_autopay: false, failure_code: null },
  };
}

function upcomingScanSequences() {
  return {
    rental_autopay_enrollments: [qb({ data: [ENROLLMENT], error: null })],
    rent_charges: [qb({ data: [chargeRow()], error: null })],
    rental_lease_tenants: [qb({ data: LEASE_TENANTS, error: null })],
  };
}

function emptyScanSequences() {
  return {
    rental_autopay_enrollments: [qb({ data: [], error: null })],
    rent_charges: [qb({ data: [], error: null })],
  };
}

beforeEach(() => {
  process.env.CRON_SECRET = "test-secret";
  delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
  delete process.env.OWNER_PAYMENT_NOTIFICATION_EMAIL;
  vi.clearAllMocks();
});

describe("owner payment notifications cron", () => {
  it("rejects callers without the cron secret", async () => {
    const response = await GET(new Request("https://test/api"));
    expect(response.status).toBe(401);
  });

  it("queues the upcoming-autopay notice and, with sending disabled, logs what would have been sent", async () => {
    const upsertNode = qb({ data: [{ id: "opn_x" }], error: null }); // queue upsert: inserted
    const db = sequenceDb({
      ...upcomingScanSequences(),
      rental_payments: [qb({ data: [], error: null })], // reconciler: nothing to heal
      rental_owner_notifications: [
        upsertNode,
        qb({ data: [], error: null }), // delivery candidates: skipped_disabled rows are never candidates
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.sendingEnabled).toBe(false);
    expect(body.upcomingDetected).toBe(1);
    expect(body.queued).toBe(0);
    expect(body.alreadyQueued).toBe(0);
    // Detection-time disposition: the row entered as terminal skipped_disabled.
    expect(upsertNode.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "upcoming_autopay", status: "skipped_disabled" }),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
    expect(body.skippedDisabled).toBe(1);
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
    expect(createResendRentalEmailProvider).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      "Owner payment notification (sending disabled) would send",
      expect.objectContaining({ to: "Brandykaymorgan@gmail.com", subject: expect.stringContaining("Upcoming autopay") }),
    );
    logSpy.mockRestore();
  });

  it("sends via Resend when the enable flag is on", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn().mockResolvedValue({ messageId: "re_123" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const claimNode = qb({ data: [{ id: "opn_x" }], error: null }); // claim: won
    const outcomeNode = qb({ data: [{ id: "opn_x" }], error: null }); // outcome: recorded
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0, charge_type: "rent", due_date: isoTodayPlus(3) }, error: null }), // live recheck
      ],
      rental_payments: [qb({ data: [], error: null })], // reconciler: nothing to heal
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }), // candidates
        claimNode,
        outcomeNode,
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.sendingEnabled).toBe(true);
    expect(body.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      recipient: "Brandykaymorgan@gmail.com",
      senderName: "FORGE Rental Manager",
      id: expect.stringContaining("owner-notify-"),
    }));
    // The claim wrote a unique token with an atomic compare-and-swap ...
    const claimUpdate = claimNode.update.mock.calls[0][0];
    expect(claimUpdate.claim_token).toMatch(/^claim_/);
    expect(claimNode.eq).toHaveBeenCalledWith("status", "queued");
    expect(claimNode.eq).toHaveBeenCalledWith("attempt_count", 0);
    expect(claimNode.is).toHaveBeenCalledWith("last_attempted_at", null);
    // ... and the outcome was fenced to that token, then cleared.
    expect(outcomeNode.eq).toHaveBeenCalledWith("claim_token", claimUpdate.claim_token);
    expect(outcomeNode.update.mock.calls[0][0]).toMatchObject({ status: "sent", claim_token: null });
  });

  it("does not double-queue an already-queued upcoming notice", async () => {
    const db = sequenceDb({
      ...upcomingScanSequences(),
      rental_payments: [qb({ data: [], error: null })], // reconciler: nothing to heal
      rental_owner_notifications: [
        qb({ data: [], error: null }), // upsert hit the dedup conflict: nothing inserted
        qb({ data: [], error: null }), // no delivery candidates
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.queued).toBe(0);
    expect(body.alreadyQueued).toBe(1);
    expect(body.reconciled).toBe(0);
    expect(body.alreadyReconciled).toBe(0);
  });

  it("supersedes the upcoming notice when the charge was paid before delivery", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });
    const outcomeNode = qb({ data: [{ id: "opn_x" }], error: null }); // outcome: recorded
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 160000, charge_type: "rent", due_date: isoTodayPlus(3) }, error: null }), // recheck: paid
      ],
      rental_payments: [qb({ data: [], error: null })], // reconciler: nothing to heal
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
        outcomeNode,
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.superseded).toBe(1);
    expect(body.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
    expect(outcomeNode.update.mock.calls[0][0]).toMatchObject({ status: "superseded" });
  });

  it("supersedes the upcoming notice when the charge is no longer collectible", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "void", amount_cents: 160000, paid_amount_cents: 0, charge_type: "rent", due_date: isoTodayPlus(3) }, error: null }), // recheck: voided
      ],
      rental_payments: [qb({ data: [], error: null })],
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.superseded).toBe(1);
    expect(body.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("supersedes the upcoming notice when the charge type is no longer autopay-collectible", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0, charge_type: "damage", due_date: isoTodayPlus(3) }, error: null }), // recheck: ad-hoc type
      ],
      rental_payments: [qb({ data: [], error: null })],
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.superseded).toBe(1);
    expect(body.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("supersedes the upcoming notice when the due date changed after detection", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0, charge_type: "rent", due_date: isoTodayPlus(10) }, error: null }), // recheck: moved
      ],
      rental_payments: [qb({ data: [], error: null })],
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.superseded).toBe(1);
    expect(body.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("supersedes the upcoming notice when the autopay enrollment is no longer active", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn();
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      rental_autopay_enrollments: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "cancelled" }, error: null }), // recheck: enrollment gone
      ],
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0, charge_type: "rent", due_date: isoTodayPlus(3) }, error: null }), // recheck: still owed
      ],
      rental_payments: [qb({ data: [], error: null })],
      rental_owner_notifications: [
        qb({ data: [queuedRowWithEnrollment()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }),
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();
    expect(body.superseded).toBe(1);
    expect(body.sent).toBe(0);
    expect(send).not.toHaveBeenCalled();
  });

  it("dry run detects without writing", async () => {
    const db = sequenceDb(upcomingScanSequences());
    createRentalWebhookClient.mockReturnValue(db);
    const response = await GET(authedRequest("https://test/api?dryRun=true"));
    const body = await response.json();
    expect(body.dryRun).toBe(true);
    expect(body.upcomingDetected).toBe(1);
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });

  it("pages the enrollment and charge scans past the PostgREST row cap", async () => {
    const manyEnrollments = Array.from({ length: 1000 }, (_, i) => ({
      id: `enr_${i}`, owner_id: OWNER, lease_id: `lease_${i}`,
    }));
    const enrollmentPage1 = qb({ data: manyEnrollments, error: null });
    const enrollmentPage2 = qb({ data: [], error: null });
    const db = sequenceDb({
      rental_autopay_enrollments: [enrollmentPage1, enrollmentPage2],
      rent_charges: [qb({ data: [], error: null })],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest("https://test/api?dryRun=true"));
    const body = await response.json();

    expect(body.upcomingDetected).toBe(0);
    expect(db.from.mock.calls.filter(([table]) => table === "rental_autopay_enrollments")).toHaveLength(2);
    expect(enrollmentPage1.range).toHaveBeenCalledWith(0, 999);
    expect(enrollmentPage2.range).toHaveBeenCalledWith(1000, 1999);
  });

  it("reclaims a stale sending row with a unique claim token", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn().mockResolvedValue({ messageId: "re_456" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const staleRow = {
      ...queuedRow(),
      status: "sending",
      attempt_count: 1,
      last_attempted_at: new Date(Date.now() - 3600_000).toISOString(),
      event_type: "manual_payment_received",
      charge_id: null,
    };
    const claimNode = qb({ data: [{ id: staleRow.id }], error: null }); // claim: won the race
    const db = sequenceDb({
      ...emptyScanSequences(),
      rental_payments: [qb({ data: [], error: null })],
      rental_owner_notifications: [
        qb({ data: [staleRow], error: null }), // candidates: stale beyond the 30-minute window
        claimNode,
        qb({ data: [{ id: staleRow.id }], error: null }), // outcome: recorded
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
    const claimUpdate = claimNode.update.mock.calls[0][0];
    expect(claimUpdate.claim_token).toMatch(/^claim_/);
    // The compare-and-swap covered the full pre-claim state, including the
    // non-null last_attempted_at (NULL-safe equality).
    expect(claimNode.eq).toHaveBeenCalledWith("status", "sending");
    expect(claimNode.eq).toHaveBeenCalledWith("attempt_count", 1);
    expect(claimNode.eq).toHaveBeenCalledWith("last_attempted_at", staleRow.last_attempted_at);
    expect(claimNode.is).not.toHaveBeenCalled();
  });

  it("does not count a send when the outcome write is fenced out by a newer claim", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn().mockResolvedValue({ messageId: "re_789" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rent_charges: [
        qb({ data: [], error: null }), // scan
        qb({ data: { status: "due", amount_cents: 160000, paid_amount_cents: 0, charge_type: "rent", due_date: isoTodayPlus(3) }, error: null }), // recheck: owed
      ],
      rental_payments: [qb({ data: [], error: null })],
      rental_owner_notifications: [
        qb({ data: [queuedRow()], error: null }),
        qb({ data: [{ id: "opn_x" }], error: null }), // claim: won
        qb({ data: [], error: null }), // outcome: zero rows — reclaimed mid-flight, belongs to the new claimant
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    // The provider call happened, but the DB outcome belongs to the newer
    // claimant: this run must not record or count a send it no longer owns.
    expect(send).toHaveBeenCalledTimes(1);
    expect(body.sent).toBe(0);
    expect(body.failed).toBe(0);
  });

  it("reconciles a terminal payment the webhook failed to queue", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const send = vi.fn().mockResolvedValue({ messageId: "re_recon" });
    createResendRentalEmailProvider.mockReturnValue({ send });
    const reconcileUpsert = qb({ data: [{ id: `opn_${OWNER}_manual_payment_received_rental_payment_fixture` }], error: null });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rental_payments: [qb({ data: [terminalPaymentRow()], error: null })], // reconciler scan: one un-notified payment
      rental_autopay_attempts: [qb({ data: [], error: null })], // no autopay attempt: manual payment
      rental_tenants: [qb({ data: [{ id: "tenant_fixture", display_name: "Test Tenant" }], error: null })],
      rental_owner_notifications: [
        qb({ data: [], error: null }), // reconciler: no existing notification row
        reconcileUpsert,
        qb({ data: [reconciledCandidateRow()], error: null }), // delivery candidates
        qb({ data: [{ id: "opn_x" }], error: null }), // claim
        qb({ data: [{ id: "opn_x" }], error: null }), // outcome
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.reconciled).toBe(1);
    expect(body.alreadyReconciled).toBe(0);
    expect(reconcileUpsert.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          event_type: "manual_payment_received",
          status: "queued",
          payment_id: "rental_payment_fixture",
        }),
      ]),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
    // The reconciled row is delivered by the same run.
    expect(body.sent).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not re-queue a terminal payment that already has a notification row", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    const db = sequenceDb({
      ...emptyScanSequences(),
      rental_payments: [qb({ data: [terminalPaymentRow()], error: null })],
      rental_autopay_attempts: [qb({ data: [], error: null })],
      rental_tenants: [qb({ data: [{ id: "tenant_fixture", display_name: "Test Tenant" }], error: null })],
      rental_owner_notifications: [
        qb({ data: [{ id: `opn_${OWNER}_manual_payment_received_rental_payment_fixture` }], error: null }), // already notified
        qb({ data: [], error: null }), // delivery candidates
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.reconciled).toBe(0);
    expect(body.alreadyReconciled).toBe(1);
    expect(body.sent).toBe(0);
  });

  it("reconciles terminal payments as skipped_disabled when sending is off at detection", async () => {
    const reconcileUpsert = qb({ data: [{ id: `opn_${OWNER}_manual_payment_received_rental_payment_fixture` }], error: null });
    const db = sequenceDb({
      ...emptyScanSequences(),
      rental_payments: [qb({ data: [terminalPaymentRow()], error: null })],
      rental_autopay_attempts: [qb({ data: [], error: null })],
      rental_tenants: [qb({ data: [{ id: "tenant_fixture", display_name: "Test Tenant" }], error: null })],
      rental_owner_notifications: [
        qb({ data: [], error: null }), // no existing notification row
        reconcileUpsert,
        qb({ data: [], error: null }), // delivery candidates: skipped_disabled rows never deliver
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.reconciled).toBe(0);
    expect(body.skippedDisabled).toBe(1);
    expect(body.wouldSend).toBe(1);
    expect(body.sent).toBe(0);
    expect(reconcileUpsert.upsert).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ status: "skipped_disabled" })]),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
    expect(logSpy).toHaveBeenCalledWith(
      "Owner payment notification (sending disabled) would send",
      expect.objectContaining({ subject: expect.stringContaining("Tenant payment received") }),
    );
    logSpy.mockRestore();
  });
});
