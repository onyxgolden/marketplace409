// Tests for POST /api/auth/sign-in.
// Synthetic fixtures only. Secrets are never asserted on or logged.
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockCheckAdmission = vi.fn();
const mockRequireSecurityAssurance = vi.fn();
const mockIsActivationEnabled = vi.fn(() => false);

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: { PASSWORD_SIGNIN: "password_signin" },
  checkAdmission: (...args) => mockCheckAdmission(...args),
  recordAttemptOutcome: vi.fn(() => Promise.resolve(true)),
  accountKey: vi.fn(() => "deadbeef"),
}));
vi.mock("@/lib/auth/requireSecurityAssurance.js", () => ({
  requireSecurityAssurance: (...args) => mockRequireSecurityAssurance(...args),
}));
vi.mock("../_lib/gatewaySupport.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, isActivationEnabled: (...args) => mockIsActivationEnabled(...args) };
});

const { POST } = await import("./route.js");

const OP_ID = "123e4567-e89b-12d3-a456-426614174000";
const SESSION = {
  access_token: "atk-synthetic",
  refresh_token: "rtk-synthetic",
  user: { id: "user-synthetic-1", aal: "aal1", amr: [{ method: "password" }] },
};
const USER = { id: "user-synthetic-1", email: "owner@example.com" };

function fakeAdmin({ signInResult } = {}) {
  const calls = [];
  return {
    calls,
    auth: {
      signInWithPassword: async ({ email }) => {
        calls.push({ method: "signInWithPassword", email });
        return signInResult ?? { data: { session: SESSION, user: USER }, error: null };
      },
    },
  };
}

const allowAdmission = { allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 };

function post(body, headers = {}) {
  return new Request("http://localhost/api/auth/sign-in", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockIsActivationEnabled.mockReturnValue(false);
  mockCheckAdmission.mockResolvedValue(allowAdmission);
});

describe("input validation", () => {
  it("returns 400 for a malformed body (missing fields)", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ email: "a@b.c", operationId: OP_ID }));
    expect(res.status).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });

  it("returns 400 for a missing or malformed operationId", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: "not-a-uuid" }));
    expect(res.status).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });

  it("returns 400 for unparseable JSON", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const req = new Request("http://localhost/api/auth/sign-in", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect(admin.calls).toHaveLength(0);
  });
});

describe("admission gating", () => {
  it("returns 429 with Retry-After on limiter deny and makes zero provider calls", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 12, backoffSeconds: 4 });
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("12");
    expect(admin.calls).toHaveLength(0);
    expect(mockCheckAdmission).toHaveBeenCalledWith(
      expect.objectContaining({ action: "password_signin", accountId: "a@b.c", operationId: OP_ID })
    );
  });

  it("returns generic 503 on limiter unavailable with zero provider calls", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, unavailable: true, retryAfterSeconds: 0, backoffSeconds: 0 });
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(503);
    const json = await res.json();
    expect(json.error).toBe("Authentication is temporarily unavailable. Please try again later.");
    expect(admin.calls).toHaveLength(0);
  });
});

describe("credential verification", () => {
  it("returns the same generic 401 for bad password and unknown user (no enumeration)", async () => {
    const badPassword = fakeAdmin({ signInResult: { data: {}, error: { message: "Invalid login credentials" } } });
    mockCreateServerAuthClient.mockReturnValue(badPassword);
    const res = await POST(post({ email: "a@b.c", password: "wrong", operationId: OP_ID }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Sign-in failed. Check your email and password and try again." });
  });
});

describe("disabled activation passthrough", () => {
  it("returns the provider session with the inert label header and does not run the MFA gate", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-forge-layer2")).toBe("inert-disabled");
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.session.access_token).toBe("atk-synthetic");
    expect(mockRequireSecurityAssurance).not.toHaveBeenCalled();
  });
});

describe("activated MFA gating", () => {
  it("returns mfa_required/enroll WITH the ceremony session for a required cohort with no enrolled factor", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockRequireSecurityAssurance.mockResolvedValue({
      authorized: false, state: "ENROLL_REQUIRED", cohort: "required", reason: "no-enrolled-factor",
    });
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(403);
    // L2-002: the AAL1 session rides along as the ceremony token for
    // /api/auth/mfa enroll/challenge — it grants no privileged access.
    const json = await res.json();
    expect(json.status).toBe("mfa_required");
    expect(json.next).toBe("enroll");
    expect(json.session.access_token).toBe("atk-synthetic");
    expect(mockRequireSecurityAssurance).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: "user-synthetic-1" } })
    );
  });

  it("returns mfa_required/challenge WITH the ceremony session for a required cohort with an unenrolled session", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockRequireSecurityAssurance.mockResolvedValue({
      authorized: false, state: "CHALLENGE_REQUIRED", cohort: "required", reason: "challenge-required",
    });
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.status).toBe("mfa_required");
    expect(json.next).toBe("challenge");
    expect(json.session.access_token).toBe("atk-synthetic");
  });

  it("grants the session for an authorized assurance result", async () => {
    mockIsActivationEnabled.mockReturnValue(true);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockRequireSecurityAssurance.mockResolvedValue({
      authorized: true, state: "AUTHORIZED", cohort: "required", reason: "aal2",
    });
    const res = await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.cohort).toBe("required");
  });

  it("L2-008 probe: records credential_failed on bad password and credential_succeeded on success", async () => {
    mockIsActivationEnabled.mockReturnValue(false);
    const { recordAttemptOutcome } = await import("@/lib/auth/authRateLimit.js");
    const badPassword = fakeAdmin({ signInResult: { data: {}, error: { message: "Invalid login credentials" } } });
    mockCreateServerAuthClient.mockReturnValue(badPassword);
    await POST(post({ email: "a@b.c", password: "wrong", operationId: OP_ID }));
    expect(recordAttemptOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OP_ID, outcome: "credential_failed" })
    );

    vi.clearAllMocks();
    mockCheckAdmission.mockResolvedValue(allowAdmission);
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    await POST(post({ email: "a@b.c", password: "pw", operationId: OP_ID }));
    expect(recordAttemptOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: OP_ID, outcome: "credential_succeeded" })
    );
  });
});
