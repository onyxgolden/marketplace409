// No-send dry-run acceptance harness for payment-received notifications.
//
// Covers Jason's 2026-09-29 acceptance criteria for the receipt-email dry run:
//   1. Only allowlisted recipients are eligible (Ethan/Tyler PF borrowers,
//      Brandy as owner recipient, Eric/308-Paula rental lane).
//   2. Shows who would receive each notification and why (decision matrix).
//   3. Proves everyone else is excluded.
//   4. Covers personal loans and rentals, including autopay.
//   5. Verifies quiet hours, duplicate prevention, and disabled-notification behavior.
//   6. Guarantees dry-run mode sends no emails and makes no database changes.
//
// ALL fixtures are synthetic — obvious fixture ids, emails, and amounts. Nothing here is
// real borrower, tenant, or financial data.
import { describe, expect, it, vi } from "vitest";
import { queuePaymentReceiptNotificationForWebhookEvent } from "./private-financing/queuePaymentReceiptNotification.js";
import { queueTenantPaymentReceiptForWebhookEvent } from "./rental/queueTenantPaymentReceipt.js";
import { queueOwnerPaymentNotificationForWebhookEvent } from "./rental/queueOwnerPaymentNotification.js";
import {
  DEFAULT_OWNER_NOTIFICATION_EMAIL,
} from "@/domains/owner-notifications/ownerNotificationConfig.js";
import { isQuietHours } from "@/domains/owner-notifications/ownerPaymentNotifications.js";

// ---------------------------------------------------------------- fixtures ---
const OWNER = "owner_fixture";
const OWNER_OTHER = "owner_fixture_stranger";

// PF borrower lane: two allowlisted (Ethan/Tyler equivalents), one stranger.
const BRW_ETHAN = "pf_brw_fixture_ethan";
const BRW_TYLER = "pf_brw_fixture_tyler";
const BRW_STRANGER = "pf_brw_fixture_stranger";

// Rental lane: one allowlisted tenant (Eric/308-Paula equivalent), one stranger.
const TENANT_ERIC = "rental_tenant_fixture_eric";
const TENANT_STRANGER = "rental_tenant_fixture_stranger";
const LEASE_308_PAULA = "lease_fixture_308paula";

const PF_ALLOW = {
  sendingEnabled: true,
  allowedOwnerIds: [OWNER],
  allowedBorrowerIds: [BRW_ETHAN, BRW_TYLER],
  dryRun: true,
};
const RENTAL_ALLOW = {
  sendingEnabled: true,
  allowedOwnerIds: [OWNER],
  allowedTenantIds: [TENANT_ERIC],
  dryRun: true,
};

function pfPayment(borrowerId, id = "pf_payment_fixture_1") {
  return {
    owner_id: OWNER,
    id,
    account_id: "pf_acct_fixture",
    borrower_id: borrowerId,
  };
}

// ------------------------------------------------------- recording mock db ---
// Records every write (upsert/update/insert/delete) so tests can prove ZERO
// database changes in dry-run mode. Reads resolve from the `rows` map.
function makeDb(rows = {}) {
  const writes = [];
  const resolveRows = (table, single) => {
    const configured = rows[table];
    const value = typeof configured === "function" ? configured() : configured;
    if (value === undefined) return single ? null : [];
    if (single) return Array.isArray(value) ? (value[0] ?? null) : value;
    return Array.isArray(value) ? value : [value];
  };
  const node = (table) => {
    const q = {
      select: () => q,
      eq: () => q,
      in: () => q,
      order: () => q,
      gte: () => q,
      or: () => q,
      is: () => q,
      range: () => q,
      maybeSingle: () => Promise.resolve({ data: resolveRows(table, true), error: null }),
      upsert: (row, opts) => {
        writes.push({ table, method: "upsert", row, opts });
        return q;
      },
      update: (patch) => {
        writes.push({ table, method: "update", patch });
        return q;
      },
      insert: (row) => {
        writes.push({ table, method: "insert", row });
        return q;
      },
      delete: () => {
        writes.push({ table, method: "delete" });
        return q;
      },
      then: (resolve) => resolve({ data: resolveRows(table, false), error: null }),
    };
    return q;
  };
  return { db: { from: vi.fn((table) => node(table)) }, writes };
}

function rentalPaymentRow(tenantId, id = "rentpay_fixture_1") {
  return {
    owner_id: OWNER,
    id,
    charge_id: "charge_fixture",
    lease_id: LEASE_308_PAULA,
    tenant_id: tenantId,
    amount_cents: 77700,
    status: "succeeded",
    provider_payment_id: "pi_fixture_123",
    failure_code: null,
  };
}

function rentalReads({ tenantId, autopay = false, tenantEmail = "tenant-fixture@example.com", tenantName = "Tenant Fixture" }) {
  return {
    rental_payments: rentalPaymentRow(tenantId),
    rental_tenants: tenantEmail === null && tenantName === null
      ? null
      : { email: tenantEmail, display_name: tenantName },
    rental_autopay_attempts: autopay ? { id: "attempt_fixture" } : null,
    rental_leases: { property_id: "308-paula", unit_id: null },
  };
}

// ------------------------------------------------- personal-loan receipts ---
describe("dry run: personal-loan (PF) payment receipts", () => {
  it("Ethan-equivalent borrower, manual payment: Brandy + borrower would be notified", async () => {
    const { db, writes } = makeDb({
      private_financing_borrowers: { email: "ethan-fixture@example.com" },
    });
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), PF_ALLOW);

    expect(result.dryRun).toBe(true);
    expect(result.queued).toBe(2);
    expect(writes).toHaveLength(0);

    const byType = Object.fromEntries(result.rows.map((row) => [row.recipient_type, row]));
    expect(byType.owner.status).toBe("queued");
    expect(byType.owner.recipient_email).toBe(DEFAULT_OWNER_NOTIFICATION_EMAIL);
    expect(byType.owner.failure_reason).toBeNull();
    expect(byType.borrower.status).toBe("queued");
    expect(byType.borrower.recipient_email).toBe("ethan-fixture@example.com");
    expect(byType.borrower.failure_reason).toBeNull();
  });

  it("Tyler-equivalent borrower, autopay payment: same eligibility (source is named at send time)", async () => {
    const { db, writes } = makeDb({
      private_financing_borrowers: { email: "tyler-fixture@example.com" },
    });
    const result = await queuePaymentReceiptNotificationForWebhookEvent(
      db,
      pfPayment(BRW_TYLER, "pf_payment_fixture_autopay_1"),
      PF_ALLOW,
    );

    expect(result.dryRun).toBe(true);
    expect(result.queued).toBe(2);
    expect(writes).toHaveLength(0);
    for (const row of result.rows) expect(row.status).toBe("queued");
  });

  it("non-allowlisted borrower: both receipts terminally excluded", async () => {
    const { db, writes } = makeDb({
      private_financing_borrowers: { email: "stranger-fixture@example.com" },
    });
    const result = await queuePaymentReceiptNotificationForWebhookEvent(
      db,
      pfPayment(BRW_STRANGER),
      PF_ALLOW,
    );

    expect(result.queued).toBe(0);
    expect(writes).toHaveLength(0);
    expect(result.rows).toHaveLength(2);
    for (const row of result.rows) {
      expect(row.status).toBe("skipped_disabled");
      expect(row.failure_reason).toContain("Borrower not allowlisted");
    }
  });

  it("non-allowlisted owner: excluded even for an allowlisted borrower", async () => {
    const { db, writes } = makeDb({
      private_financing_borrowers: { email: "ethan-fixture@example.com" },
    });
    const payment = { ...pfPayment(BRW_ETHAN), owner_id: OWNER_OTHER };
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, payment, PF_ALLOW);

    expect(result.queued).toBe(0);
    expect(writes).toHaveLength(0);
    for (const row of result.rows) {
      expect(row.status).toBe("skipped_disabled");
      expect(row.failure_reason).toContain("Owner not allowlisted");
    }
  });

  it("sending disabled at detection: terminally skipped, never deliverable later", async () => {
    const { db, writes } = makeDb({
      private_financing_borrowers: { email: "ethan-fixture@example.com" },
    });
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), {
      ...PF_ALLOW,
      sendingEnabled: false,
    });

    expect(result.queued).toBe(0);
    expect(writes).toHaveLength(0);
    for (const row of result.rows) {
      expect(row.status).toBe("skipped_disabled");
      expect(row.failure_reason).toContain("Sending disabled at detection time");
    }
  });

  it("allowlisted borrower with no email: borrower receipt excluded, Brandy still notified", async () => {
    const { db, writes } = makeDb({ private_financing_borrowers: null });
    const result = await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), PF_ALLOW);

    expect(result.queued).toBe(1);
    expect(writes).toHaveLength(0);
    const byType = Object.fromEntries(result.rows.map((row) => [row.recipient_type, row]));
    expect(byType.owner.status).toBe("queued");
    expect(byType.borrower.status).toBe("skipped_disabled");
    expect(byType.borrower.failure_reason).toContain("email");
  });
});

// ------------------------------------------------------- rental receipts ---
describe("dry run: rental tenant receipts (308 Paula lane)", () => {
  it("Eric-equivalent tenant, manual payment: tenant receipt would be queued", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC }));
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rentpay_fixture_1" },
      RENTAL_ALLOW,
    );

    expect(result.dryRun).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.status).toBe("queued");
    expect(result.row.recipient_email).toBe("tenant-fixture@example.com");
    expect(result.row.tenant_id).toBe(TENANT_ERIC);
    expect(writes).toHaveLength(0);
  });

  it("non-allowlisted tenant: excluded at detection", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_STRANGER }));
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rentpay_fixture_1" },
      RENTAL_ALLOW,
    );

    expect(result.queued).toBe(false);
    expect(result.reason).toBe("tenant_not_allowlisted");
    expect(writes).toHaveLength(0);
  });

  it("non-allowlisted owner: excluded at detection", async () => {
    const rows = rentalReads({ tenantId: TENANT_ERIC });
    rows.rental_payments = { ...rows.rental_payments, owner_id: OWNER_OTHER };
    const { db, writes } = makeDb(rows);
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rentpay_fixture_1" },
      RENTAL_ALLOW,
    );

    expect(result.queued).toBe(false);
    expect(result.reason).toBe("owner_not_allowlisted");
    expect(writes).toHaveLength(0);
  });

  it("sending disabled at detection: receipt terminally skipped", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC }));
    const result = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rentpay_fixture_1" },
      { ...RENTAL_ALLOW, sendingEnabled: false },
    );

    expect(result.queued).toBe(false);
    expect(result.status).toBe("skipped_disabled");
    expect(result.row.failure_reason).toContain("Sending disabled at detection time");
    expect(writes).toHaveLength(0);
  });
});

// -------------------------------------------- rental owner notifications ---
describe("dry run: rental owner notifications (Brandy's confirmations)", () => {
  it("Eric-equivalent tenant, manual payment: Brandy's confirmation would be queued", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC }));
    const result = await queueOwnerPaymentNotificationForWebhookEvent(
      db,
      {
        eventType: "payment_intent.succeeded",
        paymentId: "rentpay_fixture_1",
        occurredAt: "2026-09-29T10:00:00-05:00",
      },
      undefined,
      RENTAL_ALLOW,
    );

    expect(result.dryRun).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("manual_payment_received");
    expect(result.status).toBe("queued");
    expect(result.row.payload.property_label).toBe("308 Paula");
    expect(writes).toHaveLength(0);
  });

  it("Eric-equivalent tenant, autopay payment: autopay completion event", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC, autopay: true }));
    const result = await queueOwnerPaymentNotificationForWebhookEvent(
      db,
      {
        eventType: "payment_intent.succeeded",
        paymentId: "rentpay_fixture_1",
        occurredAt: "2026-09-29T10:00:00-05:00",
      },
      undefined,
      RENTAL_ALLOW,
    );

    expect(result.dryRun).toBe(true);
    expect(result.queued).toBe(true);
    expect(result.eventType).toBe("payment_completed");
    expect(result.row.payload.is_autopay).toBe(true);
    expect(writes).toHaveLength(0);
  });

  it("non-allowlisted tenant: no owner confirmation", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_STRANGER }));
    const result = await queueOwnerPaymentNotificationForWebhookEvent(
      db,
      {
        eventType: "payment_intent.succeeded",
        paymentId: "rentpay_fixture_1",
        occurredAt: "2026-09-29T10:00:00-05:00",
      },
      undefined,
      RENTAL_ALLOW,
    );

    expect(result.queued).toBe(false);
    expect(result.reason).toBe("tenant_not_allowlisted");
    expect(writes).toHaveLength(0);
  });

  it("sending disabled at detection: terminally skipped", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC }));
    const result = await queueOwnerPaymentNotificationForWebhookEvent(
      db,
      {
        eventType: "payment_intent.succeeded",
        paymentId: "rentpay_fixture_1",
        occurredAt: "2026-09-29T10:00:00-05:00",
      },
      undefined,
      { ...RENTAL_ALLOW, sendingEnabled: false },
    );

    expect(result.queued).toBe(false);
    expect(result.reason).toBe("sending_disabled");
    expect(result.status).toBe("skipped_disabled");
    expect(writes).toHaveLength(0);
  });

  it("uses first-write-wins upsert in live mode (redeliveries cannot resurrect rows)", async () => {
    const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC }));
    await queueOwnerPaymentNotificationForWebhookEvent(
      db,
      {
        eventType: "payment_intent.succeeded",
        paymentId: "rentpay_fixture_1",
        occurredAt: "2026-09-29T10:00:00-05:00",
      },
      undefined,
      { ...RENTAL_ALLOW, dryRun: false },
    );
    const upserts = writes.filter((w) => w.table === "rental_owner_notifications");
    expect(upserts).toHaveLength(1);
    expect(upserts[0].opts).toMatchObject({ onConflict: "owner_id,id", ignoreDuplicates: true });
  });
});

// ----------------------------------------------- duplicate prevention ---
// Stateful fakes that honor PostgREST ignoreDuplicates semantics: on conflict,
// the first row wins and later writes are no-ops.
function statefulDeliveriesDb({ table, keyOf, reads }) {
  const store = new Map();
  const writes = [];
  const reader = (t) => {
    const value = reads[t];
    return {
      select: () => reader(t),
      eq: () => reader(t),
      maybeSingle: () => Promise.resolve({ data: value ?? null, error: null }),
    };
  };
  const db = {
    from: (t) => {
      if (t !== table) return reader(t);
      return {
        upsert: (row, opts) => {
          writes.push({ method: "upsert", row, opts });
          const key = keyOf(row);
          if (!(opts?.ignoreDuplicates && store.has(key))) store.set(key, { ...row });
          return Promise.resolve({ error: null });
        },
      };
    },
  };
  return { db, store, writes, keyOf };
}

describe("duplicate prevention: redeliveries never re-notify", () => {
  it("PF: a sent receipt stays sent across webhook redeliveries", async () => {
    const { db, store, writes, keyOf } = statefulDeliveriesDb({
      table: "private_financing_payment_receipt_deliveries",
      keyOf: (row) => `${row.owner_id}:${row.payment_id}:${row.recipient_type}`,
      reads: { private_financing_borrowers: { email: "ethan-fixture@example.com" } },
    });
    const live = { ...PF_ALLOW, dryRun: false };

    await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), live);
    expect(store.size).toBe(2);
    expect(writes[0].opts).toMatchObject({ ignoreDuplicates: true });

    // The cron delivers both rows.
    for (const row of store.values()) row.status = "sent";

    // Stripe redelivers the webhook.
    await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), live);
    for (const row of store.values()) expect(row.status).toBe("sent");
  });

  it("PF: a disabled-at-detection receipt can never be resurrected by a redelivery", async () => {
    const { db, store } = statefulDeliveriesDb({
      table: "private_financing_payment_receipt_deliveries",
      keyOf: (row) => `${row.owner_id}:${row.payment_id}:${row.recipient_type}`,
      reads: { private_financing_borrowers: { email: "ethan-fixture@example.com" } },
    });

    await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), {
      ...PF_ALLOW,
      dryRun: false,
      sendingEnabled: false,
    });
    for (const row of store.values()) expect(row.status).toBe("skipped_disabled");

    // Sending gets enabled later; Stripe redelivers.
    await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), {
      ...PF_ALLOW,
      dryRun: false,
      sendingEnabled: true,
    });
    expect(store.size).toBe(2);
    for (const row of store.values()) expect(row.status).toBe("skipped_disabled");
  });

  it("rental tenant receipt: a sent receipt stays sent across redeliveries", async () => {
    const { db, store, writes } = statefulDeliveriesDb({
      table: "rental_tenant_receipt_deliveries",
      keyOf: (row) => `${row.owner_id}:${row.payment_id}`,
      reads: rentalReads({ tenantId: TENANT_ERIC }),
    });
    const live = { ...RENTAL_ALLOW, dryRun: false };

    const first = await queueTenantPaymentReceiptForWebhookEvent(db, { paymentId: "rentpay_fixture_1" }, live);
    expect(first.queued).toBe(true);
    expect(store.size).toBe(1);
    expect(writes[0].opts).toMatchObject({ ignoreDuplicates: true });

    for (const row of store.values()) row.status = "sent";

    const redelivery = await queueTenantPaymentReceiptForWebhookEvent(
      db,
      { paymentId: "rentpay_fixture_1" },
      live,
    );
    expect(redelivery.queued).toBe(true); // decision only; the stored row is untouched
    for (const row of store.values()) expect(row.status).toBe("sent");
  });
});

// ------------------------------------------------------------ quiet hours ---
describe("quiet hours: 23:00-07:00 America/Chicago", () => {
  // Detection/queueing never gates on quiet hours (the cron defers delivery);
  // the helper below is what the cron routes call before every send.
  it("is quiet inside the window", () => {
    expect(isQuietHours({ at: new Date("2026-09-29T23:30:00-05:00") })).toBe(true);
    expect(isQuietHours({ at: new Date("2026-09-30T00:00:00-05:00") })).toBe(true);
    expect(isQuietHours({ at: new Date("2026-09-29T06:59:59-05:00") })).toBe(true);
  });

  it("is not quiet outside the window", () => {
    expect(isQuietHours({ at: new Date("2026-09-29T07:00:00-05:00") })).toBe(false);
    expect(isQuietHours({ at: new Date("2026-09-29T12:00:00-05:00") })).toBe(false);
    expect(isQuietHours({ at: new Date("2026-09-29T22:59:59-05:00") })).toBe(false);
  });
});

// ------------------------------------------------------- decision matrix ---
describe("decision matrix: who would receive what, and why", () => {
  function cell(lane, trigger, recipient, decision, reason) {
    return { lane, trigger, recipient, decision, reason };
  }

  it("matches the allowlisted-recipients-only policy", async () => {
    const matrix = [];

    // PF lane.
    {
      const { db, writes } = makeDb({
        private_financing_borrowers: { email: "ethan-fixture@example.com" },
      });
      const r = await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_ETHAN), PF_ALLOW);
      const byType = Object.fromEntries(r.rows.map((row) => [row.recipient_type, row]));
      matrix.push(cell("Personal loan", "Portal payment (manual)", "Brandy — owner confirmation",
        byType.owner.status === "queued" ? "WOULD SEND" : "EXCLUDED",
        byType.owner.failure_reason ?? "Borrower allowlisted; owner allowlisted; sending enabled"));
      matrix.push(cell("Personal loan", "Portal payment (manual)", "Ethan — borrower receipt",
        byType.borrower.status === "queued" ? "WOULD SEND" : "EXCLUDED",
        byType.borrower.failure_reason ?? "Borrower allowlisted; sending enabled"));
      expect(writes).toHaveLength(0);
    }
    {
      const { db, writes } = makeDb({
        private_financing_borrowers: { email: "stranger-fixture@example.com" },
      });
      const r = await queuePaymentReceiptNotificationForWebhookEvent(db, pfPayment(BRW_STRANGER), PF_ALLOW);
      for (const row of r.rows) {
        matrix.push(cell("Personal loan", "Portal payment (manual)",
          row.recipient_type === "owner" ? "Brandy — owner confirmation" : "Stranger — borrower receipt",
          "EXCLUDED", row.failure_reason));
      }
      expect(writes).toHaveLength(0);
    }

    // Rental lane.
    {
      const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC }));
      const receipt = await queueTenantPaymentReceiptForWebhookEvent(db, { paymentId: "rentpay_fixture_1" }, RENTAL_ALLOW);
      matrix.push(cell("Rental (308 Paula)", "Rent payment (manual)", "Eric — tenant receipt",
        receipt.queued ? "WOULD SEND" : "EXCLUDED",
        receipt.row.failure_reason ?? "Tenant allowlisted; owner allowlisted; sending enabled"));
      const owner = await queueOwnerPaymentNotificationForWebhookEvent(
        db,
        { eventType: "payment_intent.succeeded", paymentId: "rentpay_fixture_1", occurredAt: "2026-09-29T10:00:00-05:00" },
        undefined,
        RENTAL_ALLOW,
      );
      matrix.push(cell("Rental (308 Paula)", "Rent payment (manual)", "Brandy — owner confirmation",
        owner.queued ? "WOULD SEND" : "EXCLUDED",
        owner.row?.failure_reason ?? `Tenant allowlisted; event ${owner.eventType}; sending enabled`));
      expect(writes).toHaveLength(0);
    }
    {
      const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_ERIC, autopay: true }));
      const owner = await queueOwnerPaymentNotificationForWebhookEvent(
        db,
        { eventType: "payment_intent.succeeded", paymentId: "rentpay_fixture_1", occurredAt: "2026-09-29T10:00:00-05:00" },
        undefined,
        RENTAL_ALLOW,
      );
      matrix.push(cell("Rental (308 Paula)", "Rent payment (autopay)", "Brandy — owner confirmation",
        owner.queued ? "WOULD SEND" : "EXCLUDED",
        `Tenant allowlisted; event ${owner.eventType}; sending enabled`));
      expect(writes).toHaveLength(0);
    }
    {
      const { db, writes } = makeDb(rentalReads({ tenantId: TENANT_STRANGER }));
      const receipt = await queueTenantPaymentReceiptForWebhookEvent(db, { paymentId: "rentpay_fixture_1" }, RENTAL_ALLOW);
      matrix.push(cell("Rental (308 Paula)", "Rent payment (manual)", "Stranger — tenant receipt",
        "EXCLUDED", `Not queued at detection: ${receipt.reason}`));
      const owner = await queueOwnerPaymentNotificationForWebhookEvent(
        db,
        { eventType: "payment_intent.succeeded", paymentId: "rentpay_fixture_1", occurredAt: "2026-09-29T10:00:00-05:00" },
        undefined,
        RENTAL_ALLOW,
      );
      matrix.push(cell("Rental (308 Paula)", "Rent payment (manual)", "Brandy — owner confirmation (stranger tenant)",
        "EXCLUDED", `Not queued at detection: ${owner.reason}`));
      expect(writes).toHaveLength(0);
    }

    const wouldSend = matrix.filter((c) => c.decision === "WOULD SEND");
    const excluded = matrix.filter((c) => c.decision === "EXCLUDED");
    // Only the allowlisted lane sends: Brandy x3 (PF owner, rental manual, rental autopay),
    // Ethan x1, Eric x1. Everyone else is excluded.
    expect(wouldSend).toHaveLength(5);
    expect(excluded).toHaveLength(4);
    expect(wouldSend.filter((c) => c.recipient.startsWith("Brandy"))).toHaveLength(3);

    console.log("\nPayment-receipt dry-run decision matrix (synthetic fixtures):");
    for (const c of matrix) console.log(`  [${c.decision}] ${c.lane} | ${c.trigger} | ${c.recipient}\n           why: ${c.reason}`);
  });
});
