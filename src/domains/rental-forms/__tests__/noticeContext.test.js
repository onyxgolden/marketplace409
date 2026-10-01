import { describe, expect, it, vi } from "vitest";
import { resolveNoticeContext } from "../noticeContext";

// Chainable supabase stub keyed by table name.
function makeDb(tables = {}) {
  const chainFor = (table) => {
    const canned = tables[table];
    const chain = {
      select() { return chain; },
      eq() { return chain; },
      not() { return chain; },
      limit() { return chain; },
      in() { return chain; },
      async maybeSingle() {
        if (canned instanceof Error) throw canned;
        return { data: Array.isArray(canned) ? canned[0] ?? null : canned ?? null, error: null };
      },
      then(resolve) {
        if (canned instanceof Error) resolve({ data: null, error: canned });
        else resolve({ data: Array.isArray(canned) ? canned : canned ? [canned] : [], error: null });
      },
    };
    return chain;
  };
  return { from: vi.fn((table) => chainFor(table)) };
}

const FULL = {
  rental_tenants: { display_name: "Eric Carrillo", email: "eric.carillo5@yahoo.com", phone: "555-0100" },
  rental_lease_tenants: { lease_id: "lease_1" },
  rental_leases: {
    id: "lease_1", property_id: "308-paula", unit_id: "unit_1",
    start_date: "2026-09-01", end_date: "2027-08-31",
    monthly_rent_cents: 160000, rent_due_day: 1,
  },
  rental_units: {
    label: "308 Paula — Unit A", address_street: "308 Paula St", address_unit: "A",
    address_city: "Beaumont", address_state: "TX", address_zip: "77705",
  },
  rent_charges: [
    { amount_cents: 160000, paid_amount_cents: 0 },
    { amount_cents: 5000, paid_amount_cents: 5000 },
  ],
  rental_email_settings: { sender_name: "409 Marketplace" },
  rental_custom_fields: [
    { id: "f1", field_key: "gate_code", field_type: "text" },
    { id: "f2", field_key: "has_insurance", field_type: "yes_no" },
  ],
  rental_custom_field_values: [
    { field_id: "f1", value_text: "4821" },
    { field_id: "f2", value_text: "yes" },
  ],
};

describe("notice context resolution", () => {
  it("resolves the full placeholder context for a tenant with a lease", async () => {
    const db = makeDb(FULL);
    const context = await resolveNoticeContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "tenant_1" });
    expect(context.tenant).toEqual({ name: "Eric Carrillo", email: "eric.carillo5@yahoo.com", phone: "555-0100" });
    expect(context.lease.start).toBe("Sep 1, 2026");
    expect(context.lease.end).toBe("Aug 31, 2027");
    expect(context.lease.rent).toBe("$1,600.00");
    expect(context.lease.due_day).toBe("1");
    expect(context.unit.label).toBe("308 Paula — Unit A");
    expect(context.property.label).toBe("308 Paula — Unit A");
    expect(context.property.address).toBe("308 Paula St, A, Beaumont, TX 77705");
    expect(context.balance.due).toBe("$1,600.00"); // only the unpaid charge counts
    expect(context.owner.name).toBe("409 Marketplace");
    expect(context.custom.gate_code).toBe("4821");
    expect(context.custom.has_insurance).toBe("Yes");
    expect(context.today).toMatch(/2026/);
  });

  it("falls back to the humanized property id when no unit is on record", async () => {
    const db = makeDb({ ...FULL, rental_units: null, rental_leases: { ...FULL.rental_leases, unit_id: null } });
    const context = await resolveNoticeContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "tenant_1" });
    expect(context.property.label).toBe("308 Paula");
    expect(context.property.address).toBeNull();
  });

  it("uses an explicitly passed lease id", async () => {
    const db = makeDb({ ...FULL, rental_lease_tenants: null });
    const context = await resolveNoticeContext({
      supabaseClient: db, ownerId: "owner_1", tenantId: "tenant_1", leaseId: "lease_9",
    });
    expect(db.from).not.toHaveBeenCalledWith("rental_lease_tenants");
    expect(context.lease.rent).toBe("$1,600.00");
  });

  it("never throws: every lookup failure yields null fields", async () => {
    const db = makeDb({ rental_tenants: new Error("db down") });
    const context = await resolveNoticeContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "tenant_1" });
    expect(context.tenant.name).toBeNull();
    expect(context.lease.rent).toBeNull();
    expect(context.balance.due).toBeNull();
    expect(context.custom).toEqual({});
    expect(context.today).toBeTruthy();
  });

  it("reports zero balance when all charges are paid", async () => {
    const db = makeDb({ ...FULL, rent_charges: [{ amount_cents: 160000, paid_amount_cents: 160000 }] });
    const context = await resolveNoticeContext({ supabaseClient: db, ownerId: "owner_1", tenantId: "tenant_1" });
    expect(context.balance.due).toBe("$0.00");
  });
});
