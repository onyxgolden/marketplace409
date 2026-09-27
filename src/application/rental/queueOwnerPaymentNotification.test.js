import { describe, expect, it, vi } from "vitest";
import { queueOwnerPaymentNotificationForWebhookEvent } from "./queueOwnerPaymentNotification.js";

// Obvious fixtures only — never real tenant, lease, or financial data.
const PAYMENT = {
  owner_id: "owner_fixture", id: "rental_payment_fixture", charge_id: "charge_fixture",
  lease_id: "lease_fixture", tenant_id: "tenant_fixture", amount_cents: 160000, failure_code: null,
};

function chain(result) {
  const node = {};
  node.select = vi.fn(() => node);
  node.eq = vi.fn(() => node);
  node.upsert = vi.fn(() => node);
  node.maybeSingle = vi.fn(() => Promise.resolve(result));
  // Awaiting a chainable query node resolves the terminal result.
  node.then = (resolve) => resolve(result);
  return node;
}

function mockDb({ payment = PAYMENT, attempt = null, tenantName = "Test Tenant" } = {}) {
  const notifications = chain({ data: [{ id: "opn_x" }], error: null });
  const db = {
    from: vi.fn((table) => {
      if (table === "rental_payments") return chain({ data: payment, error: null });
      if (table === "rental_autopay_attempts") return chain({ data: attempt, error: null });
      if (table === "rental_tenants") {
        return chain({ data: tenantName ? { display_name: tenantName } : null, error: null });
      }
      if (table === "rental_owner_notifications") return notifications;
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { db, notifications };
}

const succeeded = { eventType: "payment_intent.succeeded", paymentId: PAYMENT.id, occurredAt: "2026-09-26T12:00:00Z" };
const failed = { eventType: "payment_intent.payment_failed", paymentId: PAYMENT.id, occurredAt: "2026-09-26T12:00:00Z" };

describe("queueOwnerPaymentNotificationForWebhookEvent", () => {
  it("queues payment_completed for a succeeded autopay payment", async () => {
    const { db, notifications } = mockDb({ attempt: { id: "attempt_1" } });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true });
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("payment_completed");
    expect(notifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment_completed", payment_id: PAYMENT.id, status: "queued" }),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
  });

  it("queues manual_payment_received for a succeeded voluntary payment", async () => {
    const { db } = mockDb({ attempt: null });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true });
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("manual_payment_received");
  });

  it("queues payment_failed for a failed payment", async () => {
    const { db } = mockDb();
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, failed, "live", { sendingEnabled: true });
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("payment_failed");
  });

  it("no-ops for non-terminal, non-rental, and id-less events without touching the outbox", async () => {
    const cases = [
      { eventType: "charge.succeeded", paymentId: PAYMENT.id },
      { eventType: "payment_intent.succeeded", paymentId: "pf_payment_1" },
      { eventType: "payment_intent.succeeded", paymentId: "reservation_payment_1" },
      { eventType: "payment_intent.succeeded", paymentId: null },
      { eventType: "payment_intent.processing", paymentId: PAYMENT.id },
    ];
    for (const normalized of cases) {
      const { db } = mockDb();
      const result = await queueOwnerPaymentNotificationForWebhookEvent(db, normalized, "live");
      expect(result.queued).toBe(false);
      expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
    }
  });

  it("skips quietly when the payment row is not found", async () => {
    const { db } = mockDb({ payment: null });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live");
    expect(result).toEqual({ queued: false, reason: "payment_not_found" });
  });

  it("never throws: a db failure is swallowed so webhook processing survives", async () => {
    const db = { from: vi.fn(() => { throw new Error("db down"); }) };
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true });
    expect(result.queued).toBe(false);
  });

  it("writes skipped_disabled and logs the would-send email when sending is off at detection", async () => {
    const { db, notifications } = mockDb({ attempt: { id: "attempt_1" } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: false });
    expect(result).toMatchObject({ queued: false, reason: "sending_disabled", eventType: "payment_completed", status: "skipped_disabled" });
    expect(notifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment_completed", status: "skipped_disabled" }),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
    // Detection-time disposition is audited: what WOULD have been sent.
    expect(logSpy).toHaveBeenCalledWith(
      "Owner payment notification (sending disabled) would send",
      expect.objectContaining({
        to: "Brandykaymorgan@gmail.com",
        subject: expect.stringContaining("Autopay completed"),
      }),
    );
    logSpy.mockRestore();
  });

  it("does not log when a disabled detection hits the dedup conflict", async () => {
    const db = {
      from: vi.fn((table) => {
        if (table === "rental_payments") return chain({ data: PAYMENT, error: null });
        if (table === "rental_autopay_attempts") return chain({ data: null, error: null });
        if (table === "rental_tenants") return chain({ data: { display_name: "Test Tenant" }, error: null });
        if (table === "rental_owner_notifications") return chain({ data: [], error: null });
        throw new Error(`unexpected table ${table}`);
      }),
    };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: false });
    expect(result).toMatchObject({ queued: false, reason: "sending_disabled" });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("defaults the sending flag from the environment when no option is passed", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    try {
      const { db } = mockDb();
      const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live");
      expect(result.queued).toBe(true);
    } finally {
      delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
    }
  });
});
