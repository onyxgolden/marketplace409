import { describe, expect, it } from "vitest";

import { createRentalTenant } from "../rental-tenant.types";

function buildTenant(overrides = {}) {
  return {
    id: "tenant_1",
    authUserId: null,
    displayName: "First Tenant",
    email: "tenant@example.com",
    phone: null,
    status: "invited" as const,
    invitedAt: "2026-08-12T00:00:00.000Z",
    activatedAt: null,
    createdAt: "2026-08-12T00:00:00.000Z",
    updatedAt: "2026-08-12T00:00:00.000Z",
    ...overrides,
  };
}

describe("RentalTenant", () => {
  it("normalizes an immutable tenant identity", () => {
    const tenant = createRentalTenant(buildTenant({
      displayName: "  First Tenant  ",
      email: "  TENANT@EXAMPLE.COM  ",
      phone: "  409-555-0100  ",
    }));

    expect(tenant.displayName).toBe("First Tenant");
    expect(tenant.email).toBe("tenant@example.com");
    expect(tenant.phone).toBe("409-555-0100");
    expect(Object.isFrozen(tenant)).toBe(true);
  });

  it.each(["invited", "applicant", "active", "former", "inactive"] as const)(
    "supports %s tenants",
    (status) => {
      expect(createRentalTenant(buildTenant({ status })).status).toBe(status);
    },
  );

  it.each([
    ["id", { id: "" }],
    ["name", { displayName: "" }],
    ["email", { email: "not-an-email" }],
    ["invitation", { invitedAt: "not-a-date" }],
    ["activation", { activatedAt: "not-a-date" }],
    ["creation", { createdAt: "not-a-date" }],
  ])("rejects an invalid %s", (_label, overrides) => {
    expect(() => createRentalTenant(buildTenant(overrides))).toThrow();
  });

  it("rejects unsupported statuses", () => {
    expect(() => createRentalTenant(buildTenant({ status: "unknown" }) as never))
      .toThrow("Rental tenant requires a supported status.");
  });
});
