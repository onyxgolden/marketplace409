import { describe, expect, it, vi } from "vitest";
import {
  buildTenantReceiptDeliveryRow,
  queueTenantPaymentReceiptForWebhookEvent,
} from "./queueTenantPaymentReceipt.js";

// Obvious fixtures only — never real tenant, lease, or financial data.
const PAYMENT = {
  owner_id: "owner_fixture",
  id: "rental_payment_fixture",
  lease_id: "lease_fixture",
  tenant_id: "tenant_fixture",
  amount_cents: 160000,
  status: "succeeded",
  provider_payment_id: "pi_fixture",
};

function chain(result) {
  const node = {};
  node.select = vi.fn(() => node);
  node.eq = vi.fn(() => node);
  node.maybeSingle = vi.fn(() => Promise.resolve(result));
  node.upsert = vi.fn(() => Promise.resolve({ error: null }));
  node.then = (resolve) => resolve(result);
  return node;
}

const OPTIONS = {
  sendingEnabled: true,
  allowedOwnerIds: ["owner_fixture"],
  allowedTenantIds: ["tenant_fixture"],
};

function mockDb({ payment = PAYMENT, tenantEmail = "tenant@example.com" } = {}) {
  const deliveries = chain({ error: null });
  const db = {
    from: vi.fn((table) => {
      if (table === "rental_payments") return chain({ data: payment, error: null });
      if (table === "rental_tenants")
        return chain({ data: tenantEmail ? { email: tenantEmail } : null, error: null });
      if (table === "rental_tenant_receipt_deliveries") return deliveries;
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { db, deliveries };
}

describe("buildTenantReceiptDeliveryRow", () => {
  const base = {
    payment: PAYMENT,
    tenantEmail: "tenant@example.com",
    sendingEnabled: true,
    ownerAllowed: true,
    tenantAllowed: true,
  };

  it("queues when sending is enabled and both allowlists pass", () => {
    const row = buildTenantReceiptDeliveryRow(base);
    expect(row.status).toBe("queued");
    expect(row.id).toBe("rtr_owner_fixture_rental_payment_fixture");
    expect(row.recipient_email).toBe("tenant@example.com");
    expect(row.amount_cents).toBe(160000);
    expect(row.transaction_ref).toBe("pi_fixture");
    expect(row.failure_reason).toBeNull();
  });

  it("is terminally skipped when sending is disabled at detection", () => {
    const row = buildTenantReceiptDeliveryRow({ ...base, sendingEnabled: false });
    expect(row.status).toBe("skipped_disabled");
  });

  it("is terminally skipped when the owner is not allowlisted", () => {
    const row = buildTenantReceiptDeliveryRow({ ...base, ownerAllowed: false });
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("Owner not allowlisted");
  });

  it("is terminally skipped when the tenant is not on the receipt allowlist", () => {
    const row = buildTenantReceiptDeliveryRow({ ...base, tenantAllowed: false });
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("Tenant not allowlisted");
  });

  it("fails closed when the tenant allowlist gate is absent", () => {
    const { tenantAllowed, ...withoutGate } = base;
    const row = buildTenantReceiptDeliveryRow(withoutGate);
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("Tenant not allowlisted");
  });

  it("is terminally skipped when the tenant email is missing", () => {
    const row = buildTenantReceiptDeliveryRow({ ...base, tenantEmail: null });
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("email");
  });
});

describe("queueTenantPaymentReceiptForWebhookEvent", () => {
  it("queues a receipt for a succeeded allowlisted tenant payment", async () => {
    const { db, deliveries } = mockDb();
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rental_payment_fixture", providerMode: "test" },
      OPTIONS,
    );
    expect(result.queued).toBe(true);
    expect(result.status).toBe("queued");
    expect(deliveries.upsert).toHaveBeenCalledTimes(1);
    const upserted = deliveries.upsert.mock.calls[0][0];
    expect(upserted.status).toBe("queued");
    // First-write-wins: a redelivery or reconciler pass can never overwrite
    // an existing delivery's state.
    expect(deliveries.upsert).toHaveBeenCalledWith(upserted, {
      onConflict: "owner_id,payment_id",
      ignoreDuplicates: true,
    });
  });

  it("no-ops for non-rental payment ids", async () => {
    const { db, deliveries } = mockDb();
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "pf_payment_fixture", providerMode: "test" },
      OPTIONS,
    );
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("not_notifiable");
    expect(deliveries.upsert).not.toHaveBeenCalled();
  });

  it("refuses a tenant who is not on the receipt allowlist", async () => {
    const { db, deliveries } = mockDb();
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rental_payment_fixture", providerMode: "test" },
      { ...OPTIONS, allowedTenantIds: ["someone_else"] },
    );
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("tenant_not_allowlisted");
    expect(deliveries.upsert).not.toHaveBeenCalled();
  });

  it("refuses when the tenant allowlist is empty — fails closed", async () => {
    const { db, deliveries } = mockDb();
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rental_payment_fixture", providerMode: "test" },
      { ...OPTIONS, allowedTenantIds: [] },
    );
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("tenant_not_allowlisted");
    expect(deliveries.upsert).not.toHaveBeenCalled();
  });

  it("refuses an owner who is not allowlisted", async () => {
    const { db, deliveries } = mockDb();
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rental_payment_fixture", providerMode: "test" },
      { ...OPTIONS, allowedOwnerIds: ["other_owner"] },
    );
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("owner_not_allowlisted");
    expect(deliveries.upsert).not.toHaveBeenCalled();
  });

  it("no-ops when the payment query returns nothing (e.g. not succeeded — the status filter)", async () => {
    // The .eq("status", "succeeded") filter means a pending payment yields no
    // row; the mock models that by returning null.
    const { db, deliveries } = mockDb({ payment: null });
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rental_payment_fixture", providerMode: "test" },
      OPTIONS,
    );
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("payment_not_found_or_not_succeeded");
    expect(deliveries.upsert).not.toHaveBeenCalled();
  });

  it("never throws when the database fails", async () => {
    const db = { from: () => { throw new Error("boom"); } };
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rental_payment_fixture", providerMode: "test" },
      OPTIONS,
    );
    expect(result.queued).toBe(false);
    expect(result.reason).toBe("error");
  });
});
