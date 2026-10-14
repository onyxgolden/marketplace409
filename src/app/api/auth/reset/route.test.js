// Tests for POST /api/auth/reset. Synthetic fixtures only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockCheckAdmission = vi.fn();

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { RESET_REQUEST: "reset_request" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
}));

const { POST } = await import("./route.js");

const OP_ID = "123e4567-e89b-12d3-a456-426614174000";

function fakeAdmin({ resetResult } = {}) {
  const calls = [];
  return {
    rpc: async (fn, params) => {
      // L2-007: the execution lease. Tests grant by default; specific
      // deny-path tests override via mockImplementationOnce.
      if (fn === "auth_claim_execution") {
        return { data: [{ granted: true, disposition: "granted", outcome: "executing" }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
    calls,
    auth: {
      resetPasswordForEmail: async (email, options) => {
        calls.push({ method: "resetPasswordForEmail", email, redirectTo: options?.redirectTo });
        return resetResult ?? { data: {}, error: null };
      },
    },
    // The reset route must NEVER touch mfa_* tables: any table access fails.
    from: (table) => {
      throw new Error(`unexpected table access: ${table}`);
    },
  };
}

const allowAdmission = { allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 };

function post(body) {
  return new Request("http://localhost/api/auth/reset", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAdmission.mockResolvedValue(allowAdmission);
});

it("returns 400 on malformed input with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ operationId: OP_ID }));
  expect(res.status).toBe(400);
  expect(admin.calls).toHaveLength(0);
});

it("returns 429 with Retry-After on limiter deny with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 45, backoffSeconds: 0 });
  const res = await POST(post({ email: "user@example.com", operationId: OP_ID }));
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("45");
  expect(admin.calls).toHaveLength(0);
  expect(mockCheckAdmission).toHaveBeenCalledWith(
    expect.objectContaining({ action: "reset_request", accountId: "user@example.com" })
  );
});

it("returns generic 503 on limiter unavailable with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
  const res = await POST(post({ email: "user@example.com", operationId: OP_ID }));
  expect(res.status).toBe(503);
  expect(admin.calls).toHaveLength(0);
});

it("returns a generic submitted message with the inert label header and touches no MFA state", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ email: "user@example.com", operationId: OP_ID }));
  expect(res.status).toBe(200);
  expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.message).toBe("Check your email for a secure password-reset link.");
  // Exactly one provider call (the reset email); the from() guard would have
  // thrown had the route touched any table (mfa_* included).
  expect(admin.calls).toHaveLength(1);
  expect(admin.calls[0].method).toBe("resetPasswordForEmail");
});
