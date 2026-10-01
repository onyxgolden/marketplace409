import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/insurance/partner-status", () => {
  it("always reports not connected — the partner layer is a hard-gated stub", async () => {
    createAuthenticatedRentalManagerApplication.mockResolvedValue({
      user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: null,
    });
    const response = await GET();
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.status.connected).toBe(false);
    expect(body.status.provider).toBeNull();
    expect(body.status.message).toContain("not connected");
    expect(body.status.approvalChecklist.length).toBeGreaterThanOrEqual(4);
  });

  it("passes through the auth gate when unauthenticated", async () => {
    const gated = new Response("unauthorized", { status: 401 });
    createAuthenticatedRentalManagerApplication.mockResolvedValue({ response: gated, supabaseClient: null });
    const response = await GET();
    expect(response.status).toBe(401);
  });
});
