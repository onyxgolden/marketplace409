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
      if (table === "rental_leases") return chain({ data: { property_id: "308-paula", unit_id: null }, error: null });
      if (table === "rental_units") return chain({ data: null, error: null });
      if (table === "rental_owner_notifications") return notifications;
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { db, notifications };
}

const succeeded = { eventType: "payment_intent.succeeded", paymentId: PAYMENT.id, occurredAt: "2026-09-26T12:00:00Z" };
const failed = { eventType: "payment_intent.payment_failed", paymentId: PAYMENT.id, occurredAt: "2026-09-26T12:00:00Z" };
const processing = { eventType: "payment_intent.processing", paymentId: PAYMENT.id, occurredAt: "2026-09-26T12:00:00Z" };
const OPTS = { sendingEnabled: true, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] };

describe("queueOwnerPaymentNotificationForWebhookEvent", () => {
  it("queues payment_completed for a succeeded autopay payment", async () => {
    const { db, notifications } = mockDb({ attempt: { id: "attempt_1" } });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] });
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("payment_completed");
    expect(notifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment_completed", payment_id: PAYMENT.id, status: "queued" }),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
  });

  it("queues manual_payment_received for a succeeded voluntary payment", async () => {
    const { db } = mockDb({ attempt: null });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] });
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("manual_payment_received");
  });

  it("queues payment_failed for a failed payment", async () => {
    const { db } = mockDb();
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, failed, "live", { sendingEnabled: true, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] });
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("payment_failed");
  });

  it("queues payment_initiated when an autopay debit is triggered", async () => {
    const { db, notifications } = mockDb({ attempt: { id: "attempt_1" } });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, processing, "live", OPTS);
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("payment_initiated");
    expect(notifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ event_type: "payment_initiated", payment_id: PAYMENT.id, status: "queued" }),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
  });

  it("does not queue an initiated notice for a manual payment entering processing", async () => {
    const { db } = mockDb({ attempt: null });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, processing, "live", OPTS);
    expect(result).toEqual({ queued: false, reason: "unresolved_event" });
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });

  it("keeps the initiated notice idempotent and distinct from the later completed notice", async () => {
    const first = mockDb({ attempt: { id: "attempt_1" } });
    const second = mockDb({ attempt: { id: "attempt_1" } });
    const initiated = await queueOwnerPaymentNotificationForWebhookEvent(first.db, processing, "live", OPTS);
    const retry = await queueOwnerPaymentNotificationForWebhookEvent(second.db, processing, "live", OPTS);
    const completed = await queueOwnerPaymentNotificationForWebhookEvent(mockDb({ attempt: { id: "attempt_1" } }).db, succeeded, "live", OPTS);
    // A retried processing event resolves to the same notification id (the
    // upsert dedups it); the later succeeded event gets its own id.
    expect(retry.notificationId).toBe(initiated.notificationId);
    expect(completed.notificationId).not.toBe(initiated.notificationId);
    expect(completed.eventType).toBe("payment_completed");
  });

  it("no-ops for non-payment event types without touching the outbox", async () => {
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
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] });
    expect(result.queued).toBe(false);
  });

  it("writes skipped_disabled and logs the would-send email when sending is off at detection", async () => {
    const { db, notifications } = mockDb({ attempt: { id: "attempt_1" } });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: false, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] });
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
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: false, allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"] });
    expect(result).toMatchObject({ queued: false, reason: "sending_disabled" });
    expect(logSpy).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it("defaults the sending flag from the environment when no option is passed", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
    process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = "owner_fixture";
    process.env.RENTAL_NOTIFICATION_TENANT_IDS = "tenant_fixture";
    try {
      const { db } = mockDb();
      const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live");
      expect(result.queued).toBe(true);
    } finally {
      delete process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED;
      delete process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS;
      delete process.env.RENTAL_NOTIFICATION_TENANT_IDS;
    }
  });

  it("blocks queueing for an owner not on the allow-list and writes nothing", async () => {
    const otherPayment = { ...PAYMENT, owner_id: "owner_other_landlord" };
    const { db } = mockDb({ payment: otherPayment });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"], allowedTenantIds: ["tenant_fixture"],
    });
    expect(result).toEqual({ queued: false, reason: "owner_not_allowlisted" });
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });

  it("fails closed when the allow-list is unset: nothing is queued for anyone", async () => {
    const { db } = mockDb({ attempt: { id: "attempt_1" } });
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true });
    expect(result).toEqual({ queued: false, reason: "owner_not_allowlisted" });
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });

  it("defaults the allow-list from the environment when no option is passed", async () => {
    process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = "owner_fixture";
    process.env.RENTAL_NOTIFICATION_TENANT_IDS = "tenant_fixture";
    try {
      const { db } = mockDb({ attempt: { id: "attempt_1" } });
      const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", { sendingEnabled: true });
      expect(result.queued).toBe(true);
      expect(result.eventType).toBe("payment_completed");
    } finally {
      delete process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS;
      delete process.env.RENTAL_NOTIFICATION_TENANT_IDS;
    }
  });
});

describe("tenant allowlist gate (recipient-level rollout restriction)", () => {
  it("refuses a tenant who is not on the notification allowlist and writes nothing", async () => {
    const { db } = mockDb();
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedTenantIds: ["someone_else"],
    });
    expect(result).toEqual({ queued: false, reason: "tenant_not_allowlisted" });
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });

  it("fails closed when the tenant allowlist is empty", async () => {
    const { db } = mockDb();
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedTenantIds: [],
    });
    expect(result).toEqual({ queued: false, reason: "tenant_not_allowlisted" });
    expect(db.from).not.toHaveBeenCalledWith("rental_owner_notifications");
  });

  it("fails closed when the tenant allowlist is unset", async () => {
    const { db } = mockDb();
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
    });
    expect(result).toEqual({ queued: false, reason: "tenant_not_allowlisted" });
  });
});

describe("resolvePropertyLabel", () => {
  it("prefers the unit label when the lease names a unit", async () => {
    const { resolvePropertyLabel } = await import("./queueOwnerPaymentNotification.js");
    const db = {
      from: vi.fn((table) => {
        if (table === "rental_leases")
          return chain({ data: { property_id: "308-paula", unit_id: "unit_1" }, error: null });
        if (table === "rental_units")
          return chain({ data: { label: "Unit A — 308 Paula" }, error: null });
        throw new Error(`unexpected table ${table}`);
      }),
    };
    await expect(
      resolvePropertyLabel(db, { ownerId: "owner_fixture", leaseId: "lease_fixture" }),
    ).resolves.toBe("Unit A — 308 Paula");
  });

  it("humanizes the property slug when no unit label is available", async () => {
    const { resolvePropertyLabel } = await import("./queueOwnerPaymentNotification.js");
    const db = {
      from: vi.fn((table) => {
        if (table === "rental_leases")
          return chain({ data: { property_id: "308-paula", unit_id: null }, error: null });
        if (table === "rental_units") return chain({ data: null, error: null });
        throw new Error(`unexpected table ${table}`);
      }),
    };
    await expect(
      resolvePropertyLabel(db, { ownerId: "owner_fixture", leaseId: "lease_fixture" }),
    ).resolves.toBe("308 Paula");
  });

  it("returns null when the lease cannot be resolved", async () => {
    const { resolvePropertyLabel } = await import("./queueOwnerPaymentNotification.js");
    const db = {
      from: vi.fn(() => chain({ data: null, error: null })),
    };
    await expect(
      resolvePropertyLabel(db, { ownerId: "owner_fixture", leaseId: "lease_fixture" }),
    ).resolves.toBeNull();
  });

  it("never throws when the database fails", async () => {
    const { resolvePropertyLabel } = await import("./queueOwnerPaymentNotification.js");
    const db = { from: () => { throw new Error("db down"); } };
    await expect(
      resolvePropertyLabel(db, { ownerId: "owner_fixture", leaseId: "lease_fixture" }),
    ).resolves.toBeNull();
  });

  it("stores the property label in the notification payload", async () => {
    const { db, notifications } = mockDb();
    const result = await queueOwnerPaymentNotificationForWebhookEvent(db, succeeded, "live", {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedTenantIds: ["tenant_fixture"],
    });
    expect(result.queued).toBe(true);
    expect(notifications.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ property_label: "308 Paula" }),
      }),
      { onConflict: "owner_id,id", ignoreDuplicates: true },
    );
  });
});
