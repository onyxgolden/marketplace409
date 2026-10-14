import { afterEach, describe, expect, it, vi } from "vitest";

import { adminRecoveryAdapter, createServerAuthClient } from "./serverAuthTransport.js";

vi.mock("@supabase/supabase-js", () => ({
  createClient: vi.fn(() => ({ kind: "mock-client" })),
}));

import { createClient } from "@supabase/supabase-js";

afterEach(() => {
  vi.clearAllMocks();
  delete globalThis.window;
  delete globalThis.document;
});

const ENV = {
  NEXT_PUBLIC_SUPABASE_URL: "https://db.test",
  SUPABASE_SERVICE_ROLE_KEY: "service-secret",
};

describe("createServerAuthClient", () => {
  it("builds a sessionless service-role client from server env", () => {
    const client = createServerAuthClient(ENV);
    expect(client).toEqual({ kind: "mock-client" });
    expect(createClient).toHaveBeenCalledWith("https://db.test", "service-secret", {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  });

  it("throws when called in a browser", () => {
    globalThis.window = {};
    expect(() => createServerAuthClient(ENV)).toThrow(/server-only/i);
  });

  it("fails closed without the service-role key", () => {
    expect(() =>
      createServerAuthClient({ NEXT_PUBLIC_SUPABASE_URL: "https://db.test" })
    ).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
  });

  it("fails closed without the Supabase URL", () => {
    expect(() =>
      createServerAuthClient({ SUPABASE_SERVICE_ROLE_KEY: "service-secret" })
    ).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});

function mockAdminClient() {
  return {
    auth: {
      admin: {
        _deleteFactor: vi.fn(() => Promise.resolve({ data: {}, error: null })),
        signOut: vi.fn(() => Promise.resolve({ data: {}, error: null })),
        listUsers: vi.fn(),
        updateUserById: vi.fn(),
      },
    },
    from: vi.fn(() => ({
      insert: vi.fn(() => Promise.resolve({ error: null })),
    })),
  };
}

describe("adminRecoveryAdapter", () => {
  it("exposes ONLY deleteFactor and revokeSessions", () => {
    const adapter = adminRecoveryAdapter(mockAdminClient());
    expect(Object.keys(adapter).sort()).toEqual(["deleteFactor", "revokeSessions"]);
  });

  it("deleteFactor audits first, then removes the factor via the real SDK method", async () => {
    const admin = mockAdminClient();
    const adapter = adminRecoveryAdapter(admin);
    const result = await adapter.deleteFactor("user-1", "factor-1", "audit-1");
    expect(result).toEqual({ deleted: true });
    expect(admin.from).toHaveBeenCalledWith("mfa_audit_log");
    const insertPayload = admin.from.mock.results[0].value.insert.mock.calls[0][0];
    // Audit shape matches the migration table (id, audit_id, action, actor,
    // user_id, metadata) — NOT the old details/created_at shape.
    expect(insertPayload).toMatchObject({
      audit_id: "audit-1",
      action: "factor.delete",
      actor: "gateway",
      user_id: "user-1",
      metadata: { factorId: "factor-1" },
    });
    expect(insertPayload.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(insertPayload).not.toHaveProperty("details");
    // L2-003: the locked SDK exposes only _deleteFactor({ userId, id }).
    expect(admin.auth.admin._deleteFactor).toHaveBeenCalledWith({ userId: "user-1", id: "factor-1" });
  });

  it("revokeSessions audits first, then signs out with the user's JWT (global scope)", async () => {
    const admin = mockAdminClient();
    const adapter = adminRecoveryAdapter(admin);
    const result = await adapter.revokeSessions("jwt-token-abc", "user-1", "audit-2");
    expect(result).toEqual({ revoked: true });
    const insertPayload = admin.from.mock.results[0].value.insert.mock.calls[0][0];
    expect(insertPayload).toMatchObject({
      audit_id: "audit-2",
      action: "session.revoke",
      actor: "gateway",
      user_id: "user-1",
    });
    // L2-003: the locked SDK has no by-user-id revocation — signOut takes
    // the user's JWT (scope 'global'), never a bare user id.
    expect(admin.auth.admin.signOut).toHaveBeenCalledWith("jwt-token-abc", "global");
  });

  it("revokeSessions refuses without a user JWT (no silent wrong-mechanism call)", async () => {
    const adapter = adminRecoveryAdapter(mockAdminClient());
    await expect(adapter.revokeSessions("", "user-1", "audit-1")).rejects.toThrow(/JWT/);
    await expect(adapter.revokeSessions(null, "user-1", "audit-1")).rejects.toThrow(/JWT/);
  });

  it("requires an audit id for every operation", async () => {
    const adapter = adminRecoveryAdapter(mockAdminClient());
    await expect(adapter.deleteFactor("user-1", "factor-1", "")).rejects.toThrow(/audit id/);
    await expect(adapter.revokeSessions("jwt", "user-1", null)).rejects.toThrow(/audit id/);
  });

  it("requires user and factor ids", async () => {
    const adapter = adminRecoveryAdapter(mockAdminClient());
    await expect(adapter.deleteFactor("", "factor-1", "audit-1")).rejects.toThrow(/userId/);
    await expect(adapter.deleteFactor("user-1", "", "audit-1")).rejects.toThrow(/factorId/);
    await expect(adapter.revokeSessions("jwt", "", "audit-1")).rejects.toThrow(/userId/);
  });

  it("propagates provider errors (no silent recovery steps)", async () => {
    const admin = mockAdminClient();
    admin.auth.admin._deleteFactor.mockResolvedValue({ data: null, error: new Error("provider down") });
    const adapter = adminRecoveryAdapter(admin);
    await expect(adapter.deleteFactor("user-1", "factor-1", "audit-1")).rejects.toThrow(/provider down/);
  });

  it("fails the operation when the audit write fails (no blind provider calls)", async () => {
    const admin = mockAdminClient();
    admin.from.mockReturnValue({ insert: vi.fn(() => Promise.resolve({ error: new Error("audit table missing") })) });
    const adapter = adminRecoveryAdapter(admin);
    await expect(adapter.revokeSessions("jwt", "user-1", "audit-1")).rejects.toThrow(/audit table missing/);
    expect(admin.auth.admin.signOut).not.toHaveBeenCalled();
  });
});
