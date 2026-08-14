import { describe, expect, it } from "vitest";
import { buildRentecImportManifest } from "./rentec-import-manifest.preview.js";

const input = {
  asOf: "2026-08-14",
  rentecProperties: [{ property_id: 10, address: "1218 Wagner St" }],
  rentecTenants: [{ renter_id: 20, f_name: "A", l_name: "Tenant", email: "A@example.com", phone: "555-0100" }],
  rentecLeases: [{ lease_id: 30, property_id: 10, renter_id: 20, lease_begin: "2026-01-01", lease_end: "2027-01-01", recurring_rent: 1000 }],
};

describe("Rentec import manifest preview", () => {
  it("creates deterministic private candidates while blocking missing due-day input", () => {
    const result = buildRentecImportManifest(input);
    expect(result).toMatchObject({
      mode: "preview_only", canCommit: false,
      dependencyOrder: ["properties_and_units", "renters", "leases_and_memberships"],
      readiness: {
        units: { ready: 1, blocked: 0 },
        tenants: { ready: 1, blocked: 0 },
        leases: { ready: 0, blocked: 1 },
      },
      privateRecordCounts: { units: 1, tenants: 1, leases: 1 },
    });
    expect(result.checksum).toMatch(/^[a-f0-9]{64}$/);
    expect(result.blockers).toContainEqual({ label: "Rent due day requires owner input", count: 1 });
    expect(result.fieldMappings.leases).toContainEqual(expect.objectContaining({ target: "rent_due_day", rule: expect.stringContaining("never inferred") }));
    expect(JSON.stringify(result)).not.toContain("A@example.com");
    expect(JSON.stringify(result)).not.toContain("555-0100");
  });

  it("produces the same checksum for the same source evidence", () => {
    expect(buildRentecImportManifest(input).checksum).toBe(buildRentecImportManifest(input).checksum);
  });

  it("does not recreate records already represented in Rental Manager", () => {
    const result = buildRentecImportManifest({
      ...input,
      forgeUnits: [{ id: "unit-existing", property_id: "1218-wagner", label: "Main" }],
      forgeTenants: [{ id: "tenant-existing", email: "a@example.com" }],
      forgeLeases: [{ id: "lease-existing", unit_id: "unit-existing", start_date: "2026-01-01", monthly_rent_cents: 100000 }],
    });
    expect(result.privateRecordCounts).toEqual({ units: 0, tenants: 0, leases: 0 });
  });
});
