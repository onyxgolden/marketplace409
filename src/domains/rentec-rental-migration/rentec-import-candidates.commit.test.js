import { describe, expect, it } from "vitest";
import { buildRentecImportManifest, resolveRentecImportCandidatesForCommit } from "./rentec-import-manifest.preview.js";

const input = {
  asOf: "2026-08-14",
  rentecProperties: [{ property_id: 10, address: "1218 Wagner St" }],
  rentecTenants: [{ renter_id: 20, f_name: "A", l_name: "Tenant", email: "A@example.com", phone: "555-0100" }],
  rentecLeases: [{
    lease_id: 30, property_id: 10, renter_id: 20, lease_begin: "2026-01-01", lease_end: "2027-01-01", recurring_rent: 1000,
  }],
  ownerInputs: { leaseRentDueDays: { 30: 1 } },
};

describe("Rentec import candidates for commit (server-only)", () => {
  it("resolves the real candidate records, unlike the public preview", () => {
    const result = resolveRentecImportCandidatesForCommit(input);
    expect(result.units).toHaveLength(1);
    expect(result.tenants).toEqual([
      expect.objectContaining({ display_name: "A Tenant", email: "a@example.com", source_system: "rentec", source_record_id: "20" }),
    ]);
    expect(result.leases).toEqual([
      expect.objectContaining({ tenant_id: result.tenants[0].id, unit_id: result.units[0].id, source_system: "rentec", source_record_id: "30" }),
    ]);
  });

  it("tags every candidate row with its Rentec source for idempotent writes", () => {
    const result = resolveRentecImportCandidatesForCommit(input);
    for (const row of [...result.units, ...result.tenants, ...result.leases]) {
      expect(row.source_system).toBe("rentec");
      expect(row.source_record_id).toMatch(/^\d+$/);
    }
  });

  it("produces the same checksum as the public preview for identical evidence", () => {
    expect(resolveRentecImportCandidatesForCommit(input).checksum).toBe(buildRentecImportManifest(input).checksum);
  });

  it("changes checksum if the underlying evidence changes, so a stale commit request can be detected", () => {
    const changed = { ...input, rentecTenants: [{ ...input.rentecTenants[0], email: "different@example.com" }] };
    expect(resolveRentecImportCandidatesForCommit(changed).checksum).not.toBe(resolveRentecImportCandidatesForCommit(input).checksum);
  });
});
