import { describe, expect, it, vi } from "vitest";
import { resolveLetterTemplateContext } from "../letterContext";

// Multi-table stub: canned maybeSingle rows + canned list rows per table.
function makeDb(tables = {}) {
  const table = (name) => {
    const config = tables[name] || {};
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      not() { return chain; },
      order() { return chain; },
      limit() { return chain; },
      async maybeSingle() { return { data: config.oneRow ?? null, error: null }; },
      then(resolve) { resolve({ data: config.listRows || [], error: null }); },
    };
    return chain;
  };
  return { from: vi.fn((name) => table(name)) };
}

describe("letter template context", () => {
  it("resolves tenant, lease, unit address, rent, and balance fields", async () => {
    const db = makeDb({
      rental_tenants: { oneRow: { id: "t1", display_name: "Eric Carrillo" } },
      rental_lease_tenants: { oneRow: { lease_id: "lease_1" } },
      rental_leases: { oneRow: { id: "lease_1", unit_id: "u1", monthly_rent_cents: 160000, end_date: "2027-08-31" } },
      rental_units: {
        oneRow: {
          id: "u1", address_street: "308 Paula", address_unit: null,
          address_city: "Houston", address_state: "TX", address_zip: "77000",
        },
      },
      rent_charges: {
        listRows: [
          { due_date: "2026-10-01", amount_cents: 160000, paid_amount_cents: 0 },
          { due_date: "2026-11-01", amount_cents: 160000, paid_amount_cents: 50000 },
        ],
      },
      rental_email_settings: { oneRow: { sender_name: "Jason Morgan" } },
    });
    const { fields, leaseId } = await resolveLetterTemplateContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "t1" });
    expect(leaseId).toBe("lease_1");
    expect(fields.tenant_name).toBe("Eric Carrillo");
    expect(fields.tenant_address).toBe("308 Paula\nHouston, TX 77000");
    expect(fields.monthly_rent).toBe("$1,600.00");
    expect(fields.lease_end_date).toBe("Aug 31, 2027");
    expect(fields.balance_due).toBe("$2,700.00");
    expect(fields.rent_due_date).toBe("Oct 1, 2026");
    expect(fields.owner_name).toBe("Jason Morgan");
    expect(fields.letter_date).toBeTruthy();
    expect(fields.owner_return_address).toBeNull();
  });

  it("never throws when the tenant has no lease", async () => {
    const db = makeDb({ rental_tenants: { oneRow: { id: "t1", display_name: "Eric Carrillo" } } });
    const { fields, leaseId } = await resolveLetterTemplateContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "t1" });
    expect(leaseId).toBeNull();
    expect(fields.tenant_name).toBe("Eric Carrillo");
    expect(fields.tenant_address).toBeUndefined();
  });

  it("never throws when queries fail", async () => {
    const db = { from: () => { throw new Error("db down"); } };
    const { fields } = await resolveLetterTemplateContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "t1" });
    expect(fields.letter_date).toBeTruthy();
  });
});
