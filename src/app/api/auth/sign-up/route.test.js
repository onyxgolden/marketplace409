// Tests for POST /api/auth/sign-up. Synthetic fixtures only.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockCheckAdmission = vi.fn();

// Turnstile activation flag for gatewaySupport.js, which imports
// isTurnstileEnabled from this module. Defaults to false so every
// pre-existing test below exercises the exact pre-Turnstile behavior; the
// "Turnstile enabled" describe block flips it to true.
const { turnstileEnabled } = vi.hoisted(() => ({ turnstileEnabled: { current: false } }));

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { SIGNUP: "signup" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
}));
vi.mock("@/lib/auth/turnstilePolicy.js", () => ({
  MAX_TURNSTILE_TOKEN_LENGTH: 2048,
  MESSAGE_TURNSTILE_REQUIRED: "Please complete the human-verification check and try again.",
  isTurnstileEnabled: () => turnstileEnabled.current,
}));

const { POST } = await import("./route.js");

const OP_ID = "123e4567-e89b-12d3-a456-426614174000";
// Must stay verbatim with SIGNUP_SUBMITTED_MESSAGE in
// src/lib/auth/useCredentialAuth.js.
const SIGNUP_SUBMITTED_MESSAGE =
  "Thanks! If this is a new email, check your inbox to confirm your account. If you already have " +
  "an account with this email, you can sign in above instead, or use \"Forgot password?\" if you " +
  "don't remember your password.";

function fakeAdmin({ signUpResult } = {}) {
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
      signUp: async ({ email, options }) => {
        calls.push({ method: "signUp", email, captchaToken: options?.captchaToken ?? null });
        return signUpResult ?? { data: {}, error: null };
      },
    },
  };
}

const allowAdmission = { allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 };

function post(body) {
  return new Request("http://localhost/api/auth/sign-up", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  turnstileEnabled.current = false;
  mockCheckAdmission.mockResolvedValue(allowAdmission);
});

it("returns 400 on malformed input with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ email: "new@example.com", operationId: OP_ID }));
  expect(res.status).toBe(400);
  expect(admin.calls).toHaveLength(0);
});

it("returns 429 with Retry-After on limiter deny with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 30, backoffSeconds: 0 });
  const res = await POST(post({ email: "new@example.com", password: "pw", operationId: OP_ID }));
  expect(res.status).toBe(429);
  expect(res.headers.get("Retry-After")).toBe("30");
  expect(admin.calls).toHaveLength(0);
});

it("returns generic 503 on limiter unavailable with zero provider calls", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
  const res = await POST(post({ email: "new@example.com", password: "pw", operationId: OP_ID }));
  expect(res.status).toBe(503);
  expect(admin.calls).toHaveLength(0);
});

it("returns the shared submitted message verbatim with the inert label header", async () => {
  const admin = fakeAdmin();
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ email: "new@example.com", password: "pw", operationId: OP_ID }));
  expect(res.status).toBe(200);
  expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
  const json = await res.json();
  expect(json.status).toBe("ok");
  expect(json.message).toBe(SIGNUP_SUBMITTED_MESSAGE);
  expect(admin.calls).toHaveLength(1);
});

it("returns a generic 500 on provider failure without leaking account state", async () => {
  const admin = fakeAdmin({ signUpResult: { data: {}, error: { message: "Database error" } } });
  mockCreateServerAuthClient.mockReturnValue(admin);
  const res = await POST(post({ email: "new@example.com", password: "pw", operationId: OP_ID }));
  expect(res.status).toBe(500);
  const json = await res.json();
  expect(json.error).toBe("Unable to process sign-up. Please try again later.");
  expect(JSON.stringify(json)).not.toContain("Database error");
});

describe("turnstile human verification", () => {
  it("ignores a stray captchaToken while disabled and does not forward it to the provider", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(
      post({ email: "new@example.com", password: "pw", operationId: OP_ID, captchaToken: "0.AQStray" })
    );
    expect(res.status).toBe(200);
    expect(admin.calls).toHaveLength(1);
    expect(admin.calls[0].captchaToken).toBeNull();
  });

  it("returns 400 with zero provider calls and zero admission checks when enabled and the token is missing", async () => {
    turnstileEnabled.current = true;
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ email: "new@example.com", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Please complete the human-verification check and try again.");
    expect(admin.calls).toHaveLength(0);
    expect(mockCheckAdmission).not.toHaveBeenCalled();
  });

  it("returns 400 when enabled and the token is malformed (empty / over-long)", async () => {
    turnstileEnabled.current = true;
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    for (const captchaToken of ["", "   ", "x".repeat(2049)]) {
      const res = await POST(
        post({ email: "new@example.com", password: "pw", operationId: OP_ID, captchaToken })
      );
      expect(res.status).toBe(400);
    }
    expect(admin.calls).toHaveLength(0);
  });

  it("forwards the token to the provider as captchaToken when enabled", async () => {
    turnstileEnabled.current = true;
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(
      post({ email: "new@example.com", password: "pw", operationId: OP_ID, captchaToken: "0.AQRealToken" })
    );
    expect(res.status).toBe(200);
    expect(admin.calls).toHaveLength(1);
    expect(admin.calls[0].captchaToken).toBe("0.AQRealToken");
  });
});
