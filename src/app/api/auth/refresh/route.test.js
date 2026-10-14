// Tests for POST /api/auth/refresh. Synthetic fixtures only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockCheckAdmission = vi.fn();

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { REFRESH: "refresh" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
}));

const { POST } = await import("./route.js");

const OP_ID = "123e4567-e89b-12d3-a456-426614174000";
const NEW_SESSION = {
  access_token: "atk-synthetic-new",
  refresh_token: "rtk-synthetic-new",
  user: { id: "user-synthetic-1" },
};

function fakeAdmin({ refreshResult } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      refreshSession: async ({ refresh_token }) => {
        calls.push({ method: "refreshSession", tokenPresent: typeof refresh_token === "string" });
        return refreshResult ?? { data: { session: NEW_SESSION, user: { id: "user-synthetic-1" } }, error: null };
      },
    },
  };
}

const allowAdmission = { allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 };

function post(body) {
  return new Request("http://localhost/api/auth/refresh", {
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
  mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 20, backoffSeconds: 0 });
  const res = await POST(post({ refresh_token: "rtk-synthetic", operationId: OP_ID }));
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("20");
  expect(admin.calls).toHaveLength(0);
  // accountId is null by design: the user id is established only by the
  // provider validating the token, never by decoding an unverified token.
  expect(mockCheckAdmission).toHaveBeenCalledWith(
    expect.objectContaining({ action: "refresh", accountId: null })
  );
});

it("returns generic 503 on limiter unavailable with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
  const res = await POST(post({ refresh_token: "rtk-synthetic", operationId: OP_ID }));
  expect(res.status).toBe(503);
  expect(admin.calls).toHaveLength(0);
});

it("returns the refreshed session with the inert label header", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ refresh_token: "rtk-synthetic", operationId: OP_ID }));
  expect(res.status).toBe(200);
  expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.session.access_token).toBe("atk-synthetic-new");
  expect(admin.calls).toHaveLength(1);
});

it("returns the same generic 401 for expired/revoked/malformed refresh tokens", async () => {
  const admin = fakeAdmin({ refreshResult: { data: {}, error: { message: "Invalid Refresh Token" } } });
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ refresh_token: "rtk-bad", operationId: OP_ID }));
  expect(res.status).toBe(401);
  const json = await res.json();
  expect(json.error).toBe("Session refresh failed. Please sign in again.");
  expect(JSON.stringify(json)).not.toContain("Invalid Refresh Token");
});
