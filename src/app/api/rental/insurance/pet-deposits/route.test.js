import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

function mockClient({ animalExists = true, saved = null } = {}) {
  const builder = {
    _table: null,
    from(table) { builder._table = table; return builder; },
    select() { return builder; },
    eq() { return builder; },
    order() { return builder; },
    maybeSingle() { return Promise.resolve({ data: animalExists ? { id: "animal_1", tenant_id: "tenant_1", lease_id: "lease_1" } : null, error: null }); },
    insert(row) { builder._inserted = row; return builder; },
    single() { return Promise.resolve({ data: saved || builder._inserted || null, error: null }); },
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
  return new Request("https://t/api/rental/insurance/pet-deposits", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/rental/insurance/pet-deposits", () => {
  it("records a pet deposit tied to the canonical animal record", async () => {
    const client = mockClient({ saved: { id: "dep_1", animal_id: "animal_1", amount_cents: 25000, status: "held" } });
    authAs(client);
    const response = await POST(post({ animalId: "animal_1", amountCents: 25000 }));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.deposit.amount_cents).toBe(25000);
  });

  it("returns 400 for a non-positive amount or bad status", async () => {
    authAs(mockClient());
    expect((await POST(post({ animalId: "animal_1", amountCents: 0 }))).status).toBe(400);
    expect((await POST(post({ animalId: "animal_1", amountCents: 25000, status: "lost" }))).status).toBe(400);
  });

  it("returns 404 when the animal is not in this workspace", async () => {
    authAs(mockClient({ animalExists: false }));
    expect((await POST(post({ animalId: "animal_nope", amountCents: 25000 }))).status).toBe(404);
  });

  it("returns 403 for read-only members", async () => {
    authAs(mockClient(), "read_only");
    expect((await POST(post({ animalId: "animal_1", amountCents: 25000 }))).status).toBe(403);
  });
});

describe("GET /api/rental/insurance/pet-deposits", () => {
  it("returns 200 with the deposit list", async () => {
    authAs(mockClient());
    const response = await GET(new Request("https://t/api/rental/insurance/pet-deposits?animalId=animal_1"));
    expect(response.status).toBe(200);
    expect((await response.json()).deposits).toEqual([]);
  });
});
