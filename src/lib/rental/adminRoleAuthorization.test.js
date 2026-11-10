// Rental Manager admin roles — slice 1: unit tests for the OR-gate helpers
// in adminRoleAuthorization.js. These gates allow a caller who holds the
// new-framework key OR the existing workspace check (visibility for
// reports, access for invites). The database remains the authority; these
// tests pin the OR logic and the fail-closed behavior.

import { describe, expect, it, vi } from "vitest";

import {
  requireRentalAdminKeyOrWorkspaceAccess,
  requireRentalReportAccess,
} from "./adminRoleAuthorization.js";

function authenticated({ keys = [], visibility = false, access = false, rpcImpl } = {}) {
  const rpc = vi.fn(async (name) => {
    if (rpcImpl) return rpcImpl(name);
    if (name === "rental_get_my_effective_permissions") return { data: keys, error: null };
    if (name === "has_workspace_visibility") return { data: visibility, error: null };
    if (name === "has_workspace_access") return { data: access, error: null };
    return { data: null, error: null };
  });
  return { user: { id: "caller_1" }, effectiveOwnerId: "owner_1", supabaseClient: { rpc } };
}

describe("requireRentalReportAccess", () => {
  it("allows a caller holding the report key without visibility", async () => {
    const gate = await requireRentalReportAccess({ authenticated: authenticated({ keys: ["rental.reports.read"] }), key: "rental.reports.read" });
    expect(gate.response).toBeNull();
  });

  it("allows a caller with visibility but no key (existing access preserved)", async () => {
    const gate = await requireRentalReportAccess({ authenticated: authenticated({ visibility: true }), key: "rental.reports.read" });
    expect(gate.response).toBeNull();
  });

  it("denies a caller with neither the key nor visibility", async () => {
    const gate = await requireRentalReportAccess({ authenticated: authenticated({}), key: "rental.reports.read" });
    expect(gate.response.status).toBe(403);
    expect((await gate.response.json()).error).toMatch(/Missing permission: View reports/);
  });

  it("fails closed when the effective-permissions RPC errors", async () => {
    const auth = authenticated({ visibility: false, rpcImpl: async (name) => {
      if (name === "rental_get_my_effective_permissions") return { data: null, error: { message: "db down" } };
      if (name === "has_workspace_visibility") return { data: false, error: null };
      return { data: null, error: null };
    } });
    const gate = await requireRentalReportAccess({ authenticated: auth, key: "rental.reports.read" });
    expect(gate.response.status).toBe(403);
  });
});

describe("requireRentalAdminKeyOrWorkspaceAccess", () => {
  it("allows a caller holding the invite key without workspace access", async () => {
    const gate = await requireRentalAdminKeyOrWorkspaceAccess({ authenticated: authenticated({ keys: ["rental.tenants.invite"] }), key: "rental.tenants.invite" });
    expect(gate.response).toBeNull();
  });

  it("allows an owner/co-owner (workspace access) without the key", async () => {
    const gate = await requireRentalAdminKeyOrWorkspaceAccess({ authenticated: authenticated({ access: true }), key: "rental.tenants.invite" });
    expect(gate.response).toBeNull();
  });

  it("denies a caller with neither the key nor workspace access", async () => {
    const gate = await requireRentalAdminKeyOrWorkspaceAccess({ authenticated: authenticated({}), key: "rental.tenants.invite" });
    expect(gate.response.status).toBe(403);
    expect((await gate.response.json()).error).toMatch(/Missing permission: Invite tenants/);
  });
});
