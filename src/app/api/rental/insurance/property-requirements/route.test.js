import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

function mockClient({ rows = [], upserted = null } = {}) {
  const builder = {
    _table: null,
    from(table) { builder._table = table; return builder; },
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    upsert(row) { builder._upserted = row; return builder; },
    single() { return Promise.resolve({ data: upserted || builder._upserted || null, error: null }); },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return builder;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

function post(body) {
  return new Request("https://t/api/rental/insurance/property-requirements", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/insurance/property-requirements", () => {
  it("lists the property requirement rows for the workspace", async () => {
    authAs(mockClient({ rows: [{ property_id: "prop_1", requires_renters_insurance: true }] }));
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.requirements).toHaveLength(1);
  });
});

describe("POST /api/rental/insurance/property-requirements", () => {
  it("upserts the property requirement for a writer", async () => {
    const client = mockClient({ upserted: { property_id: "prop_1", requires_renters_insurance: true, requires_pet_records: false } });
    authAs(client);
    const response = await POST(post({ propertyId: "prop_1", requiresRentersInsurance: true }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.requirement.property_id).toBe("prop_1");
  });

  it("returns 403 for read-only members", async () => {
    authAs(mockClient(), "read_only");
    const response = await POST(post({ propertyId: "prop_1" }));
    expect(response.status).toBe(403);
    expect((await response.json()).error).toContain("Read-only");
  });

  it("returns 400 when the property id is missing", async () => {
    authAs(mockClient());
    const response = await POST(post({ requiresRentersInsurance: true }));
    expect(response.status).toBe(400);
  });
});
