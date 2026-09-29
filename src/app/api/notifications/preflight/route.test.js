// Proof for the operational preflight: it resolves the ACTUAL configured
// allowlist IDs and current pending rows for all three lanes with zero
// database writes, zero email-provider involvement, and no real email
// addresses or payment details in the response. Synthetic fixtures only.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET } from "./route.js";

const BORROWER = "pf_brw_fixture_ethan";
const OWNER = "owner_fixture";
const TENANT = "rental_tenant_fixture_eric";

// Recording mock db: every write is captured so the test can prove the
// preflight is read-only; reads resolve from the rows map.
function makeDb(rows = {}) {
  const writes = [];
  const node = (table) => {
    const q = {
      select: () => q,
      in: () => q,
      eq: () => q,
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
      then: (resolve) => resolve({ data: rows[table] ?? [], error: null }),
    };
    return q;
  };
  return { db: { from: vi.fn((table) => node(table)) }, writes };
}

const ENV_KEYS = [
  "CRON_SECRET",
  "PF_RECEIPT_BORROWER_IDS",
  "RENTAL_NOTIFICATION_TENANT_IDS",
  "OWNER_PAYMENT_NOTIFICATION_OWNER_IDS",
  "OWNER_PAYMENT_NOTIFICATIONS_ENABLED",
  "OWNER_PAYMENT_NOTIFICATION_EMAIL",
];
let savedEnv = {};

beforeEach(() => {
  savedEnv = {};
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  process.env.CRON_SECRET = "test-secret";
  // Actual configured IDs (synthetic stand-ins): one borrower, one tenant,
  // one owner — the shape production must have.
  process.env.PF_RECEIPT_BORROWER_IDS = BORROWER;
  process.env.RENTAL_NOTIFICATION_TENANT_IDS = TENANT;
  process.env.OWNER_PAYMENT_NOTIFICATION_OWNER_IDS = OWNER;
  process.env.OWNER_PAYMENT_NOTIFICATIONS_ENABLED = "true";
  process.env.OWNER_PAYMENT_NOTIFICATION_EMAIL = "owner-fixture@example.com";
  vi.clearAllMocks();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function authedRequest(url) {
  return new Request(url, { headers: { authorization: "Bearer test-secret" } });
}

describe("GET preflight", () => {
  it("splits pending rows into eligible and excluded groups per lane", async () => {
    const { db, writes } = makeDb({
      private_financing_borrowers: [{ id: BORROWER, full_name: "Fixture Borrower" }],
      rental_tenants: [{ id: TENANT, display_name: "Fixture Tenant" }],
      private_financing_payment_receipt_deliveries: [
        { status: "queued", attempt_count: 0, last_attempted_at: null, borrower_id: BORROWER },
        { status: "failed", attempt_count: 1, last_attempted_at: new Date().toISOString(), borrower_id: BORROWER },
        { status: "queued", attempt_count: 0, last_attempted_at: null, borrower_id: "pf_brw_excluded" },
        { status: "failed", attempt_count: 5, last_attempted_at: new Date().toISOString(), borrower_id: BORROWER },
        { status: "sent", attempt_count: 1, last_attempted_at: new Date().toISOString(), borrower_id: BORROWER },
      ],
      rental_tenant_receipt_deliveries: [
        { status: "queued", attempt_count: 0, last_attempted_at: null, tenant_id: TENANT },
        { status: "failed", attempt_count: 1, last_attempted_at: new Date().toISOString(), tenant_id: "tenant_excluded" },
      ],
      rental_owner_notifications: [
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: OWNER, tenant_id: TENANT },
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: OWNER, tenant_id: "tenant_excluded" },
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: "owner_excluded", tenant_id: TENANT },
      ],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest("https://test/api/notifications/preflight"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);

    // The actual configured allowlist IDs resolve to their records.
    expect(body.lanes.personalLoan.borrowerAllowlist).toEqual([
      { id: BORROWER, displayName: "Fixture Borrower" },
    ]);
    expect(body.lanes.rentalTenant.tenantAllowlist).toEqual([
      { id: TENANT, displayName: "Fixture Tenant" },
    ]);
    expect(body.lanes.personalLoan.ownerAllowlist).toEqual([{ id: OWNER }]);
    expect(body.lanes.rentalOwner.ownerAllowlist).toEqual([{ id: OWNER }]);
    expect(body.lanes.personalLoan.sendingEnabled).toBe(true);

    // Pending rows are split by recipient eligibility. Exhausted and sent
    // rows are excluded from both groups.
    expect(body.lanes.personalLoan.pendingDeliveries).toEqual({
      eligible: { queued: 1, retryable: 1 },
      excluded: { queued: 1, retryable: 0, recipientIds: ["borrower:pf_brw_excluded"] },
    });
    expect(body.lanes.rentalTenant.pendingDeliveries).toEqual({
      eligible: { queued: 1, retryable: 0 },
      excluded: { queued: 0, retryable: 1, recipientIds: ["tenant:tenant_excluded"] },
    });
    expect(body.lanes.rentalOwner.pendingDeliveries).toEqual({
      eligible: { queued: 1, retryable: 0 },
      excluded: {
        queued: 2,
        retryable: 0,
        recipientIds: [
          `owner:${OWNER} tenant:tenant_excluded`,
          `owner:owner_excluded tenant:${TENANT}`,
        ],
      },
    });

    // The owner recipient is masked, and no real email address or payment
    // detail appears anywhere in the response.
    expect(body.lanes.personalLoan.ownerConfirmationRecipient).toBe("o***@example.com");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("owner-fixture@example.com");
    expect(serialized).not.toContain("amount_cents");
    expect(serialized).not.toContain("payment_id");

    // Read-only: zero database writes.
    expect(writes).toHaveLength(0);
  });

  it("surfaces an allowlisted ID that resolves to no record", async () => {
    const { db } = makeDb({
      private_financing_borrowers: [],
      rental_tenants: [],
      private_financing_payment_receipt_deliveries: [],
      rental_tenant_receipt_deliveries: [],
      rental_owner_notifications: [],
    });
    createRentalWebhookClient.mockReturnValue(db);

    const response = await GET(authedRequest("https://test/api/notifications/preflight"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.lanes.personalLoan.borrowerAllowlist).toEqual([{ id: BORROWER, displayName: null }]);
    expect(body.lanes.rentalTenant.tenantAllowlist).toEqual([{ id: TENANT, displayName: null }]);
  });

  it("still refuses unauthenticated callers", async () => {
    const response = await GET(new Request("https://test/api/notifications/preflight"));
    expect(response.status).toBe(401);
  });
});
