import { beforeEach, describe, expect, it, vi } from "vitest";

// The owner/co-owner gate (isOwnerOrActiveCoOwner) runs unmocked and reads the
// mocked workspace_members table: a mutable memberRole fixture drives it.
let memberRole = null;
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  memberRole = null; // primary owner: no membership row
});

function authAs() {
  const memberTable = {
    select() { return memberTable; },
    eq() { return memberTable; },
    async maybeSingle() { return { data: memberRole ? { role: memberRole } : null, error: null }; },
  };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: { from: vi.fn(() => memberTable) },
  });
}

describe("mailing provider route", () => {
  it("GET reports the provider as not connected", async () => {
    authAs();
    const res = await GET(new Request("https://t/"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provider.connected).toBe(false);
    expect(body.provider.message).toMatch(/not connected/);
    expect(body.provider.pendingApprovals).toHaveLength(3);
  });

  it("POST is refused with 409 — no send, no credentials, no network", async () => {
    authAs();
    const res = await POST(new Request("https://t/", { method: "POST" }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error).toMatch(/not connected/i);
    expect(body.provider.connected).toBe(false);
  });

  describe("owner/co-owner authorization", () => {
    const staffRoles = ["manager", "bookkeeper", "read_only"];
    it.each(staffRoles)("blocks %s from attempting a provider send with 403", async (role) => {
      memberRole = role;
      authAs();
      const res = await POST(new Request("https://t/", { method: "POST" }));
      expect(res.status).toBe(403);
      expect((await res.json()).error).toContain("owner or co-owner");
    });
    it("lets an active co_owner attempt the send (still 409 — provider not connected)", async () => {
      memberRole = "co_owner";
      authAs();
      const res = await POST(new Request("https://t/", { method: "POST" }));
      expect(res.status).toBe(409);
    });
  });
});
