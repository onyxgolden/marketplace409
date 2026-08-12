import { describe, expect, it, vi } from "vitest";
import { resolveRentalLanding } from "./resolveRentalLanding.js";
function client(data, error = null) {
  const query = { select: vi.fn().mockReturnThis(), eq: vi.fn().mockReturnThis(), maybeSingle: vi.fn(async () => ({ data, error })) };
  return { from: vi.fn(() => query), query };
}
describe("resolveRentalLanding", () => {
  it("redirects a linked tenant away from landlord controls", async () => {
    const { from, query } = client({ id: "tenant_1" });
    await expect(resolveRentalLanding({ from }, "auth_tenant_1")).resolves.toBe("/forge/rental/portal");
    expect(query.eq).toHaveBeenCalledWith("auth_user_id", "auth_tenant_1");
  });
  it("allows an authenticated non-tenant to open Rental Manager", async () => {
    const { from } = client(null);
    await expect(resolveRentalLanding({ from }, "owner_1")).resolves.toBeNull();
  });
  it("sends missing identity to sign-in", async () => {
    await expect(resolveRentalLanding(null, "")).resolves.toBe("/auth");
  });
});
