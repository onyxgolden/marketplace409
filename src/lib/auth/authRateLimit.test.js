import { describe, expect, it, vi } from "vitest";

import {
  AUTH_ACTIONS,
  BACKOFF_LADDER_SECONDS,
  DEFAULT_LIMITS,
  accountKey,
  checkAdmission,
  normalizeAccountIdentifier,
} from "./authRateLimit.js";

const ENV = { AUTH_LIMITER_HMAC_KEY: "test-hmac-key" };

function mockAdmin(rpcImpl) {
  return { rpc: vi.fn(rpcImpl) };
}

describe("normalizeAccountIdentifier", () => {
  it("trims and lowercases", () => {
    expect(normalizeAccountIdentifier("  Jason@Example.COM ")).toBe("jason@example.com");
  });

  it("does NOT collapse Gmail dots or plus tags", () => {
    expect(normalizeAccountIdentifier("j.a.s.o.n+tag@gmail.com")).toBe("j.a.s.o.n+tag@gmail.com");
    expect(normalizeAccountIdentifier("j.a.s.o.n@gmail.com")).not.toBe(normalizeAccountIdentifier("jason@gmail.com"));
  });

  it("rejects empty or non-string input", () => {
    expect(() => normalizeAccountIdentifier("")).toThrow();
    expect(() => normalizeAccountIdentifier("   ")).toThrow();
    expect(() => normalizeAccountIdentifier(null)).toThrow();
  });
});

describe("accountKey", () => {
  it("is deterministic and keyed", () => {
    const a = accountKey("user@example.com", ENV.AUTH_LIMITER_HMAC_KEY);
    const b = accountKey("  USER@example.com ", ENV.AUTH_LIMITER_HMAC_KEY);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(accountKey("other@example.com", ENV.AUTH_LIMITER_HMAC_KEY)).not.toBe(a);
    expect(accountKey("user@example.com", "different-key")).not.toBe(a);
  });
});

describe("checkAdmission", () => {
  it("returns allowed when the RPC allows", async () => {
    const admin = mockAdmin(() =>
      Promise.resolve({
        data: [{ allowed: true, retry_after_seconds: 0, backoff_seconds: 0, limit_name: null }],
        error: null,
      })
    );
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.PASSWORD_SIGNIN,
      accountId: "user@example.com",
      ip: "203.0.113.7",
      operationId: "op-1",
      env: ENV,
    });
    expect(result).toMatchObject({ allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    expect(result.unavailable).toBeUndefined();
    // The account key sent to the RPC is the HMAC, never the raw identifier.
    const args = admin.rpc.mock.calls[0][1];
    expect(args.p_action).toBe("password_signin");
    const expectedKey = accountKey("user@example.com", ENV.AUTH_LIMITER_HMAC_KEY);
    expect(args.p_keys).toEqual([
      `password_signin:account_ip:${expectedKey}:203.0.113.7`,
      `password_signin:account:${expectedKey}`,
      `password_signin:ip:203.0.113.7`,
    ]);
    expect(args.p_limits).toEqual([
      { capacity: 5, window_seconds: 300 },
      { capacity: 30, window_seconds: 900 },
      { capacity: 100, window_seconds: 300 },
    ]);
    expect(args.p_operation_id).toBe("op-1");
  });

  it("returns deny with retry-after when the RPC denies", async () => {
    const admin = mockAdmin(() =>
      Promise.resolve({
        data: [{ allowed: false, retry_after_seconds: 120, backoff_seconds: 8, limit_name: "account_ip" }],
        error: null,
      })
    );
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.MFA_VERIFY,
      accountId: "user@example.com",
      ip: "203.0.113.7",
      operationId: "op-2",
      env: ENV,
    });
    expect(result).toMatchObject({
      allowed: false,
      retryAfterSeconds: 120,
      backoffSeconds: 8,
      limitName: "account_ip",
    });
  });

  it("fails closed when the store is unavailable (no allow-on-error)", async () => {
    const admin = mockAdmin(() => Promise.resolve({ data: null, error: new Error("connection refused") }));
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.REFRESH,
      accountId: "user@example.com",
      ip: "203.0.113.7",
      operationId: "op-3",
      env: ENV,
    });
    expect(result).toMatchObject({ allowed: false, unavailable: true });
  });

  it("fails closed when the RPC throws (network failure)", async () => {
    const admin = mockAdmin(() => Promise.reject(new Error("socket hangup")));
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.SIGNUP,
      ip: "203.0.113.7",
      operationId: "op-4",
      env: ENV,
    });
    expect(result).toMatchObject({ allowed: false, unavailable: true });
  });

  it("fails closed when the RPC returns an unexpected shape", async () => {
    const admin = mockAdmin(() => Promise.resolve({ data: [{ nope: true }], error: null }));
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.RECOVERY,
      operationId: "op-5",
      env: ENV,
    });
    expect(result).toMatchObject({ allowed: false, unavailable: true });
  });

  it("fails closed when the HMAC key is missing", async () => {
    const admin = mockAdmin(() => Promise.resolve({ data: [{ allowed: true }], error: null }));
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.PASSWORD_SIGNIN,
      accountId: "user@example.com",
      operationId: "op-6",
      env: {},
    });
    expect(result).toMatchObject({ allowed: false, unavailable: true });
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("fails closed on an in-band unavailable flag from the RPC row", async () => {
    const admin = mockAdmin(() =>
      Promise.resolve({
        data: [{ allowed: true, retry_after_seconds: 0, backoff_seconds: 0, unavailable: true }],
        error: null,
      })
    );
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.PASSWORD_SIGNIN,
      accountId: "user@example.com",
      ip: "203.0.113.7",
      operationId: "op-9",
      env: ENV,
    });
    expect(result).toMatchObject({ allowed: false, unavailable: true });
  });

  it("rejects unknown actions loudly", async () => {
    const admin = mockAdmin();
    await expect(
      checkAdmission({ supabaseAdmin: admin, action: "nuke", operationId: "op-7", env: ENV })
    ).rejects.toThrow(/unknown action/);
  });

  it("requires an operationId idempotency key", async () => {
    const admin = mockAdmin();
    await expect(
      checkAdmission({ supabaseAdmin: admin, action: AUTH_ACTIONS.REFRESH, env: ENV })
    ).rejects.toThrow(/operationId/);
  });

  it("accepts a null account key (IP-only namespace) without hashing", async () => {
    const admin = mockAdmin(() =>
      Promise.resolve({ data: { allowed: true, retry_after_seconds: 0, backoff_seconds: 0 }, error: null })
    );
    const result = await checkAdmission({
      supabaseAdmin: admin,
      action: AUTH_ACTIONS.SIGNUP,
      accountId: null,
      ip: "203.0.113.7",
      operationId: "op-8",
      env: ENV,
    });
    expect(result.allowed).toBe(true);
    // With no accountId, only IP-keyed buckets are sent (no account HMAC).
    expect(admin.rpc.mock.calls[0][1].p_keys).toEqual(["signup:ip:203.0.113.7"]);
  });
});

describe("DEFAULT_LIMITS", () => {
  it("covers every action namespace with the brief's staging defaults", () => {
    for (const action of Object.values(AUTH_ACTIONS)) {
      expect(DEFAULT_LIMITS[action], action).toBeDefined();
    }
    expect(DEFAULT_LIMITS.password_signin.account_ip).toContain("5 failed attempts / 5 minutes");
    expect(DEFAULT_LIMITS.refresh.ip).toContain("1000 / 5 minutes");
    expect(DEFAULT_LIMITS.recovery.account).toContain("5 failures / 5 minutes");
    expect(BACKOFF_LADDER_SECONDS).toEqual([2, 4, 8, 16, 32, 60]);
  });

  it("is frozen", () => {
    expect(Object.isFrozen(DEFAULT_LIMITS)).toBe(true);
  });
});
