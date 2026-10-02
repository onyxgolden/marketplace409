import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/createAuthenticatedRentalManagerApplication", () => ({
  createAuthenticatedRentalManagerApplication: vi.fn(),
}));
vi.mock("@/lib/rental/teamAuthorization", () => ({
  getActorRentalAuthorization: vi.fn(),
  requireTeamManager: vi.fn(),
}));

import { createAuthenticatedRentalManagerApplication } from "@/lib/supabase/createAuthenticatedRentalManagerApplication";
import { getActorRentalAuthorization } from "@/lib/rental/teamAuthorization";
import { GET } from "./route.js";

const request = () => new Request("https://t/api/rental/team/permissions");

function authed() {
  const supabaseClient = { rpc: vi.fn() };
  createAuthenticatedRentalManagerApplication.mockResolvedValue({
    response: null,
    user: { id: "owner_1" },
    effectiveOwnerId: "owner_1",
    supabaseClient,
  });
  return supabaseClient;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/rental/team/permissions", () => {
  it("returns the actor's effective permissions for UI hiding", async () => {
    authed();
    getActorRentalAuthorization.mockResolvedValue({
      forbidden: null,
      role: "bookkeeper",
      isPrimaryOwner: false,
      permissions: ["payments.record", "reports.view"],
      preview: null,
    });
    const response = await GET(request());
    const body = await response.json();
    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      success: true,
      role: "bookkeeper",
      roleLabel: "Bookkeeper",
      isPrimaryOwner: false,
      permissions: ["payments.record", "reports.view"],
      preview: null,
    });
    expect(body.permissionCatalog).toHaveLength(12);
  });

  it("reports the preview target's permissions while previewing", async () => {
    authed();
    getActorRentalAuthorization.mockResolvedValue({
      forbidden: null,
      role: "primary_owner",
      isPrimaryOwner: true,
      permissions: ["maintenance.manage", "messages.send"],
      preview: { memberId: "member_staff", role: "maintenance", email: "m@example.com" },
    });
    const body = await (await GET(request())).json();
    expect(body.permissions).toEqual(["maintenance.manage", "messages.send"]);
    expect(body.preview).toMatchObject({ memberId: "member_staff", role: "maintenance", roleLabel: "Maintenance" });
  });

  it("passes through a forbidden authorization (invalid preview cookie fails closed)", async () => {
    authed();
    const { NextResponse } = await import("next/server");
    getActorRentalAuthorization.mockResolvedValue({
      forbidden: NextResponse.json({ error: "invalid" }, { status: 403 }),
    });
    const response = await GET(request());
    expect(response.status).toBe(403);
  });
});
