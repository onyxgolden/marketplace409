import { describe, expect, it } from "vitest";
import {
  buildRecipientVerificationReport,
  lookupBorrower,
  lookupOwner,
  lookupPropertyLabel,
  lookupTenant,
} from "./verifyRecipients.mjs";

// A minimal fake of Supabase's query builder: chainable (.eq() returns
// itself) AND directly awaitable (matches real usage, some call sites here
// chain to .maybeSingle() and some await the .eq() call directly). Crucially,
// it implements NO write methods (insert/update/upsert/delete) at all — if
// the code under test ever tried one, it would throw "is not a function"
// and fail the test immediately. That is the read-only guarantee this test
// file exists to prove, not just assert.
function makeQueryBuilder(result) {
  const builder = {
    eq: () => builder,
    maybeSingle: () => Promise.resolve(result),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return builder;
}

/**
 * @param {Record<string, Array<{data: any, error: any}>>} responses
 *   one queue of results per table; each `.from(table).select(...)` call
 *   shifts the next entry off that table's queue, so a table queried more
 *   than once (e.g. rental_leases for two different lease ids) can return
 *   different results in call order.
 * @param {Array<{data: any, error: any}>} [authResponses]
 *   one queue of results for db.auth.admin.getUserById, consumed in call
 *   order — mirrors the per-table queues above but Auth admin isn't a table.
 */
function createFakeDb(responses, authResponses = []) {
  const fromCalls = [];
  const authQueue = [...authResponses];
  const db = {
    from(table) {
      fromCalls.push(table);
      return {
        select() {
          const queue = responses[table];
          if (!queue || queue.length === 0) {
            throw new Error(`No fake response queued for table "${table}"`);
          }
          return makeQueryBuilder(queue.shift());
        },
      };
    },
    auth: {
      admin: {
        getUserById() {
          if (authQueue.length === 0) {
            throw new Error("No fake auth response queued for getUserById");
          }
          return Promise.resolve(authQueue.shift());
        },
      },
    },
  };
  return { db, fromCalls };
}

describe("lookupBorrower", () => {
  it("returns the real name/email for a configured id", async () => {
    const { db } = createFakeDb({
      private_financing_borrowers: [{ data: { id: "b1", full_name: "Ethan Morgan", email: "ethan@example.com" }, error: null }],
    });
    await expect(lookupBorrower(db, "b1")).resolves.toEqual({ id: "b1", full_name: "Ethan Morgan", email: "ethan@example.com" });
  });

  it("returns null for a dangling id instead of throwing", async () => {
    const { db } = createFakeDb({ private_financing_borrowers: [{ data: null, error: null }] });
    await expect(lookupBorrower(db, "nonexistent")).resolves.toBeNull();
  });

  it("propagates a real database error rather than masking it", async () => {
    const { db } = createFakeDb({ private_financing_borrowers: [{ data: null, error: new Error("db down") }] });
    await expect(lookupBorrower(db, "b1")).rejects.toThrow("db down");
  });
});

describe("lookupOwner", () => {
  it("resolves the real email for a configured owner id via the Auth admin API", async () => {
    const { db } = createFakeDb({}, [{ data: { user: { id: "owner1", email: "owner@example.com" } }, error: null }]);
    await expect(lookupOwner(db, "owner1")).resolves.toEqual({ id: "owner1", email: "owner@example.com" });
  });

  it("returns null for a dangling owner id instead of throwing", async () => {
    const { db } = createFakeDb({}, [{ data: null, error: { status: 404, message: "User not found" } }]);
    await expect(lookupOwner(db, "ghost-owner")).resolves.toBeNull();
  });

  it("propagates a real Auth API error rather than masking it", async () => {
    const { db } = createFakeDb({}, [{ data: null, error: { status: 500, message: "service unavailable" } }]);
    await expect(lookupOwner(db, "owner1")).rejects.toMatchObject({ message: "service unavailable" });
  });
});

describe("lookupPropertyLabel", () => {
  it("prefers the unit label when the lease names a unit", async () => {
    const { db } = createFakeDb({
      rental_leases: [{ data: { property_id: "308-paula", unit_id: "unit1" }, error: null }],
      rental_units: [{ data: { label: "Unit 3B" }, error: null }],
    });
    await expect(lookupPropertyLabel(db, { ownerId: "owner1", leaseId: "lease1" })).resolves.toBe("Unit 3B");
  });

  it("falls back to the humanized property id when there is no unit label", async () => {
    const { db } = createFakeDb({
      rental_leases: [{ data: { property_id: "308-paula", unit_id: null }, error: null }],
    });
    await expect(lookupPropertyLabel(db, { ownerId: "owner1", leaseId: "lease1" })).resolves.toBe("308 Paula");
  });

  it("returns null without throwing when the lease is missing", async () => {
    const { db } = createFakeDb({
      rental_leases: [{ data: null, error: null }],
    });
    await expect(lookupPropertyLabel(db, { ownerId: "owner1", leaseId: "lease1" })).resolves.toBeNull();
  });

  it("returns null without throwing when no leaseId is given", async () => {
    const { db } = createFakeDb({});
    await expect(lookupPropertyLabel(db, { ownerId: "owner1", leaseId: null })).resolves.toBeNull();
  });
});

describe("lookupTenant", () => {
  it("resolves the real name/email plus every lease's property label", async () => {
    const { db } = createFakeDb({
      rental_tenants: [{ data: { id: "t1", display_name: "Eric Carrillo", email: "eric@example.com", status: "active", owner_id: "owner1" }, error: null }],
      rental_lease_tenants: [{ data: [{ lease_id: "lease1" }], error: null }],
      rental_leases: [
        { data: { id: "lease1", status: "active" }, error: null }, // lookupTenant's own lease-status read
        { data: { property_id: "308-paula", unit_id: null }, error: null }, // resolvePropertyLabel's own read of the same lease
      ],
    });
    const tenant = await lookupTenant(db, "t1");
    expect(tenant).toMatchObject({
      id: "t1",
      display_name: "Eric Carrillo",
      email: "eric@example.com",
      leases: [{ leaseId: "lease1", status: "active", propertyLabel: "308 Paula" }],
    });
  });

  it("returns null for a dangling tenant id instead of throwing", async () => {
    const { db } = createFakeDb({ rental_tenants: [{ data: null, error: null }] });
    await expect(lookupTenant(db, "nonexistent")).resolves.toBeNull();
  });

  it("reports no leases on file rather than guessing a property", async () => {
    const { db } = createFakeDb({
      rental_tenants: [{ data: { id: "t2", display_name: "Someone", email: "s@example.com", status: "active", owner_id: "owner1" }, error: null }],
      rental_lease_tenants: [{ data: [], error: null }],
    });
    const tenant = await lookupTenant(db, "t2");
    expect(tenant.leases).toEqual([]);
  });
});

describe("buildRecipientVerificationReport", () => {
  it("resolves every configured borrower, tenant, and owner id, and reports empty allowlists as such", async () => {
    const { db, fromCalls } = createFakeDb(
      {
        private_financing_borrowers: [{ data: { id: "b1", full_name: "Tyler Welch", email: "tyler@example.com" }, error: null }],
      },
      [{ data: { user: { id: "owner1", email: "owner@example.com" } }, error: null }],
    );
    const env = {
      OWNER_PAYMENT_NOTIFICATION_EMAIL: "brandy@example.com",
      OWNER_PAYMENT_NOTIFICATION_OWNER_IDS: "owner1",
      PF_RECEIPT_BORROWER_IDS: "b1",
      RENTAL_NOTIFICATION_TENANT_IDS: "", // deliberately empty: must fail closed, not throw
      OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "false",
    };
    const report = await buildRecipientVerificationReport(db, env);
    expect(report.ownerRecipientEmail).toBe("brandy@example.com");
    expect(report.ownerAllowlist).toEqual([{ id: "owner1", found: true, email: "owner@example.com" }]);
    expect(report.borrowerAllowlist).toEqual([{ id: "b1", found: true, full_name: "Tyler Welch", email: "tyler@example.com" }]);
    expect(report.tenantAllowlist).toEqual([]);
    expect(report.sendingEnabled).toEqual({
      ownerPaymentNotifications: false,
      rentalTenantReceipts: false,
      personalLoanReceipts: false,
    });
    // Read-only: only ever .from().select() — no table was ever asked to
    // write, and the only table touched matches the one configured id.
    expect(fromCalls).toEqual(["private_financing_borrowers"]);
  });

  it("flags a dangling configured borrower id instead of silently dropping it", async () => {
    const { db } = createFakeDb({
      private_financing_borrowers: [{ data: null, error: null }],
    });
    const env = { PF_RECEIPT_BORROWER_IDS: "ghost-id", RENTAL_NOTIFICATION_TENANT_IDS: "" };
    const report = await buildRecipientVerificationReport(db, env);
    expect(report.borrowerAllowlist).toEqual([{ id: "ghost-id", found: false }]);
  });

  it("flags a dangling configured owner id instead of silently dropping it", async () => {
    const { db } = createFakeDb({}, [{ data: null, error: { status: 404, message: "User not found" } }]);
    const env = {
      OWNER_PAYMENT_NOTIFICATION_OWNER_IDS: "ghost-owner",
      PF_RECEIPT_BORROWER_IDS: "",
      RENTAL_NOTIFICATION_TENANT_IDS: "",
    };
    const report = await buildRecipientVerificationReport(db, env);
    expect(report.ownerAllowlist).toEqual([{ id: "ghost-owner", found: false, email: null }]);
  });

  it("never calls a write method — the fake db exposes none, so any attempt throws", async () => {
    const { db } = createFakeDb({ private_financing_borrowers: [], });
    const env = { PF_RECEIPT_BORROWER_IDS: "", RENTAL_NOTIFICATION_TENANT_IDS: "" };
    // Empty allowlists: zero lookups happen at all, and the function must
    // still complete without ever touching a write method that doesn't exist
    // on this fake.
    await expect(buildRecipientVerificationReport(db, env)).resolves.toMatchObject({
      borrowerAllowlist: [],
      tenantAllowlist: [],
    });
  });
});
