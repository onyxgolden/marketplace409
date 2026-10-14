// Tests for POST /api/auth/recovery. Synthetic fixtures only.
// No real recovery codes anywhere: consumeRecoveryCode is mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockAdminRecoveryAdapter = vi.fn();
const mockCheckAdmission = vi.fn();
const mockConsumeRecoveryCode = vi.fn();
const mockRevokeSessions = vi.fn();
const mockIsActivationEnabled = vi.fn(() => false);

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
  adminRecoveryAdapter: (...args) => mockAdminRecoveryAdapter(...args),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { RECOVERY: "recovery" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
}));
vi.mock("@/lib/auth/recoveryCodes.js", () => ({
  consumeRecoveryCode: (...args) => mockConsumeRecoveryCode(...args),
}));
vi.mock("../_lib/gatewaySupport.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isActivationEnabled: (...args) => mockIsActivationEnabled(...args) };
});
vi.mock("@/lib/auth/requireSecurityAssurance.js", () => ({
  // L2-006: the fresh-ceremony clock is the AMR first-factor method
  // timestamps, not iat. The mock returns a fresh password ceremony.
  freshFirstFactorAt: vi.fn(() => Math.floor(Date.now() / 1000) - 60),
  verifiedSessionClaims: vi.fn(() =>
    Promise.resolve({
      sub: "user-synthetic-1",
      session_id: "sess-synthetic-1",
      iat: Math.floor(Date.now() / 1000) - 60,
      amr: [{ method: "password", timestamp: Math.floor(Date.now() / 1000) - 60 }],
    })
  ),
}));

const { POST } = await import("./route.js");

const OP_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER = { id: "user-synthetic-1", email: "owner@example.com" };

function fakeAdmin({ getUserResult, latchInsertResult } = {}) {
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
      getUser: async () => {
        calls.push({ method: "getUser" });
        return getUserResult ?? { data: { user: USER }, error: null };
      },
    },
    from: (table) => ({
      insert: async (row) => {
        calls.push({ method: "from.insert", table, userId: row?.user_id, reason: row?.reason });
        return latchInsertResult ?? { data: [{}], error: null };
      },
    }),
  };
}

const allowAdmission = { allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 };

function post(body) {
  return new Request("http://localhost/api/auth/recovery", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsActivationEnabled.mockReturnValue(false);
  mockCheckAdmission.mockResolvedValue(allowAdmission);
  mockAdminRecoveryAdapter.mockReturnValue({ revokeSessions: mockRevokeSessions });
  mockRevokeSessions.mockResolvedValue({ revoked: true });
});

describe("input validation", () => {
  it("returns 400 on malformed input with zero provider calls", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "complete", operationId: OP_ID }));
    expect(res.status).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });
});

describe("disabled activation", () => {
  it("returns 501 with the inert label and consumes nothing", async () => {
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "KQ7M-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(501);
    expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
    expect((await res.json()).status).toBe("recovery_disabled");
    expect(mockConsumeRecoveryCode).not.toHaveBeenCalled();
    expect(mockCheckAdmission).not.toHaveBeenCalled();
  });
});

describe("admission gating", () => {
  it("returns 429 with Retry-After on limiter deny with zero provider calls", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 25, backoffSeconds: 0 });
    const res = await POST(post({ action: "initiate", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("25");
    expect(admin.calls).toHaveLength(0);
    expect(mockCheckAdmission).toHaveBeenCalledWith(expect.objectContaining({ action: "recovery" }));
  });

  it("returns generic 503 on limiter unavailable with zero provider calls", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    const res = await POST(post({ action: "initiate", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(503);
    expect(admin.calls).toHaveLength(0);
    expect(mockConsumeRecoveryCode).not.toHaveBeenCalled();
  });
});

describe("initiate", () => {
  it("acknowledges a valid first-factor session and reveals nothing sensitive", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "initiate", access_token: "atk", operationId: OP_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("recovery_initiated");
    expect(mockConsumeRecoveryCode).not.toHaveBeenCalled();
  });

  it("returns 401 for an invalid session", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin({ getUserResult: { data: {}, error: { message: "bad" } } });
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ action: "initiate", access_token: "atk-bad", operationId: OP_ID }));
    expect(res.status).toBe(401);
  });
});

describe("complete", () => {
  it("consumes the code atomically (latch in the RPC), revokes sessions, returns recovery_pending (NOT aal2)", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockConsumeRecoveryCode.mockResolvedValue({ consumed: true, generationId: "gen-synthetic-1" });
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "KQ7M-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("recovery_pending");
    expect(json.generation_id).toBe("gen-synthetic-1");
    // No AAL2 grant: nothing session-like leaves this response.
    expect(json.session).toBeUndefined();
    expect(JSON.stringify(json)).not.toMatch(/access_token|aal2/);
    // Atomic consume with the operationId idempotency key and an audit id.
    // L2-006: NO separate latch insert — the RPC commits consume+latch
    // atomically, so the route performs zero from("mfa_security_latch") writes.
    expect(mockConsumeRecoveryCode).toHaveBeenCalledWith(
      admin, USER.id, "KQ7M-SYNTHETIC", OP_ID, expect.objectContaining({ auditId: expect.any(String) })
    );
    expect(admin.calls.some((c) => c.table === "mfa_security_latch")).toBe(false);
    // Narrow adapter revocation with the user's JWT (the locked SDK has no
    // by-user-id revocation) and an audit id.
    expect(mockRevokeSessions).toHaveBeenCalledWith("atk", USER.id, expect.any(String));
  });

  it("returns the same generic 401 when the code is not consumed (no oracle)", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockConsumeRecoveryCode.mockResolvedValue({ consumed: false, generationId: null });
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "WRONG-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error).toBe("Recovery failed. Check your details and try again.");
    // No revocation on a failed consume.
    expect(mockRevokeSessions).not.toHaveBeenCalled();
  });

  it("fails closed with 500 when the atomic consume RPC throws (never restores codes)", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockConsumeRecoveryCode.mockRejectedValue(new Error("rpc down"));
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "KQ7M-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(500);
    // Revocation never ran; nothing claims success.
    expect(mockRevokeSessions).not.toHaveBeenCalled();
    const json = await res.json();
    expect(json.status).not.toBe("recovery_pending");
  });

  it("still returns recovery_pending when session revocation fails (latch is the guard)", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockConsumeRecoveryCode.mockResolvedValue({ consumed: true, generationId: "gen-synthetic-1" });
    mockRevokeSessions.mockRejectedValueOnce(new Error("provider down"));
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "KQ7M-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("recovery_pending");
  });

  it("L2-006 probe: rejects a stale first-factor ceremony (day-old password AMR, current iat)", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    // The verdict's probe: current iat + day-old password AMR must NOT
    // consume. The ceremony clock is the AMR timestamp, not iat.
    const { freshFirstFactorAt } = await import("@/lib/auth/requireSecurityAssurance.js");
    vi.mocked(freshFirstFactorAt).mockReturnValueOnce(null); // stale/missing AMR ceremony
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "KQ7M-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(401);
    expect(mockConsumeRecoveryCode).not.toHaveBeenCalled();
    expect(mockRevokeSessions).not.toHaveBeenCalled();
  });

  it("L2-006 probe: refuses a first-factor timestamp in the future", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const { freshFirstFactorAt } = await import("@/lib/auth/requireSecurityAssurance.js");
    // A future timestamp is not evidence of a fresh ceremony — refuse.
    vi.mocked(freshFirstFactorAt).mockReturnValueOnce(Math.floor(Date.now() / 1000) + 3600);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(
      post({ action: "complete", access_token: "atk", recovery_code: "KQ7M-SYNTHETIC", operationId: OP_ID })
    );
    expect(res.status).toBe(401);
    expect(mockConsumeRecoveryCode).not.toHaveBeenCalled();
  });
});
