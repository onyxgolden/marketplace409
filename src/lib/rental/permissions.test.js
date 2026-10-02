import { describe, expect, it } from "vitest";
import {
  RENTAL_PERMISSIONS,
  RENTAL_PERMISSION_KEYS,
  RENTAL_PERMISSION_LABELS,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  STAFF_ROLES,
  hasRentalPermission,
  isFullAccessRole,
  resolveEffectivePermissions,
  roleLabel,
} from "./permissions.js";

describe("R17 rental permission catalog", () => {
  it("defines exactly 12 permission keys with label, description, and category", () => {
    expect(RENTAL_PERMISSIONS).toHaveLength(12);
    expect(RENTAL_PERMISSION_KEYS).toHaveLength(12);
    for (const p of RENTAL_PERMISSIONS) {
      expect(p.key).toMatch(/\S+/);
      expect(p.label).toMatch(/^(Can|view)/i);
      expect(p.description).toMatch(/\S+/);
      expect(["Money", "Operations", "Visibility", "Administration"]).toContain(p.category);
    }
  });

  it("keeps the key list and label map in sync", () => {
    for (const key of RENTAL_PERMISSION_KEYS) {
      expect(RENTAL_PERMISSION_LABELS[key]).toBe(RENTAL_PERMISSIONS.find((p) => p.key === key).label);
    }
  });

  it("contains the money permissions the gated routes rely on", () => {
    for (const key of [
      "payments.record", "payments.void_refund", "vendor_bills.manage",
      "vendor_payments.record", "transfers.record", "team.manage",
    ]) {
      expect(RENTAL_PERMISSION_KEYS).toContain(key);
    }
  });

  it("labels are plain English, never key-style", () => {
    expect(RENTAL_PERMISSION_LABELS["payments.record"]).toBe("Can record rent payments");
    expect(RENTAL_PERMISSION_LABELS["team.manage"]).toMatch(/manage the team/);
  });
});

describe("role defaults", () => {
  it("co_owner keeps full access — explicitly unchanged by R17", () => {
    expect([...ROLE_DEFAULT_PERMISSIONS.co_owner].sort()).toEqual([...RENTAL_PERMISSION_KEYS].sort());
  });

  it("property_manager and manager are identical, all except team.manage", () => {
    for (const role of ["property_manager", "manager"]) {
      const perms = ROLE_DEFAULT_PERMISSIONS[role];
      expect(perms).toHaveLength(RENTAL_PERMISSION_KEYS.length - 1);
      expect(perms).not.toContain("team.manage");
      expect(perms).toContain("payments.record");
      expect(perms).toContain("maintenance.manage");
      expect(perms).toContain("settings.manage");
    }
  });

  it("bookkeeper can do money but not manage tenants, properties, maintenance, settings, or the team", () => {
    expect([...ROLE_DEFAULT_PERMISSIONS.bookkeeper].sort()).toEqual(
      ["payments.record", "reports.view", "transfers.record", "vendor_bills.manage", "vendor_payments.record"].sort()
    );
  });

  it("maintenance can manage work orders and message, nothing else", () => {
    expect([...ROLE_DEFAULT_PERMISSIONS.maintenance].sort()).toEqual(["maintenance.manage", "messages.send"].sort());
  });

  it("marketing can manage properties and message, nothing else", () => {
    expect([...ROLE_DEFAULT_PERMISSIONS.marketing].sort()).toEqual(["messages.send", "properties.manage"].sort());
  });

  it("read_only gets nothing", () => {
    expect(ROLE_DEFAULT_PERMISSIONS.read_only).toEqual([]);
  });

  it("STAFF_ROLES covers the Rentec named set without the implicit primary_owner", () => {
    expect(STAFF_ROLES).toContain("property_manager");
    expect(STAFF_ROLES).toContain("maintenance");
    expect(STAFF_ROLES).toContain("marketing");
    expect(STAFF_ROLES).not.toContain("primary_owner");
    for (const role of STAFF_ROLES) {
      expect(roleLabel(role)).not.toBe(role); // every staff role has a display label
    }
  });
});

describe("resolveEffectivePermissions — deny by default with overrides", () => {
  it("returns the role defaults when overrides are absent", () => {
    const perms = resolveEffectivePermissions({ role: "manager" });
    expect(perms).toContain("payments.record");
    expect(perms).not.toContain("team.manage");
  });

  it("grants permissions via a true override", () => {
    const perms = resolveEffectivePermissions({ role: "read_only", overrides: { "payments.record": true } });
    expect(perms).toEqual(["payments.record"]);
  });

  it("revokes permissions via a false override, even for co_owner", () => {
    const perms = resolveEffectivePermissions({ role: "co_owner", overrides: { "team.manage": false } });
    expect(perms).not.toContain("team.manage");
    expect(perms).toContain("payments.record");
  });

  it("ignores unknown keys and non-boolean override values", () => {
    const perms = resolveEffectivePermissions({
      role: "maintenance",
      overrides: { "not.a.key": true, "properties.manage": true, "messages.send": "yes" },
    });
    expect(perms).toContain("properties.manage");
    expect(perms).not.toContain("not.a.key");
    expect(perms).toContain("messages.send"); // default stays; the "yes" string is ignored, not revoked
  });

  it("ignores a non-object overrides payload (e.g. a JSON string)", () => {
    const perms = resolveEffectivePermissions({ role: "read_only", overrides: '{"reports.view":true}' });
    expect(perms).toEqual([]);
  });

  it("denies everything for an unknown role", () => {
    expect(resolveEffectivePermissions({ role: "superadmin" })).toEqual([]);
    expect(resolveEffectivePermissions({})).toEqual([]);
    expect(resolveEffectivePermissions()).toEqual([]);
  });

  it("returns a frozen array", () => {
    const perms = resolveEffectivePermissions({ role: "manager" });
    expect(Array.isArray(perms)).toBe(true);
    expect(Object.isFrozen(perms)).toBe(true);
  });
});

describe("hasRentalPermission", () => {
  it("matches membership in the granted array", () => {
    const perms = resolveEffectivePermissions({ role: "bookkeeper" });
    expect(hasRentalPermission(perms, "payments.record")).toBe(true);
    expect(hasRentalPermission(perms, "team.manage")).toBe(false);
  });

  it("fails closed for non-array inputs", () => {
    expect(hasRentalPermission(null, "payments.record")).toBe(false);
    expect(hasRentalPermission(undefined, "payments.record")).toBe(false);
    expect(hasRentalPermission("payments.record", "payments.record")).toBe(false);
  });
});

describe("isFullAccessRole", () => {
  it("grants full access only to the implicit owner and co-owner", () => {
    expect(isFullAccessRole("primary_owner")).toBe(true);
    expect(isFullAccessRole("co_owner")).toBe(true);
    expect(isFullAccessRole("property_manager")).toBe(false);
    expect(isFullAccessRole("manager")).toBe(false);
    expect(isFullAccessRole("read_only")).toBe(false);
    expect(isFullAccessRole(undefined)).toBe(false);
  });
});

describe("roleLabel", () => {
  it("labels every declared role", () => {
    expect(roleLabel("co_owner")).toBe("Co-owner");
    expect(roleLabel("property_manager")).toBe("Property Manager");
    expect(ROLE_LABELS.primary_owner).toBe("Owner");
  });

  it("falls back to the raw value for unknown roles", () => {
    expect(roleLabel("mystery")).toBe("mystery");
  });
});

describe("NO-GO fix 2026-10-01 (finding 2): team.manage never granted to staff", () => {
  it("strips team.manage from a staff override even when explicitly set true", () => {
    for (const role of ["property_manager", "manager", "bookkeeper", "maintenance", "marketing", "read_only"]) {
      const perms = resolveEffectivePermissions({ role, overrides: { "team.manage": true } });
      expect(perms).not.toContain("team.manage");
    }
  });

  it("strips team.manage from property_manager/manager defaults (everything-except-team)", () => {
    // The EVERYTHING_EXCEPT_TEAM default already excludes it; this guards against regressions
    // if the default set is ever rebuilt to include it.
    const perms = resolveEffectivePermissions({ role: "property_manager", overrides: { "team.manage": true } });
    expect(perms).not.toContain("team.manage");
    expect(perms).toContain("payments.record"); // other permissions unaffected
  });

  it("still grants team.manage to co_owner (full-access role, unchanged)", () => {
    const perms = resolveEffectivePermissions({ role: "co_owner", overrides: {} });
    expect(perms).toContain("team.manage");
  });
});
