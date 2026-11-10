// Work Package Planner admin permissions slice 1 — application tests.
// Supabase-shaped chain mock, same convention as craftAssignments.test.js:
// db.rpc() for every write/read RPC, db.from() chain only for the audit
// log list. Covers the pre-migration window (missing RPC -> 503) and the
// PADM1_* error-code -> httpStatus mapping.

import { describe, expect, it, vi } from "vitest";
import {
  getRolesSnapshot,
  provisionStarterRoles,
  createRole,
  setRoleCapability,
  assignRole,
  revokeAssignment,
  searchStaff,
  getAuditLog,
  mapPlannerAdminRpcError,
} from "./plannerAdmin.js";

function mockDb({ rpcResult = { data: null, error: null }, fromChain = null } = {}) {
  return {
    rpc: vi.fn(async () => rpcResult),
    from: vi.fn(() => fromChain),
  };
}

function chain(result = { data: [], error: null }) {
  const node = {
    select: vi.fn(() => node),
    eq: vi.fn(() => node),
    order: vi.fn(() => node),
    range: vi.fn(async () => result),
  };
  return node;
}

const OWNER = "owner_1";

describe("mapPlannerAdminRpcError", () => {
  it("maps a missing RPC to 503 not-applied-yet", () => {
    const result = mapPlannerAdminRpcError({ code: "42883", message: "function does not exist" });
    expect(result).toEqual({ ok: false, httpStatus: 503, error: "Planner role administration is not available yet." });
  });

  it("maps PADM1_VERSION_CONFLICT to 409", () => {
    const result = mapPlannerAdminRpcError({ message: "PADM1_VERSION_CONFLICT" });
    expect(result.httpStatus).toBe(409);
  });

  it("maps PADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER to a 403 with a plain-English reason", () => {
    const result = mapPlannerAdminRpcError({ message: "PADM1_CANNOT_ASSIGN_OWNER_OR_COOWNER" });
    expect(result.httpStatus).toBe(403);
    expect(result.error).toMatch(/already have full access/);
  });

  it("rethrows an unrecognized error so the route turns it into a 500", () => {
    const error = new Error("boom");
    expect(() => mapPlannerAdminRpcError(error)).toThrow("boom");
  });
});

describe("getRolesSnapshot", () => {
  it("returns the snapshot payload as-is", async () => {
    const db = mockDb({ rpcResult: { data: { roles: [], capabilities: [], assignments: [] }, error: null } });
    const result = await getRolesSnapshot(db, { ownerId: OWNER });
    expect(result.ok).toBe(true);
    expect(db.rpc).toHaveBeenCalledWith("forge_planner_roles_snapshot", { p_owner_id: OWNER });
  });

  it("reports 503 before the migration is applied", async () => {
    const db = mockDb({ rpcResult: { data: null, error: { code: "PGRST202", message: "Could not find the function" } } });
    const result = await getRolesSnapshot(db, { ownerId: OWNER });
    expect(result).toEqual({ ok: false, httpStatus: 503, error: "Planner role administration is not available yet." });
  });
});

describe("provisionStarterRoles", () => {
  it("passes owner and request id through and returns the created roles", async () => {
    const roles = [{ id: "forge_pr_1", role_key: "planner" }];
    const db = mockDb({ rpcResult: { data: roles, error: null } });
    const result = await provisionStarterRoles(db, { ownerId: OWNER, requestId: "req-1" });
    expect(result).toEqual({ ok: true, roles });
    expect(db.rpc).toHaveBeenCalledWith("forge_planner_roles_provision_starter_set", {
      p_owner_id: OWNER,
      p_request_id: "req-1",
    });
  });
});

describe("createRole", () => {
  it("creates a role and returns the single row", async () => {
    const row = { id: "forge_pr_2", role_key: "custom", name: "Custom" };
    const db = mockDb({ rpcResult: { data: [row], error: null } });
    const result = await createRole(db, { ownerId: OWNER, roleKey: "custom", name: "Custom", requestId: "req-2" });
    expect(result).toEqual({ ok: true, role: row });
  });
});

describe("setRoleCapability", () => {
  it("surfaces a stale-version conflict as 409", async () => {
    const db = mockDb({ rpcResult: { data: null, error: { message: "PADM1_VERSION_CONFLICT" } } });
    const result = await setRoleCapability(db, {
      ownerId: OWNER, roleId: "role_1", capabilityKey: "planner.packages.read",
      grant: true, expectedVersion: 1, requestId: "req-3",
    });
    expect(result.httpStatus).toBe(409);
  });
});

describe("assignRole", () => {
  it("surfaces PADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES as 403", async () => {
    const db = mockDb({ rpcResult: { data: null, error: { message: "PADM1_CANNOT_ASSIGN_ROLE_EXCEEDING_OWN_CAPABILITIES" } } });
    const result = await assignRole(db, { ownerId: OWNER, assigneeUserId: "staff_1", roleId: "role_1", requestId: "req-4" });
    expect(result.httpStatus).toBe(403);
  });
});

describe("revokeAssignment", () => {
  it("returns the revoked assignment row", async () => {
    const row = { id: "assign_1", retired_at: "t1" };
    const db = mockDb({ rpcResult: { data: [row], error: null } });
    const result = await revokeAssignment(db, { ownerId: OWNER, assignmentId: "assign_1", expectedVersion: 1, requestId: "req-5" });
    expect(result).toEqual({ ok: true, assignment: row });
  });
});

describe("searchStaff", () => {
  it("passes null for an omitted search param rather than an empty string", async () => {
    const db = mockDb({ rpcResult: { data: [], error: null } });
    await searchStaff(db, { ownerId: OWNER, userId: "staff_1", email: "" });
    expect(db.rpc).toHaveBeenCalledWith("forge_planner_staff_search", {
      p_owner_id: OWNER, p_user_id: "staff_1", p_email: null,
    });
  });

  it("returns an empty array, not an error, for no match", async () => {
    const db = mockDb({ rpcResult: { data: [], error: null } });
    const result = await searchStaff(db, { ownerId: OWNER, email: "nobody@example.com" });
    expect(result).toEqual({ ok: true, results: [] });
  });
});

describe("getAuditLog", () => {
  it("rejects an out-of-range limit before querying", async () => {
    const db = mockDb();
    const result = await getAuditLog(db, { ownerId: OWNER, limit: 500 });
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });

  it("returns entries ordered newest-first", async () => {
    const entries = [{ id: "a1", action: "role_create" }];
    const db = mockDb({ fromChain: chain({ data: entries, error: null }) });
    const result = await getAuditLog(db, { ownerId: OWNER, limit: 10, offset: 0 });
    expect(result).toEqual({ ok: true, entries });
  });

  it("treats a missing table (pre-migration) as an empty list, not an error", async () => {
    const db = mockDb({ fromChain: chain({ data: null, error: { code: "42P01" } }) });
    const result = await getAuditLog(db, { ownerId: OWNER });
    expect(result).toEqual({ ok: true, entries: [] });
  });
});
