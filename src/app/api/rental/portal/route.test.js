import { beforeEach, describe, expect, it, vi } from "vitest";
const load = vi.fn();
const rpc = vi.fn();
vi.mock("@/lib/supabase/createAuthenticatedTenantPortalApplication", () => ({
  createAuthenticatedTenantPortalApplication: vi.fn(async () => ({ user: { id: "auth_tenant_1" },
    supabaseClient: { rpc }, application: { load } })),
}));
import { GET } from "./route.js";
describe("tenant portal route", () => {
  beforeEach(() => vi.clearAllMocks());
  it("claims a matching confirmed invitation before reloading portal access", async () => {
    load.mockResolvedValueOnce(null).mockResolvedValueOnce({ tenant: { id: "tenant_1" }, rentals: [] });
    rpc.mockResolvedValue({ data: { tenantId: "tenant_1", status: "active" }, error: null });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("claim_rental_tenant_portal");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("does not claim again when portal access is already linked", async () => {
    load.mockResolvedValue({ tenant: { id: "tenant_1" }, rentals: [] });
    const response = await GET();
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });
});
