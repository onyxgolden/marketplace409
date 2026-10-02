import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { GET, POST, DELETE } from "./route";

function makeClient({ recipient = { id: "r1", kind: "owner" }, links = [] } = {}) {
  const state = { links: [...links] };
  return {
    state,
    from: vi.fn((table) => {
      if (table === "rental_1099_recipients") {
        return {
          select: vi.fn().mockReturnThis(),
          eq: vi.fn().mockReturnThis(),
          maybeSingle: vi.fn().mockResolvedValue({ data: recipient, error: null }),
        };
      }
      return {
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockResolvedValue({ data: state.links, error: null }),
        upsert: vi.fn().mockImplementation((row) => {
          state.links.push({ property_id: row.property_id, created_at: new Date().toISOString() });
          return Promise.resolve({ error: null });
        }),
        delete: vi.fn().mockReturnThis(),
        then: undefined,
      };
    }),
  };
}

function authAs(role, client) {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient: client,
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

const params = { id: "r1" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("1099 recipient property links (gross-rent attribution)", () => {
  it("GET returns linked property ids", async () => {
    const client = makeClient({ links: [{ property_id: "p1", created_at: "2026-01-01" }] });
    authAs(null, client);
    const response = await GET(new Request("https://t/"), { params });
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.propertyIds).toEqual(["p1"]);
  });

  it("POST links a property for an owner recipient", async () => {
    const client = makeClient();
    authAs(null, client);
    const response = await POST(
      new Request("https://t/", { method: "POST", body: JSON.stringify({ propertyId: "p9" }) }),
      { params }
    );
    expect(response.status).toBe(200);
    expect(client.state.links).toHaveLength(1);
  });

  it("POST 404s for a missing recipient", async () => {
    const client = makeClient({ recipient: null });
    authAs(null, client);
    const response = await POST(
      new Request("https://t/", { method: "POST", body: JSON.stringify({ propertyId: "p9" }) }),
      { params }
    );
    expect(response.status).toBe(404);
  });

  it("POST 400s for a vendor recipient (owners only)", async () => {
    const client = makeClient({ recipient: { id: "r1", kind: "vendor" } });
    authAs(null, client);
    const response = await POST(
      new Request("https://t/", { method: "POST", body: JSON.stringify({ propertyId: "p9" }) }),
      { params }
    );
    expect(response.status).toBe(400);
  });

  it("POST 403s for read-only members", async () => {
    const client = makeClient();
    authAs("read_only", client);
    const response = await POST(
      new Request("https://t/", { method: "POST", body: JSON.stringify({ propertyId: "p9" }) }),
      { params }
    );
    expect(response.status).toBe(403);
    expect(client.state.links).toHaveLength(0);
  });

  it("DELETE unlinks a property", async () => {
    const client = makeClient({ links: [{ property_id: "p1", created_at: "2026-01-01" }] });
    // Wire delete to actually remove
    client.from = vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: client.state.links, error: null }),
      delete: vi.fn().mockImplementation(() => ({
        eq: vi.fn().mockReturnThis(),
        then: (resolve) => {
          client.state.links = [];
          return Promise.resolve({ error: null }).then(resolve);
        },
      })),
    }));
    authAs(null, client);
    const response = await DELETE(new Request("https://t/?propertyId=p1"), { params });
    expect(response.status).toBe(200);
  });
});
