// Tests for gateAdmission (L2-008): positive backoffSeconds on an allowed
// verdict is ENFORCED (429 + Retry-After), never ignored.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCheckAdmission = vi.fn();

vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { PASSWORD_SIGNIN: "password_signin" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
}));

const { gateAdmission } = await import("./gatewaySupport.js");

const ENV = { AUTH_LIMITER_HMAC_KEY: "test" };

beforeEach(() => {
  vi.clearAllMocks();
});

describe("gateAdmission backoff enforcement (L2-008)", () => {
  it("returns allowed:true when the verdict is clean", async () => {
    mockCheckAdmission.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    const gate = await gateAdmission({
      supabaseAdmin: {},
      action: "password_signin",
      accountId: "a@b.c",
      ip: "203.0.113.7",
      operationId: "op-1",
      env: ENV,
    });
    expect(gate.allowed).toBe(true);
    expect(gate.response).toBeUndefined();
  });

  it("enforces a positive backoff on an allowed verdict: 429 with Retry-After=backoff", async () => {
    mockCheckAdmission.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, backoffSeconds: 8 });
    const gate = await gateAdmission({
      supabaseAdmin: {},
      action: "password_signin",
      accountId: "a@b.c",
      ip: "203.0.113.7",
      operationId: "op-2",
      env: ENV,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.response.status).toBe(429);
    expect(gate.response.headers.get("Retry-After")).toBe("8");
    const json = await gate.response.json();
    expect(json.retryAfterSeconds).toBe(8);
  });

  it("still 429s on deny with the bucket retry-after", async () => {
    mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 30, backoffSeconds: 0 });
    const gate = await gateAdmission({
      supabaseAdmin: {},
      action: "password_signin",
      accountId: "a@b.c",
      ip: "203.0.113.7",
      operationId: "op-3",
      env: ENV,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.response.status).toBe(429);
    expect(gate.response.headers.get("Retry-After")).toBe("30");
  });

  it("returns generic 503 on unavailable with zero provider calls implied", async () => {
    mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    const gate = await gateAdmission({
      supabaseAdmin: {},
      action: "password_signin",
      accountId: "a@b.c",
      ip: "203.0.113.7",
      operationId: "op-4",
      env: ENV,
    });
    expect(gate.allowed).toBe(false);
    expect(gate.response.status).toBe(503);
  });

  it("passes sessionId through to checkAdmission for verified-attribution checks", async () => {
    mockCheckAdmission.mockResolvedValue({ allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    await gateAdmission({
      supabaseAdmin: {},
      action: "password_signin",
      accountId: "user-id",
      sessionId: "sess-123",
      ip: "203.0.113.7",
      operationId: "op-5",
      env: ENV,
    });
    expect(mockCheckAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-123", operationId: "op-5" })
    );
  });
});
