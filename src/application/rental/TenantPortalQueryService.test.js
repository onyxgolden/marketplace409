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
});
