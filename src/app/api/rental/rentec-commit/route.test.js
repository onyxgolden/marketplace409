import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const rpc = vi.fn();
const operationalEvidence = vi.fn();

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(async () => ({
    user: { id: "owner_1" },
    supabaseClient: { from, rpc },
  })),
}));

vi.mock("@/domains/rentec-rental-migration/rentec-api.client", () => ({
  createRentecApiClient: vi.fn(() => ({ operationalEvidence })),
}));

import { POST } from "./route.js";
import { buildRentecImportManifest } from "@/domains/rentec-rental-migration/rentec-import-manifest.preview";

const rentecEvidence = {
  properties: [{ property_id: 10, address: "1218 Wagner St" }],
  tenants: [{ renter_id: 20, f_name: "Rachel", l_name: "Renter", email: "rachel@example.com" }],
  leases: [{ lease_id: 30, property_id: 10, renter_id: 20, lease_begin: "2026-06-01", recurring_rent: 1200 }],
};

function request(body) {
  return new Request("https://example.test/api/rental/rentec-commit", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function previewChecksum(ownerInputs) {
  return buildRentecImportManifest({
    rentecProperties: rentecEvidence.properties,
    rentecTenants: rentecEvidence.tenants,
    rentecLeases: rentecEvidence.leases,
    ownerInputs,
  }).checksum;
}

describe("rentec commit route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operationalEvidence.mockResolvedValue(rentecEvidence);
    from.mockImplementation(() => ({ select: vi.fn(async () => ({ data: [], error: null })) }));
    rpc.mockResolvedValue({ data: { unitsCreated: 1, tenantsCreated: 1, leasesCreated: 1, leaseTenantsCreated: 1 }, error: null });
  });

  it("requires a property id", async () => {
    const response = await POST(request({ expectedChecksum: "a".repeat(64) }));
    expect(response.status).toBe(400);
  });

  it("requires a well-formed checksum", async () => {
    const response = await POST(request({ propertyId: "10", expectedChecksum: "not-a-checksum" }));
    expect(response.status).toBe(400);
  });

  it("refuses to commit when the rebuilt checksum does not match what was previewed", async () => {
    const response = await POST(request({ propertyId: "10", expectedChecksum: "a".repeat(64) }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error).toMatch(/changed since this import was last previewed/);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses to commit while blockers remain (missing rent due day)", async () => {
    const checksum = previewChecksum({});
    const response = await POST(request({ propertyId: "10", expectedChecksum: checksum }));
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.blockers).toContainEqual(expect.objectContaining({ label: "Rent due day requires owner input" }));
    expect(rpc).not.toHaveBeenCalled();
  });

  it("commits via the RPC once fully resolved and the checksum matches", async () => {
    const ownerInputs = { leaseRentDueDays: { 30: 1 } };
    const checksum = previewChecksum(ownerInputs);
    const response = await POST(request({ propertyId: "10", expectedChecksum: checksum, ownerInputs }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.result.leasesCreated).toBe(1);
    expect(rpc).toHaveBeenCalledWith(
      "commit_rentec_rental_import",
      expect.objectContaining({
        p_owner_id: "owner_1",
        p_units: expect.arrayContaining([expect.objectContaining({ source_record_id: "10" })]),
        p_tenants: expect.arrayContaining([expect.objectContaining({ source_record_id: "20" })]),
        p_leases: expect.arrayContaining([expect.objectContaining({ source_record_id: "30" })]),
      }),
    );
  });

  it("only ever scopes candidates to the requested property, even if Rentec returns others", async () => {
    operationalEvidence.mockResolvedValue({
      properties: [...rentecEvidence.properties, { property_id: 11, address: "Other House" }],
      tenants: [...rentecEvidence.tenants, { renter_id: 21, f_name: "Other", l_name: "Renter", email: "other@example.com" }],
      leases: [...rentecEvidence.leases, { lease_id: 31, property_id: 11, renter_id: 21, lease_begin: "2026-06-01", recurring_rent: 900 }],
    });
    const ownerInputs = { leaseRentDueDays: { 30: 1 } };
    const checksum = previewChecksum(ownerInputs);
    await POST(request({ propertyId: "10", expectedChecksum: checksum, ownerInputs }));
    const [, rpcArgs] = rpc.mock.calls[0];
    expect(rpcArgs.p_leases).toHaveLength(1);
    expect(rpcArgs.p_leases[0].source_record_id).toBe("30");
  });

  it("refuses to commit when there is nothing new for this property", async () => {
    from.mockImplementation(() => ({
      select: vi.fn(async () => ({
        data: [{ id: "rental_unit_rentec_10", property_id: "wagner-st", label: "1218 Wagner St", status: "preparing" }],
        error: null,
      })),
    }));
    // With the unit already present and no tenants/leases resolvable
    // against it in this minimal fixture, nothing new should be staged.
    const checksum = previewChecksum({});
    const response = await POST(request({ propertyId: "10", expectedChecksum: checksum }));
    expect([409]).toContain(response.status);
    expect(rpc).not.toHaveBeenCalled();
  });
});
