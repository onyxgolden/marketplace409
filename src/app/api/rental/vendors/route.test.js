import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST } from "./route";

const vendor = {
  id: "rental_vendor_1", name: "Acme Plumbing", contact_name: "Sam",
  email: null, phone: null, address: null, trade: "Plumbing",
  tax_classification: null, tax_id_last4: null, notes: null,
  is_active: true, created_at: null, updated_at: null,
};

// Chainable builder whose terminal await resolves a canned list result.
function listBuilder(rows) {
  const b = {
    select() { return b; },
    eq() { return b; },
    order() { return b; },
    or() { return b; },
    then(resolve) { resolve({ data: rows, error: null }); },
  };
  return b;
}

function authAs(client, role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const get = (query = "") => GET(new Request(`https://t/${query}`));
const post = (body) => POST(new Request("https://t/", { method: "POST", body: JSON.stringify(body) }));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/rental/vendors", () => {
  it("lists the owner's vendors serialized to camelCase", async () => {
    const client = { from: vi.fn(() => listBuilder([vendor])) };
    authAs(client);
    const response = await get();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.vendors).toHaveLength(1);
    expect(body.vendors[0]).toMatchObject({ name: "Acme Plumbing", contactName: "Sam", trade: "Plumbing", isActive: true });
    expect(client.from).toHaveBeenCalledWith("rental_vendors");
  });
});

describe("POST /api/rental/vendors", () => {
  it("blocks read-only members with 403", async () => {
    const client = { from: vi.fn() };
    authAs(client, "read_only");
    expect((await post({ name: "New Co" })).status).toBe(403);
    expect(client.from).not.toHaveBeenCalled();
  });

  it("rejects a blank name with 400", async () => {
    const client = { from: vi.fn() };
    authAs(client);
    expect((await post({ name: "   " })).status).toBe(400);
  });

  it("rejects a duplicate name (case-insensitive) with 409", async () => {
    const client = {
      from: vi.fn(() => ({
        select: () => ({ eq: () => Promise.resolve({ data: [{ name: "Acme Plumbing" }], error: null }) }),
      })),
    };
    authAs(client);
    const response = await post({ name: "acme plumbing" });
    expect(response.status).toBe(409);
    expect((await response.json()).error).toMatch(/already exists/);
  });

  it("creates the vendor with 201 and a prefixed id", async () => {
    let inserted = null;
    const client = {
      from: vi.fn(() => ({
        select: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }),
        insert: (row) => {
          inserted = row;
          return { select: () => ({ single: () => Promise.resolve({ data: { ...vendor, ...row }, error: null }) }) };
        },
      })),
    };
    authAs(client);
    const response = await post({ name: "New Co", trade: "HVAC", taxIdLast4: "9876" });
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.vendor.name).toBe("New Co");
    expect(inserted.owner_id).toBe("owner_1");
    expect(inserted.id.startsWith("rental_vendor_")).toBe(true);
    expect(inserted.trade).toBe("HVAC");
    expect(inserted.tax_id_last4).toBe("9876");
    expect(inserted.is_active).toBe(true);
  });
});
