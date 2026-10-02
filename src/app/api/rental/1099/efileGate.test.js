import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({ createAuthenticatedRentalManagerApplication: vi.fn() }));
vi.mock("@/lib/supabase/getActiveWorkspaceRole", () => ({ getActiveWorkspaceRole: vi.fn() }));
import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActiveWorkspaceRole } from "@/lib/supabase/getActiveWorkspaceRole";
import { POST as submit } from "./efile-submit/route";
import { GET as status } from "./efile-status/route";

function authAs(role = "owner") {
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    user: { id: "user_1" }, effectiveOwnerId: "owner_1", supabaseClient: {},
  });
  getActiveWorkspaceRole.mockResolvedValue(role);
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("e-file gate routes", () => {
  it("GET /efile-status always reports not connected (read-only may read)", async () => {
    authAs("read_only");
    const response = await status(new Request("https://t/"));
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body.efile.connected).toBe(false);
    expect(body.efile.message).toContain("not connected");
  });

  it("POST /efile-submit refuses with 409 and performs no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    authAs("owner");

    const response = await submit(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ taxYear: 2026 }),
    }));
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.success).toBe(false);
    expect(body.submitted).toBe(false);
    expect(body.error).toContain("not connected");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POST /efile-submit 403s for read-only members", async () => {
    authAs("read_only");
    const response = await submit(new Request("https://t/", {
      method: "POST",
      body: JSON.stringify({ taxYear: 2026 }),
    }));
    expect(response.status).toBe(403);
  });
});
