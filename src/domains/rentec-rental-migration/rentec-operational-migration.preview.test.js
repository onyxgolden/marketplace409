import { describe, expect, it } from "vitest";
import { previewRentecOperationalMigration } from "./rentec-operational-migration.preview.js";

describe("Rentec operational migration preview", () => {
  it("classifies property, tenant, and lease records without enabling writes", () => {
    const result = previewRentecOperationalMigration({
      asOf: "2026-08-14",
      rentecProperties: [
        { property_id: 10, address: "1218 WAGNER" },
        { property_id: 11, address: "New House" },
        { property_id: 12, address: "Old House", archived: true },
      ],
      rentecTenants: [
        { renter_id: 20, email: "linked@example.com" },
        { renter_id: 21, email: "new@example.com" },
        { renter_id: 22, email: "old@example.com", archived: true },
        { renter_id: 23, email: "" },
      ],
      rentecLeases: [
        { property_id: 10, renter_id: 20, lease_begin: "2026-01-01", lease_end: "2026-12-31", recurring_rent: 1000 },
        { property_id: 10, renter_id: 20, lease_begin: "2026-02-01", lease_end: "2026-12-31", recurring_rent: 1100 },
        { property_id: 12, renter_id: 22, lease_begin: "2020-01-01", lease_end: "2020-12-31", recurring_rent: 800 },
        { property_id: 11, renter_id: 21, lease_begin: "2026-03-01", lease_end: "2027-02-28", recurring_rent: 900 },
        { property_id: 10, renter_id: 23, lease_begin: "2026-04-01", lease_end: "2027-03-31", recurring_rent: 950 },
      ],
      forgeUnits: [{ id: "unit-1", property_id: "1218-wagner", label: "Main unit" }],
      forgeTenants: [{ id: "tenant-1", email: "LINKED@example.com" }],
      forgeLeases: [{ id: "lease-1", unit_id: "unit-1", start_date: "2026-01-01", monthly_rent_cents: 100000 }],
    });
    expect(result).toMatchObject({
      mode: "preview_only", canCommit: false,
      properties: { create: 1, link: 1, skip: 1, review: 0 },
      tenants: { create: 1, link: 1, skip: 1, review: 1 },
      leases: { create: 2, link: 1, skip: 1, review: 1 },
    });
    expect(result.reviewReasons).toContainEqual({ label: "Lease depends on an unresolved property or tenant", count: 1 });
  });

  it("requires array inputs", () => {
    expect(() => previewRentecOperationalMigration({ rentecProperties: null })).toThrow("must be arrays");
  });
});
