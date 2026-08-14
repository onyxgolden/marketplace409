import { describe, expect, it } from "vitest";
import { buildRentecOwnerInputRequirements, sanitizeRentecOwnerInputs } from "./rentec-owner-input-resolution.preview.js";
import { buildRentecImportManifest } from "./rentec-import-manifest.preview.js";

const evidence = {
  asOf: "2026-08-14",
  rentecProperties: [{ property_id: 10, address: "1218 Wagner St" }],
  rentecTenants: [{ renter_id: 20, f_name: "A", l_name: "Tenant", email: "" }],
  rentecLeases: [{ lease_id: 30, property_id: 10, renter_id: 20, lease_begin: "2026-01-01", lease_end: "2027-01-01", recurring_rent: 1000 }],
};

describe("Rentec owner input resolution preview", () => {
  it("returns only the minimum owner-input requirements", () => {
    const result = buildRentecOwnerInputRequirements(evidence);
    expect(result).toMatchObject({
      mode: "preview_only",
      canCommit: false,
      remaining: { tenantEmails: 1, rentDueDays: 1 },
    });
    expect(result.requirements).toContainEqual(expect.objectContaining({ type: "tenant_email", sourceId: "20", label: "A Tenant" }));
    expect(result.requirements).toContainEqual(expect.objectContaining({ type: "rent_due_day", sourceId: "31", label: "1218 Wagner St" }));
    expect(JSON.stringify(result)).not.toContain("1000");
  });

  it("validates inputs and produces a ready draft lease with a new checksum", () => {
    const unresolved = buildRentecImportManifest(evidence);
    const ownerInputs = sanitizeRentecOwnerInputs({
      tenantEmails: { 20: "owner.supplied@example.com" },
      leaseRentDueDays: { 30: 1, 31: 1 },
    });
    const resolved = buildRentecImportManifest({ ...evidence, ownerInputs });
    const requirements = buildRentecOwnerInputRequirements({ ...evidence, ownerInputs });

    expect(resolved.readiness).toMatchObject({
      tenants: { ready: 1, blocked: 0 },
      leases: { ready: 1, blocked: 0 },
    });
    expect(resolved.blockers).toEqual([]);
    expect(resolved.checksum).not.toBe(unresolved.checksum);
    expect(requirements.requirements).toEqual([]);
    expect(JSON.stringify(resolved)).not.toContain("owner.supplied@example.com");
  });

  it("rejects unsafe email and due-day values", () => {
    expect(() => sanitizeRentecOwnerInputs({ tenantEmails: { 20: "not-an-email" } })).toThrow("valid renter email");
    expect(() => sanitizeRentecOwnerInputs({ leaseRentDueDays: { 30: 31 } })).toThrow("1 through 28");
  });
});
