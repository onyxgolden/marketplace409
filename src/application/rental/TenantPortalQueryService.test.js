import { describe, expect, it, vi } from "vitest";
import { TenantPortalQueryService } from "./TenantPortalQueryService.js";
describe("TenantPortalQueryService", () => {
  it("returns null when the authenticated user has no tenant identity", async () => {
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
    Object.values(query).forEach((method) => method.mockReturnValue(query));
    query.maybeSingle.mockResolvedValue({ data: null, error: null });
    await expect(new TenantPortalQueryService({ from: vi.fn(() => query) }).load("auth_1")).resolves.toBeNull();
    expect(query.eq).toHaveBeenCalledWith("auth_user_id", "auth_1");
  });
  it("requires an authenticated identity", async () => {
    await expect(new TenantPortalQueryService({ from: vi.fn() }).load("")).rejects.toThrow("auth user id is required");
  });

  function chain(result) {
    const node = { select: vi.fn(() => node), eq: vi.fn(() => node), in: vi.fn(() => node),
      order: vi.fn(() => node), maybeSingle: vi.fn(async () => result), then: (resolve) => resolve(result) };
    return node;
  }

  it("surfaces the owner-level billingEnabled flag on the portal, even when the tenant has no lease memberships", async () => {
    const tables = {
      rental_tenants: chain({ data: { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "T",
        email: "t@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null }),
      rental_billing_settings: chain({ data: { billing_enabled: true }, error: null }),
      rental_lease_tenants: chain({ data: [], error: null }),
    };
    const service = new TenantPortalQueryService({ from: vi.fn((table) => tables[table]) });
    const portal = await service.load("auth_1");
    expect(portal.billingEnabled).toBe(true);
    expect(portal.rentals).toEqual([]);
  });

  it("defaults billingEnabled to false when no rental_billing_settings row exists yet for the owner", async () => {
    const tables = {
      rental_tenants: chain({ data: { id: "tenant_1", owner_id: "owner_1", auth_user_id: "auth_1", display_name: "T",
        email: "t@example.com", phone: null, status: "active", invited_at: null, activated_at: null,
        created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }, error: null }),
      rental_billing_settings: chain({ data: null, error: null }),
      rental_lease_tenants: chain({ data: [], error: null }),
    };
    const service = new TenantPortalQueryService({ from: vi.fn((table) => tables[table]) });
    const portal = await service.load("auth_1");
    expect(portal.billingEnabled).toBe(false);
  });
});
