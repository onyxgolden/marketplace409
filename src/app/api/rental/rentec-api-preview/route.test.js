import { beforeEach, describe, expect, it, vi } from "vitest";

const from = vi.fn();
const operationalEvidence = vi.fn();

vi.mock("@/lib/supabase/createAuthenticatedForgeApplication", () => ({
  createAuthenticatedForgeApplication: vi.fn(async () => ({ user: { id: "owner_1" }, supabaseClient: { from } })),
}));

vi.mock("@/domains/rentec-rental-migration/rentec-api.client", () => ({
  createRentecApiClient: vi.fn(() => ({ operationalEvidence })),
}));

import { POST } from "./route.js";

const rentecEvidence = {
  properties: [
    { property_id: 10, address: "1218 Wagner St" },
    { property_id: 11, address: "900 Elm St" },
  ],
  tenants: [
    { renter_id: 20, f_name: "Rachel", l_name: "Renter", email: "rachel@example.com" },
    { renter_id: 21, f_name: "Other", l_name: "Renter", email: "other@example.com" },
  ],
  leases: [
    { lease_id: 30, property_id: 10, renter_id: 20, lease_begin: "2026-06-01", recurring_rent: 1200 },
    { lease_id: 31, property_id: 11, renter_id: 21, lease_begin: "2026-06-01", recurring_rent: 900 },
  ],
};

function request(body) {
  return new Request("https://example.test/api/rental/rentec-api-preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("rentec-api-preview manifest scoping", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    operationalEvidence.mockResolvedValue(rentecEvidence);
    from.mockImplementation(() => ({ select: vi.fn(async () => ({ data: [], error: null })) }));
  });

  it("builds a portfolio-wide manifest when no propertyId is given, unchanged from before", async () => {
    const response = await POST(request({ operation: "manifest-preview" }));
    const body = await response.json();
    expect(body.data.privateRecordCounts).toEqual({ units: 2, tenants: 2, leases: 2 });
  });

  it("scopes the manifest to one property when propertyId is given", async () => {
    const response = await POST(request({ operation: "manifest-preview", propertyId: "10" }));
    const body = await response.json();
    expect(body.data.privateRecordCounts).toEqual({ units: 1, tenants: 1, leases: 1 });
  });

  it("produces a different checksum for the scoped manifest than the portfolio-wide one", async () => {
    const portfolio = await (await POST(request({ operation: "manifest-preview" }))).json();
    const scoped = await (await POST(request({ operation: "manifest-preview", propertyId: "10" }))).json();
    expect(scoped.data.checksum).not.toBe(portfolio.data.checksum);
  });

  it("also scopes resolve-manifest-preview with owner inputs applied", async () => {
    const response = await POST(request({
      operation: "resolve-manifest-preview",
      propertyId: "10",
      ownerInputs: { leaseRentDueDays: { 30: 1 } },
    }));
    const body = await response.json();
    expect(body.data.privateRecordCounts).toEqual({ units: 1, tenants: 1, leases: 1 });
    expect(body.data.readiness.leases).toEqual({ ready: 1, blocked: 0 });
  });
});
