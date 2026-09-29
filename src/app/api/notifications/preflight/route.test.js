// Proof for the operational preflight: it resolves the ACTUAL configured
// allowlist IDs and current pending rows for all three lanes with zero
// database writes, zero email-provider involvement, and no real email
// addresses or payment details in the response. Synthetic fixtures only.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/supabase/createRentalWebhookClient", () => ({ createRentalWebhookClient: vi.fn() }));

import { createRentalWebhookClient } from "@/lib/supabase/createRentalWebhookClient";
import { GET, fetchPendingDeliveryRows } from "./route.js";

const BORROWER = "pf_brw_fixture_ethan";
const OWNER = "owner_fixture";
const TENANT = "rental_tenant_fixture_eric";

// Recording mock db: every write is captured so the test can prove the
// preflight is read-only; reads resolve from the rows map.
function makeDb(rows = {}) {
  const writes = [];
  const node = (table) => {
    let rangeFrom = 0;
    let rangeTo = Number.POSITIVE_INFINITY;
    let headCount = false;
    const q = {
      select: (cols, opts) => {
        if (opts && opts.head) headCount = true;
        return q;
      },
      in: () => q,
      eq: () => q,
      order: () => q,
      range: (from, to) => {
        rangeFrom = from;
        rangeTo = to;
        return q;
      },
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
      then: (resolve) => {
        const all = rows[table] ?? [];
        if (headCount) return resolve({ data: [], error: null, count: all.length });
        return resolve({ data: all.slice(rangeFrom, rangeTo + 1), error: null });
      },
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
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: OWNER, borrower_id: BORROWER },
        { status: "failed", attempt_count: 1, last_attempted_at: new Date().toISOString(), owner_id: OWNER, borrower_id: BORROWER },
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: OWNER, borrower_id: "pf_brw_excluded" },
        { status: "failed", attempt_count: 5, last_attempted_at: new Date().toISOString(), owner_id: OWNER, borrower_id: BORROWER },
        { status: "sent", attempt_count: 1, last_attempted_at: new Date().toISOString(), owner_id: OWNER, borrower_id: BORROWER },
        // Excluded owner with an otherwise allowed borrower — must not count as eligible.
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: "owner_excluded", borrower_id: BORROWER },
      ],
      rental_tenant_receipt_deliveries: [
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: OWNER, tenant_id: TENANT },
        { status: "failed", attempt_count: 1, last_attempted_at: new Date().toISOString(), owner_id: OWNER, tenant_id: "tenant_excluded" },
        // Excluded owner with an otherwise allowed tenant — must not count as eligible.
        { status: "queued", attempt_count: 0, last_attempted_at: null, owner_id: "owner_excluded", tenant_id: TENANT },
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

    // Pending rows are split by recipient eligibility, applying the owner
    // gate in every lane. Exhausted and sent rows are excluded from both groups.
    expect(body.lanes.personalLoan.pendingDeliveries).toEqual({
      eligible: { queued: 1, retryable: 1 },
      excluded: {
        queued: 2,
        retryable: 0,
        recipientIds: [
          `owner:${OWNER} borrower:pf_brw_excluded`,
          `owner:owner_excluded borrower:${BORROWER}`,
        ],
      },
      complete: true,
    });
    expect(body.lanes.rentalTenant.pendingDeliveries).toEqual({
      eligible: { queued: 1, retryable: 0 },
      excluded: {
        queued: 1,
        retryable: 1,
        recipientIds: [
          `owner:${OWNER} tenant:tenant_excluded`,
          `owner:owner_excluded tenant:${TENANT}`,
        ],
      },
      complete: true,
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
      complete: true,
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

describe("fetchPendingDeliveryRows", () => {
  const pendingRow = (id) => ({
    id,
    owner_id: "owner_1",
    status: "queued",
    attempt_count: 0,
    last_attempted_at: null,
  });

  // Minimal mock honoring select/order/range and the exact-count head query.
  function pagingDb(allRows, { headCountOverride } = {}) {
    return {
      from: () => {
        let rangeFrom = 0;
        let rangeTo = Number.POSITIVE_INFINITY;
        let head = false;
        const q = {
          select: (cols, opts) => {
            if (opts && opts.head) head = true;
            return q;
          },
          in: () => q,
          order: () => q,
          range: (from, to) => {
            rangeFrom = from;
            rangeTo = to;
            return q;
          },
          then: (resolve) =>
            head
              ? resolve({ data: [], error: null, count: headCountOverride ?? allRows.length })
              : resolve({ data: allRows.slice(rangeFrom, rangeTo + 1), error: null }),
        };
        return q;
      },
    };
  }

  it("pages through multiple pages and reports a complete census", async () => {
    const all = ["a", "b", "c", "d", "e"].map(pendingRow);
    const { rows, complete } = await fetchPendingDeliveryRows(pagingDb(all), "t", "owner_id", {
      pageSize: 2,
    });
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c", "d", "e"]);
    expect(complete).toBe(true);
  });

  it("flags the census incomplete when the page bound is hit with a full page", async () => {
    const all = ["a", "b", "c", "d", "e"].map(pendingRow);
    const { rows, complete } = await fetchPendingDeliveryRows(pagingDb(all), "t", "owner_id", {
      pageSize: 2,
      maxPages: 2,
    });
    expect(rows).toHaveLength(4);
    expect(complete).toBe(false);
  });

  it("flags the census incomplete when rows drift from the exact count", async () => {
    const all = ["a", "b"].map(pendingRow);
    const { complete } = await fetchPendingDeliveryRows(
      pagingDb(all, { headCountOverride: 3 }),
      "t",
      "owner_id",
      { pageSize: 10 },
    );
    expect(complete).toBe(false);
  });
});
