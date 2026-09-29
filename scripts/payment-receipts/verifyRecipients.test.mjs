import { describe, expect, it } from "vitest";
import {
  buildRecipientVerificationReport,
  lookupBorrower,
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
 */
function createFakeDb(responses) {
  const fromCalls = [];
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
  it("resolves every configured borrower and tenant id, and reports empty allowlists as such", async () => {
    const { db, fromCalls } = createFakeDb({
      private_financing_borrowers: [{ data: { id: "b1", full_name: "Tyler Welch", email: "tyler@example.com" }, error: null }],
    });
    const env = {
      OWNER_PAYMENT_NOTIFICATION_EMAIL: "brandy@example.com",
      OWNER_PAYMENT_NOTIFICATION_OWNER_IDS: "owner1",
      PF_RECEIPT_BORROWER_IDS: "b1",
      RENTAL_NOTIFICATION_TENANT_IDS: "", // deliberately empty: must fail closed, not throw
      OWNER_PAYMENT_NOTIFICATIONS_ENABLED: "false",
    };
    const report = await buildRecipientVerificationReport(db, env);
    expect(report.ownerRecipientEmail).toBe("brandy@example.com");
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

  it("flags a dangling configured id instead of silently dropping it", async () => {
    const { db } = createFakeDb({
      private_financing_borrowers: [{ data: null, error: null }],
    });
    const env = { PF_RECEIPT_BORROWER_IDS: "ghost-id", RENTAL_NOTIFICATION_TENANT_IDS: "" };
    const report = await buildRecipientVerificationReport(db, env);
    expect(report.borrowerAllowlist).toEqual([{ id: "ghost-id", found: false }]);
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
