import { describe, expect, it, vi } from "vitest";
import {
  buildReceiptDeliveryRow,
  queuePaymentReceiptNotificationForWebhookEvent,
} from "./queuePaymentReceiptNotification.js";

// Obvious fixtures only — never real borrower or financial data.
const PAYMENT = {
  owner_id: "owner_fixture",
  id: "pf_payment_fixture",
  account_id: "pf_acct_fixture",
  borrower_id: "pf_brw_fixture",
  amount_cents: 50000,
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

function mockDb({ borrowerEmail = "borrower@example.com" } = {}) {
  const deliveries = chain({ error: null });
  const db = {
    from: vi.fn((table) => {
      if (table === "private_financing_borrowers")
        return chain({ data: borrowerEmail ? { email: borrowerEmail } : null, error: null });
      if (table === "private_financing_payment_receipt_deliveries") return deliveries;
      throw new Error(`unexpected table ${table}`);
    }),
  };
  return { db, deliveries };
}

describe("buildReceiptDeliveryRow", () => {
  const base = {
    payment: PAYMENT,
    recipientType: "owner",
    recipientEmail: "owner@example.com",
    sendingEnabled: true,
    ownerAllowed: true,
    borrowerAllowed: true,
  };

  it("queues when sending is enabled and both allowlists pass", () => {
    const row = buildReceiptDeliveryRow(base);
    expect(row.status).toBe("queued");
    expect(row.id).toBe("pf_receipt_owner_fixture_pf_payment_fixture_owner");
    expect(row.failure_reason).toBeNull();
  });

  it("is terminally skipped when sending is disabled at detection", () => {
    const row = buildReceiptDeliveryRow({ ...base, sendingEnabled: false });
    expect(row.status).toBe("skipped_disabled");
  });

  it("is terminally skipped when the owner is not allowlisted", () => {
    const row = buildReceiptDeliveryRow({ ...base, ownerAllowed: false });
    expect(row.status).toBe("skipped_disabled");
  });

  it("is terminally skipped when the borrower is not on the receipt allowlist", () => {
    const row = buildReceiptDeliveryRow({ ...base, borrowerAllowed: false });
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("Borrower not allowlisted");
  });

  it("fails closed when the borrower allowlist is absent", () => {
    const { borrowerAllowed, ...withoutGate } = base;
    const row = buildReceiptDeliveryRow(withoutGate);
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("Borrower not allowlisted");
  });

  it("is terminally skipped when the recipient email is missing", () => {
    const row = buildReceiptDeliveryRow({ ...base, recipientEmail: null });
    expect(row.status).toBe("skipped_disabled");
    expect(row.failure_reason).toContain("email");
  });

  it("produces distinct ids per recipient type", () => {
    const owner = buildReceiptDeliveryRow(base);
    const borrower = buildReceiptDeliveryRow({ ...base, recipientType: "borrower" });
    expect(owner.id).not.toBe(borrower.id);
  });
});

describe("queuePaymentReceiptNotificationForWebhookEvent", () => {
  it("queues owner and borrower rows with deterministic ids", async () => {
    const { db, deliveries } = mockDb();
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, PAYMENT, {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedBorrowerIds: ["pf_brw_fixture"],
    });
    expect(result.queued).toBe(2);
    expect(deliveries.upsert).toHaveBeenCalledTimes(2);
    const rows = deliveries.upsert.mock.calls.map((call) => call[0]);
    expect(rows.map((row) => row.recipient_type).sort()).toEqual(["borrower", "owner"]);
    expect(rows[0].id).toContain("pf_payment_fixture");
    for (const row of rows) {
      expect(deliveries.upsert).toHaveBeenCalledWith(row, {
        onConflict: "owner_id,payment_id,recipient_type",
        ignoreDuplicates: true,
      });
    }
  });

  it("skips both rows when the borrower is not on the receipt allowlist", async () => {
    const { db, deliveries } = mockDb();
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, PAYMENT, {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedBorrowerIds: ["pf_brw_someone_else"],
    });
    expect(result.queued).toBe(0);
    const rows = deliveries.upsert.mock.calls.map((call) => call[0]);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.status).toBe("skipped_disabled");
      expect(row.failure_reason).toContain("Borrower not allowlisted");
    }
  });

  it("fails closed with no borrower allowlist at all", async () => {
    delete process.env.PF_RECEIPT_BORROWER_IDS;
    const { db, deliveries } = mockDb();
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, PAYMENT, {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
    });
    expect(result.queued).toBe(0);
    const rows = deliveries.upsert.mock.calls.map((call) => call[0]);
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.status).toBe("skipped_disabled");
  });

  it("marks the borrower row skipped when the borrower has no email", async () => {
    const { db, deliveries } = mockDb({ borrowerEmail: null });
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, PAYMENT, {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedBorrowerIds: ["pf_brw_fixture"],
    });
    expect(result.queued).toBe(1);
    const borrowerRow = deliveries.upsert.mock.calls
      .map((call) => call[0])
      .find((row) => row.recipient_type === "borrower");
    expect(borrowerRow.status).toBe("skipped_disabled");
  });

  it("never throws — a db failure is logged and swallowed", async () => {
    const db = {
      from: vi.fn(() => {
        throw new Error("db down");
      }),
    };
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, PAYMENT, {
      sendingEnabled: true,
      allowedOwnerIds: ["owner_fixture"],
      allowedBorrowerIds: ["pf_brw_fixture"],
    });
    expect(result.queueError).toBe(true);
  });
});
