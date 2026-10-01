import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

function mockClient({ leaseExists = true, saved = null } = {}) {
  const builder = {
    _table: null,
    from(table) { builder._table = table; return builder; },
    select() { return builder; },
    eq() { return builder; },
    maybeSingle() { return Promise.resolve({ data: leaseExists ? { id: "lease_1" } : null, error: null }); },
    upsert(row) { builder._upserted = row; return builder; },
    single() { return Promise.resolve({ data: saved || builder._upserted || null, error: null }); },
    then(resolve) { resolve({ data: [], error: null }); },
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
  return new Request("https://t/api/rental/insurance/deposit-choice", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/insurance/deposit-choice", () => {
  it("records the traditional deposit choice", async () => {
    const client = mockClient({ saved: { lease_id: "lease_1", choice: "traditional_security_deposit" } });
    authAs(client);
    const response = await POST(post({ leaseId: "lease_1", choice: "traditional_security_deposit" }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.choice.choice).toBe("traditional_security_deposit");
  });

  it("returns 400 when the deposit-insurance product choice has no product reference", async () => {
    authAs(mockClient());
    const response = await POST(post({ leaseId: "lease_1", choice: "deposit_insurance_product" }));
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain("product reference");
  });

  it("returns 404 when the lease is not in this workspace", async () => {
    authAs(mockClient({ leaseExists: false }));
    const response = await POST(post({ leaseId: "lease_nope", choice: "traditional_security_deposit" }));
    expect(response.status).toBe(404);
  });

  it("returns 403 for read-only members", async () => {
    authAs(mockClient(), "read_only");
    const response = await POST(post({ leaseId: "lease_1", choice: "traditional_security_deposit" }));
    expect(response.status).toBe(403);
  });
});

describe("GET /api/rental/insurance/deposit-choice", () => {
  it("returns 200 with the recorded choices", async () => {
    authAs(mockClient());
    const response = await GET(new Request("https://t/api/rental/insurance/deposit-choice?leaseId=lease_1"));
    expect(response.status).toBe(200);
    expect((await response.json()).choices).toEqual([]);
  });
});
