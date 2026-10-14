// Tests for POST /api/auth/mfa. Synthetic fixtures only.
// No secrets (QR data, manual keys, TOTP codes) are asserted on or logged.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockCheckAdmission = vi.fn();
const mockCreateUserScopedAuthClient = vi.fn();

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { MFA_CHALLENGE: "mfa_challenge", MFA_VERIFY: "mfa_verify" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
  recordAttemptOutcome: vi.fn(() => Promise.resolve(true)),
  accountKey: vi.fn(() => "deadbeef"),
}));
vi.mock("@/lib/auth/requireSecurityAssurance.js", () => ({
  verifiedSessionClaims: vi.fn(() =>
    Promise.resolve({ sub: "user-synthetic-1", session_id: "sess-synthetic-1" })
  ),
  requireSecurityAssurance: vi.fn(async () => ({
    authorized: true, state: "AUTHORIZED", cohort: "unknown", reason: "layer2-disabled",
  })),
}));
vi.mock("../_lib/gatewaySupport.js", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    createUserScopedAuthClient: (...args) => mockCreateUserScopedAuthClient(...args),
  };
});

const { POST } = await import("./route.js");

const OP_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER = { id: "user-synthetic-1", email: "owner@example.com" };

function fakeAdmin({ getUserResult } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      getUser: async () => {
        calls.push({ method: "getUser" });
        return getUserResult ?? { data: { user: USER }, error: null };
      },
    },
  };
}

function fakeUserClient({ enrollResult, challengeResult, verifyResult } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      mfa: {
        enroll: async (params) => {
          calls.push({ method: "enroll", factorType: params?.factorType });
          return enrollResult ?? {
            data: { id: "factor-synthetic-1", totp: { qr_code: "data:image/png;base64,SYNTHETIC", secret: "SYNTHETICSECRET" } },
            error: null,
          };
        },
        challenge: async ({ factorId }) => {
          calls.push({ method: "challenge", factorPresent: typeof factorId === "string" });
          return challengeResult ?? { data: { id: "challenge-synthetic-1" }, error: null };
        },
        verify: async ({ factorId, challengeId }) => {
          calls.push({ method: "verify", factorsPresent: typeof factorId === "string" && typeof challengeId === "string" });
          return verifyResult ?? {
            data: { session: { access_token: "atk-synthetic-aal2", user: { id: USER.id, aal: "aal2" } } },
            error: null,
          };
        },
      },
    },
  };
}

const allowAdmission = { allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 };

function post(body) {
  return new Request("http://localhost/api/auth/mfa", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockCheckAdmission.mockResolvedValue(allowAdmission);
  // createUserScopedAuthClient is synchronous (header injection, no setSession).
  mockCreateUserScopedAuthClient.mockImplementation(() => fakeUserClient());
});

describe("input validation", () => {
  it("returns 400 for a missing action with zero provider calls", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });

  it("returns 400 when verify is missing the code", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", operationId: OP_ID })
    );
    expect(res.status).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });
});

describe("admission gating", () => {
  it("returns 429 with Retry-After on limiter deny with zero provider calls", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 15, backoffSeconds: 0 });
    const res = await POST(post({ action: "enroll", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("15");
    expect(admin.calls).toHaveLength(0);
    expect(mockCheckAdmission).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa_challenge" }));
  });

  it("uses the mfa_verify bucket for verify actions", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 15, backoffSeconds: 0 });
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "123456", operationId: OP_ID })
    );
    expect(res.status).toBe(429);
    expect(admin.calls).toHaveLength(0);
    expect(mockCheckAdmission).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa_verify" }));
  });

  it("returns generic 503 on limiter unavailable with zero provider calls", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    const res = await POST(post({ action: "challenge", access_token: "atk", factor_id: "f", operationId: OP_ID }));
    expect(res.status).toBe(503);
    expect(admin.calls).toHaveLength(0);
  });
});

describe("session authority", () => {
  it("returns 401 when the access token is invalid", async () => {
    const admin = fakeAdmin({ getUserResult: { data: {}, error: { message: "bad" } } });
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "enroll", access_token: "atk-bad", operationId: OP_ID }));
    expect(res.status).toBe(401);
    expect(mockCreateUserScopedAuthClient).not.toHaveBeenCalled();
  });
});

describe("provider proxy with inert label", () => {
  it("list_factors returns the user's own verified factors (no secrets)", async () => {
    const admin = fakeAdmin();
    admin.auth.admin = {
      _listFactors: vi.fn(() =>
        Promise.resolve({
          data: {
            factors: [
              { id: "f-1", friendly_name: "App", factor_type: "totp", status: "verified", created_at: "2026-01-01" },
              { id: "f-2", friendly_name: "Old", factor_type: "totp", status: "unverified", created_at: "2026-01-02" },
            ],
          },
          error: null,
        })
      ),
    };
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "list_factors", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.factors).toHaveLength(1);
    expect(json.factors[0]).toMatchObject({ id: "f-1", friendly_name: "App", factor_type: "totp" });
    expect(admin.auth.admin._listFactors).toHaveBeenCalledWith({ userId: USER.id });
    // No secrets leak: the factor payload carries no secret/uri.
    expect(JSON.stringify(json)).not.toMatch(/secret|qr_code|uri/i);
  });

  it("status returns the server-side guard verdict for the session", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "status", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    // Layer 2 disabled: the guard passes through as authorized/inert.
    expect(json.authorized).toBe(true);
    expect(json.cohort).toBe("unknown");
  });
  it("enroll returns factor material with the inert header and never logs secrets", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "enroll", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.factor_id).toBe("factor-synthetic-1");
    expect(typeof json.qr_code).toBe("string");
    expect(typeof json.manual_key).toBe("string");
  });

  it("challenge returns a challenge id with the inert header", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "challenge", access_token: "atk", factor_id: "f", operationId: OP_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
    expect((await res.json()).challenge_id).toBe("challenge-synthetic-1");
  });

  it("verify returns the provider session with the inert header", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "123456", operationId: OP_ID })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.session.user.aal).toBe("aal2");
  });

  it("verify failure returns the same generic 401 (no enumeration of code vs challenge state)", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCreateUserScopedAuthClient.mockImplementation(() =>
      fakeUserClient({ verifyResult: { data: null, error: { message: "Token has expired or is invalid" } } })
    );
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "000000", operationId: OP_ID })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Verification failed. Please try again.");
    expect(JSON.stringify(json)).not.toContain("expired");
  });
});
