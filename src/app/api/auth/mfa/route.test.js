// Tests for POST /api/auth/mfa. Synthetic fixtures only.
// No secrets (QR data, manual keys, TOTP codes) are asserted on or logged.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateServerAuthClient = vi.fn();
const mockCheckAdmission = vi.fn();
const mockCreateUserScopedAuthClient = vi.fn();

vi.mock("@/lib/auth/serverAuthTransport.js", () => ({
  createServerAuthClient: (...args) => mockCreateServerAuthClient(...args),
  // Test-local adapter: deleteFactor delegates to the fake admin's
  // _deleteFactor so tests control provider failures.
  adminRecoveryAdapter: (supabaseAdmin) => ({
    deleteFactor: async (userId, factorId, auditId) => {
      const { error } = await supabaseAdmin.auth.admin._deleteFactor({ userId, id: factorId });
      if (error) throw error;
      return { deleted: true };
    },
    revokeSessions: async () => ({ revoked: true }),
  }),
}));
vi.mock("@/lib/auth/authRateLimit.js", () => ({
  AUTH_ACTIONS: {
    MFA_CHALLENGE: "mfa_challenge",
    MFA_VERIFY: "mfa_verify",
    MFA_CHALLENGE_PRE: "mfa_challenge_pre",
    MFA_VERIFY_PRE: "mfa_verify_pre",
  },
  checkAdmission: (...args) => mockCheckAdmission(...args),
  recordAttemptOutcome: vi.fn(() => Promise.resolve(true)),
  accountKey: vi.fn(() => "deadbeef"),
}));
vi.mock("@/lib/auth/requireSecurityAssurance.js", () => ({
  verifiedSessionClaims: vi.fn(() =>
    Promise.resolve({ sub: "user-synthetic-1", session_id: "sess-synthetic-1" })
  ),
  // Real AAL2 semantics for the L2-004 authority gate (mirrors the module).
  verifiedAal2: vi.fn((claims) => {
    if (!claims) return false;
    if (claims.aal === "aal2") return true;
    const amr = claims.amr;
    if (!Array.isArray(amr)) return false;
    return amr.some((m) =>
      ["totp", "phone", "webauthn"].includes(String(m?.method ?? m).toLowerCase())
    );
  }),
  // Real first-factor clock for the L2-006 completion gate (mirrors the module).
  freshFirstFactorAt: vi.fn((claims) => {
    const amr = claims?.amr;
    if (!Array.isArray(amr) || amr.length === 0) return null;
    const firstFactors = ["password", "oauth", "magiclink", "otp", "email", "sso", "saml"];
    let latest = null;
    for (const entry of amr) {
      const method = String(entry?.method ?? entry ?? "").toLowerCase();
      if (!firstFactors.includes(method)) continue;
      const ts = Number(entry?.timestamp);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      if (latest === null || ts > latest) latest = ts;
    }
    return latest;
  }),
  // Real second-factor ceremony clock for the L2-004 issuance gate
  // (round 3; mirrors the module). iat is never the ceremony.
  freshSecondFactorAt: vi.fn((claims) => {
    const amr = claims?.amr;
    if (!Array.isArray(amr) || amr.length === 0) return null;
    const secondFactors = ["totp", "phone", "webauthn"];
    let latest = null;
    for (const entry of amr) {
      const method = String(entry?.method ?? entry ?? "").toLowerCase();
      if (!secondFactors.includes(method)) continue;
      const ts = Number(entry?.timestamp);
      if (!Number.isFinite(ts) || ts <= 0) return null;
      if (latest === null || ts > latest) latest = ts;
    }
    return latest;
  }),
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
    rpc: vi.fn(async (fn, params) => {
      if (fn === "auth_claim_execution") {
        return { data: [{ granted: true, disposition: "granted", outcome: "executing" }], error: null };
      }
      if (fn === "mfa_replace_recovery_generation") {
        return { data: params.p_generation_id, error: null };
      }
      if (fn === "mfa_recovery_begin_completion") {
        return {
          data: [{
            operation_created_at: new Date(Date.now() - 60000).toISOString(),
            status: "latched",
            terminal: false,
            refused: false,
            refused_reason: null,
            chosen_factor_id: params.p_chosen_factor_id ?? null,
            completion_owner: params.p_completion_owner ?? "owner-synthetic-1",
            completion_generation: 1,
          }],
          error: null,
        };
      }
      if (fn === "mfa_recovery_mark_factors_removed") {
        return { data: true, error: null };
      }
      if (fn === "mfa_recovery_finalize") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    }),
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
            // L2-003: the REAL locked-SDK shape — tokens at data's TOP LEVEL,
            // no data.session. Tests must use this shape, never invented nesting.
            data: {
              access_token: "atk-synthetic-aal2",
              refresh_token: "rt-synthetic-aal2",
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              token_type: "bearer",
              user: { id: USER.id, aal: "aal2" },
            },
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
    expect(mockCheckAdmission).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa_challenge_pre" }));
  });

  it("L2-008: phase 1 uses the pre-verification abuse namespace (mfa_verify_pre), phase 2 the full budget", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCheckAdmission.mockResolvedValue({ allowed: false, retryAfterSeconds: 15, backoffSeconds: 0 });
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "123456", operationId: OP_ID })
    );
    expect(res.status).toBe(429);
    expect(admin.calls).toHaveLength(0);
    // Phase 1 (pre-verification): small separate abuse-reservation namespace.
    expect(mockCheckAdmission).toHaveBeenCalledWith(expect.objectContaining({ action: "mfa_verify_pre" }));
  });

  it("L2-008: phase 2 debits the full mfa_verify budget (not the pre namespace)", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    // Phase 1 allows; phase 2 denies.
    mockCheckAdmission
      .mockResolvedValueOnce({ allowed: true, retryAfterSeconds: 0, backoffSeconds: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterSeconds: 15, backoffSeconds: 0 });
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "123456", operationId: OP_ID })
    );
    expect(res.status).toBe(429);
    const phase2Call = mockCheckAdmission.mock.calls[1][0];
    expect(phase2Call.action).toBe("mfa_verify");
    expect(phase2Call.operationId).toBe(`${OP_ID}:verified`);
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

  it("L2-003 probe: the REAL SDK top-level shape populates the session (no invented data.session nesting)", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCreateUserScopedAuthClient.mockImplementation(() =>
      fakeUserClient({
        verifyResult: {
          // Exactly what the locked SDK returns: flat tokens, no session key.
          data: {
            access_token: "real-shape-atk",
            refresh_token: "real-shape-rt",
            expires_in: 3600,
            user: { id: USER.id },
          },
          error: null,
        },
      })
    );
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "123456", operationId: OP_ID })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.session).not.toBeNull();
    expect(json.session.access_token).toBe("real-shape-atk");
    expect(json.session.refresh_token).toBe("real-shape-rt");
  });

  it("L2-003 probe: a verify response WITHOUT a top-level access_token is a failed verify (401), even with no SDK error", async () => {
    const admin = fakeAdmin();
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCreateUserScopedAuthClient.mockImplementation(() =>
      fakeUserClient({
        verifyResult: {
          // The OLD code read data.session here and returned session:null
          // with status:ok. The adapter must refuse instead.
          data: { session: { access_token: "nested-atk" } },
          error: null,
        },
      })
    );
    const res = await POST(
      post({ action: "verify", access_token: "atk", factor_id: "f", challenge_id: "c", code: "123456", operationId: OP_ID })
    );
    expect(res.status).toBe(401);
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

describe("L2-004 issue_recovery_codes authority", () => {
  const FACTOR_ID = "factor-new-1";
  const OLD_ENV = process.env.RECOVERY_DIGEST_KEY;
  beforeEach(() => {
    process.env.RECOVERY_DIGEST_KEY = "test-recovery-digest-key";
  });
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.RECOVERY_DIGEST_KEY;
    else process.env.RECOVERY_DIGEST_KEY = OLD_ENV;
  });
  function adminWithFactor(createdAt) {
    const admin = fakeAdmin();
    admin.auth.admin = {
      _listFactors: vi.fn(() =>
        Promise.resolve({
          data: {
            factors: [
              { id: FACTOR_ID, factor_type: "totp", status: "verified", created_at: createdAt },
            ],
          },
          error: null,
        })
      ),
    };
    return admin;
  }
  async function issueCodes(admin, claimsOverride) {
    const { verifiedSessionClaims } = await import("@/lib/auth/requireSecurityAssurance.js");
    // Both phase-2 admission AND the issue authority gate call
    // verifiedSessionClaims: the override must apply to every call.
    vi.mocked(verifiedSessionClaims).mockResolvedValue({
      sub: "user-synthetic-1",
      session_id: "sess-synthetic-1",
      ...claimsOverride,
    });
    mockCreateServerAuthClient.mockReturnValue(admin);
    return POST(post({ action: "issue_recovery_codes", access_token: "atk", factor_id: FACTOR_ID, operationId: OP_ID }));
  }
  const freshIso = () => new Date(Date.now() - 60 * 1000).toISOString();
  const freshIat = () => Math.floor(Date.now() / 1000) - 60;

  it("L2-004 probe: AAL1 session for an existing verified factor does NOT issue codes (403)", async () => {
    const admin = adminWithFactor(freshIso());
    const res = await issueCodes(admin, { aal: "aal1", iat: freshIat(), amr: [{ method: "password" }] });
    expect(res.status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("L2-004 probe (round 3): day-old second-factor AMR + current iat + recently created factor does NOT issue codes (403)", async () => {
    // The verdict's residual probe: iat records token issuance (a refresh
    // a minute ago), not the MFA ceremony. A factor enrolled 60s ago —
    // even through another legitimate session — does not refresh THIS
    // session's authentication authority.
    const dayAgo = Math.floor(Date.now() / 1000) - 86400;
    const admin = adminWithFactor(freshIso());
    const res = await issueCodes(admin, {
      aal: "aal2",
      iat: freshIat(),
      amr: [
        { method: "password", timestamp: dayAgo },
        { method: "totp", timestamp: dayAgo },
      ],
    });
    expect(res.status).toBe(403);
    // Refused BEFORE any replacement write.
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("L2-004 probe (round 3): a future second-factor AMR timestamp does NOT issue codes (403)", async () => {
    const admin = adminWithFactor(freshIso());
    const res = await issueCodes(admin, {
      aal: "aal2",
      iat: freshIat(),
      amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) + 3600 }],
    });
    expect(res.status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("L2-004 probe (round 3): a second-factor method WITHOUT a timestamp does NOT issue codes (403)", async () => {
    const admin = adminWithFactor(freshIso());
    const res = await issueCodes(admin, {
      aal: "aal2",
      iat: freshIat(),
      amr: [{ method: "totp" }],
    });
    expect(res.status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("L2-004 probe: old factor (not a recent enrollment) does NOT issue codes (403)", async () => {
    const admin = adminWithFactor(new Date(Date.now() - 3600 * 1000).toISOString());
    const res = await issueCodes(admin, { aal: "aal2", iat: freshIat() });
    expect(res.status).toBe(403);
    expect(admin.rpc).not.toHaveBeenCalled();
  });

  it("L2-004 probe (round 3): genuine fresh MFA (fresh second-factor AMR ceremony) issues codes via the atomic RPC", async () => {
    const admin = adminWithFactor(freshIso());
    const nowS = Math.floor(Date.now() / 1000);
    const res = await issueCodes(admin, {
      aal: "aal2",
      iat: freshIat(),
      amr: [
        { method: "password", timestamp: nowS - 120 },
        { method: "totp", timestamp: nowS - 60 },
      ],
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.recovery_codes).toHaveLength(10);
    // The generation replacement went through the single atomic RPC.
    const replaceCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_replace_recovery_generation");
    expect(replaceCalls).toHaveLength(1);
    expect(replaceCalls[0][1].p_user_id).toBe("user-synthetic-1");
  });
});

describe("L2-006 recovery completion boundaries (verify with latch)", () => {
  const NEW_FACTOR_ID = "factor-new-2";
  const OLD_FACTOR_ID = "factor-old-1";
  const OP_STARTED_AT = new Date(Date.now() - 3600 * 1000).toISOString(); // 1h ago
  const OLD_ENV = process.env.RECOVERY_DIGEST_KEY;
  beforeEach(() => {
    process.env.RECOVERY_DIGEST_KEY = "test-recovery-digest-key";
  });
  afterEach(() => {
    if (OLD_ENV === undefined) delete process.env.RECOVERY_DIGEST_KEY;
    else process.env.RECOVERY_DIGEST_KEY = OLD_ENV;
  });

  function adminWithLatch({ operationStatus = "latched", newFactorCreatedAt, deleteError = null } = {}) {
    const admin = fakeAdmin();
    const fromCalls = [];
    admin.from = vi.fn((table) => {
      fromCalls.push(table);
      if (table === "mfa_security_latch") {
        return { select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn(() => Promise.resolve({ data: { user_id: USER.id }, error: null })) })) })) };
      }
      if (table === "mfa_recovery_operations") {
        return {
          select: vi.fn(() => ({
            eq: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(() =>
                    Promise.resolve({
                      data: {
                        id: "op-recovery-1",
                        status: operationStatus,
                        created_at: OP_STARTED_AT,
                      },
                      error: null,
                    })
                  ),
                })),
              })),
            })),
          })),
        };
      }
      if (table === "mfa_audit_log") {
        return { insert: vi.fn(() => Promise.resolve({ error: null })) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    admin.auth.admin = {
      _listFactors: vi.fn(() =>
        Promise.resolve({
          data: {
            factors: [
              { id: NEW_FACTOR_ID, factor_type: "totp", status: "verified", created_at: newFactorCreatedAt },
              { id: OLD_FACTOR_ID, factor_type: "totp", status: "verified", created_at: new Date(Date.now() - 86400 * 1000).toISOString() },
            ],
          },
          error: null,
        })
      ),
    };
    // The phased completion RPCs.
    admin.rpc = vi.fn(async (fn, params) => {
      if (fn === "auth_claim_execution") {
        return { data: [{ granted: true, disposition: "granted", outcome: "executing" }], error: null };
      }
      if (fn === "mfa_recovery_begin_completion") {
        return {
          data: [{
            operation_created_at: OP_STARTED_AT,
            status: operationStatus,
            terminal: operationStatus === "completed" || operationStatus === "failed",
            refused: false,
            refused_reason: null,
            chosen_factor_id: params.p_chosen_factor_id ?? null,
            completion_owner: params.p_completion_owner ?? "owner-synthetic-1",
            completion_generation: 1,
          }],
          error: null,
        };
      }
      if (fn === "mfa_recovery_mark_factors_removed") {
        return { data: true, error: null };
      }
      if (fn === "mfa_recovery_finalize") {
        return { data: true, error: null };
      }
      if (fn === "mfa_recovery_release_completion") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    // Factor deletion via the adapter.
    admin.auth.admin._deleteFactor = vi.fn(async () => {
      if (deleteError) throw deleteError;
      return { data: {}, error: null };
    });
    return admin;
  }

  async function verifyWithLatch(admin, factorId) {
    const { verifiedSessionClaims } = await import("@/lib/auth/requireSecurityAssurance.js");
    const nowS = Math.floor(Date.now() / 1000);
    vi.mocked(verifiedSessionClaims).mockResolvedValue({
      sub: "user-synthetic-1",
      session_id: "sess-synthetic-1",
      aal: "aal1",
      iat: nowS - 60,
      amr: [{ method: "password", timestamp: nowS - 60 }],
    });
    mockCreateServerAuthClient.mockReturnValue(admin);
    return POST(
      post({ action: "verify", access_token: "atk", factor_id: factorId, challenge_id: "c", code: "123456", operationId: OP_ID })
    );
  }

  it("L2-006 probe: verifying the OLD lost factor does NOT complete the recovery (new-factor binding)", async () => {
    // The new factor was created BEFORE the recovery operation started —
    // this is the old lost factor, not a fresh re-enrollment.
    const admin = adminWithLatch({ newFactorCreatedAt: new Date(Date.now() - 7200 * 1000).toISOString() });
    const res = await verifyWithLatch(admin, NEW_FACTOR_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.recovery.completed).toBe(false);
    expect(json.recovery.reason).toBe("new-factor binding failed");
    // No factors deleted, no finalize.
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
  });

  it("L2-006 probe: a completed operation replays its disposition without side effects", async () => {
    const admin = adminWithLatch({
      operationStatus: "completed",
      newFactorCreatedAt: new Date().toISOString(),
    });
    const res = await verifyWithLatch(admin, NEW_FACTOR_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recovery.completed).toBe(true);
    expect(json.recovery.replayed).toBe(true);
    // Terminal replay: no deletions, no phase transitions.
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
    const finalizeCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_finalize");
    expect(finalizeCalls).toHaveLength(0);
  });

  it("L2-006 probe: factor-deletion failure is NEVER reported as ok (resumable, not completed)", async () => {
    const admin = adminWithLatch({
      newFactorCreatedAt: new Date().toISOString(),
      deleteError: new Error("provider unavailable"),
    });
    const res = await verifyWithLatch(admin, NEW_FACTOR_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    // The verify itself succeeded (AAL2 session issued)...
    expect(json.status).toBe("ok");
    // ...but the recovery is NOT reported completed after partial failure.
    expect(json.recovery.completed).toBe(false);
    expect(json.recovery.reason).toBe("factor deletion failed");
    // The finalize phase never ran.
    const finalizeCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_finalize");
    expect(finalizeCalls).toHaveLength(0);
  });

  it("L2-006 probe: a genuine new factor completes the recovery through all phases", async () => {
    const admin = adminWithLatch({ newFactorCreatedAt: new Date().toISOString() });
    const res = await verifyWithLatch(admin, NEW_FACTOR_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recovery.completed).toBe(true);
    expect(json.recovery.operationId).toBe("op-recovery-1");
    // The OLD factor was deleted; the new one was not.
    expect(admin.auth.admin._deleteFactor).toHaveBeenCalledTimes(1);
    // All three phases ran in order.
    const phases = admin.rpc.mock.calls.map(([fn]) => fn).filter((fn) => fn.startsWith("mfa_recovery_"));
    expect(phases).toEqual([
      "mfa_recovery_begin_completion",
      "mfa_recovery_mark_factors_removed",
      "mfa_recovery_finalize",
    ]);
  });

  it("L2-006 probe: the chosen factor is revalidated before finalize; a dead factor releases the claim instead of finalizing", async () => {
    const admin = adminWithLatch({ newFactorCreatedAt: new Date().toISOString() });
    const OLD = { id: OLD_FACTOR_ID, factor_type: "totp", status: "verified", created_at: new Date(Date.now() - 86400 * 1000).toISOString() };
    const NEW_LIVE = { id: NEW_FACTOR_ID, factor_type: "totp", status: "verified", created_at: new Date().toISOString() };
    const NEW_DEAD = { ...NEW_LIVE, status: "unverified" };
    // Binding listing: chosen factor verified. Revalidation listing: dead.
    admin.auth.admin._listFactors
      .mockResolvedValueOnce({ data: { factors: [NEW_LIVE, OLD] }, error: null })
      .mockResolvedValueOnce({ data: { factors: [NEW_DEAD, OLD] }, error: null });
    const res = await verifyWithLatch(admin, NEW_FACTOR_ID);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recovery.completed).toBe(false);
    expect(json.recovery.reason).toBe("chosen factor no longer verified");
    // Finalize never ran; the fence claim was released so a later
    // ceremony is not wedged.
    const finalizeCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_finalize");
    expect(finalizeCalls).toHaveLength(0);
    const releaseCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_release_completion");
    expect(releaseCalls).toHaveLength(1);
    // The release presented the exact fence lineage begin returned.
    const beginCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_begin_completion");
    expect(beginCalls).toHaveLength(1);
    expect(releaseCalls[0][1].p_completion_owner).toBe(beginCalls[0][1].p_completion_owner);
    expect(releaseCalls[0][1].p_operation_id).toBe("op-recovery-1");
  });
});

describe("L2-006A fenced completion (round 3): two ceremonies, one recovery", () => {
  const OP_STARTED = new Date(Date.now() - 3600 * 1000).toISOString(); // 1h ago
  const OP_ID_A = "123e4567-e89b-12d3-a456-426614174001";
  const OP_ID_B = "123e4567-e89b-12d3-a456-426614174002";

  // Test-local fencing adapter mirroring the SQL semantics: the
  // check-and-set in begin is synchronous (atomic under JS
  // single-threading). The factor listing is synchronized so both
  // ceremonies see the same valid [A, B] snapshot, exactly like the
  // verdict's interleaving probe.
  function fencingRaceAdmin() {
    const FACTOR_A = "factor-race-A";
    const FACTOR_B = "factor-race-B";
    const admin = fakeAdmin();
    const deleted = [];
    const fence = { claimed: null };
    const snapshot = [
      { id: FACTOR_A, factor_type: "totp", status: "verified", created_at: new Date().toISOString() },
      { id: FACTOR_B, factor_type: "totp", status: "verified", created_at: new Date().toISOString() },
    ];
    admin.from = vi.fn((table) => {
      if (table === "mfa_security_latch") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: USER.id }, error: null }) }) }) };
      }
      if (table === "mfa_recovery_operations") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "op-recovery-1", status: "latched", created_at: OP_STARTED }, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    admin.auth.admin = {
      _listFactors: vi.fn(() => Promise.resolve({ data: { factors: snapshot.map((f) => ({ ...f })) }, error: null })),
      _deleteFactor: vi.fn(async ({ id }) => {
        deleted.push(id);
        return { data: {}, error: null };
      }),
    };
    admin.rpc = vi.fn(async (fn, params) => {
      if (fn === "auth_claim_execution") {
        return { data: [{ granted: true, disposition: "granted", outcome: "executing" }], error: null };
      }
      if (fn === "mfa_recovery_begin_completion") {
        const c = fence.claimed;
        if (!c) {
          fence.claimed = { chosen: params.p_chosen_factor_id, owner: params.p_completion_owner, gen: 1 };
        } else if (c.chosen !== params.p_chosen_factor_id) {
          return { data: [{ operation_created_at: OP_STARTED, status: "latched", terminal: false, refused: true, refused_reason: "claimed", chosen_factor_id: c.chosen, completion_owner: c.owner, completion_generation: c.gen }], error: null };
        } else {
          c.gen += 1;
        }
        const cur = fence.claimed;
        return { data: [{ operation_created_at: OP_STARTED, status: "latched", terminal: false, refused: false, refused_reason: null, chosen_factor_id: cur.chosen, completion_owner: cur.owner, completion_generation: cur.gen }], error: null };
      }
      if (fn === "mfa_recovery_mark_factors_removed" || fn === "mfa_recovery_finalize") {
        const c = fence.claimed;
        if (!c || params.p_completion_owner !== c.owner || params.p_completion_generation !== c.gen) {
          return { data: false, error: null };
        }
        return { data: true, error: null };
      }
      if (fn === "mfa_recovery_release_completion") {
        return { data: true, error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    return { admin, deleted, FACTOR_A, FACTOR_B, fence };
  }

  async function claimsWithFreshFirstFactor() {
    const { verifiedSessionClaims } = await import("@/lib/auth/requireSecurityAssurance.js");
    const nowS = Math.floor(Date.now() / 1000);
    vi.mocked(verifiedSessionClaims).mockResolvedValue({
      sub: USER.id,
      session_id: "sess-synthetic-1",
      aal: "aal1",
      iat: nowS - 60,
      amr: [{ method: "password", timestamp: nowS - 60 }],
    });
  }

  function verifyPost(admin, factorId, operationId) {
    mockCreateServerAuthClient.mockReturnValue(admin);
    return POST(
      post({ action: "verify", access_token: "atk", factor_id: factorId, challenge_id: "c", code: "123456", operationId: operationId })
    );
  }

  it("L2-006A probe (round 3): two concurrent ceremonies with different chosen factors — exactly one completes, zero factors lost wrongly", async () => {
    const { admin, deleted, FACTOR_A, FACTOR_B } = fencingRaceAdmin();
    await claimsWithFreshFirstFactor();
    // Two verify requests, DIFFERENT admitted HTTP operation IDs, racing
    // the SAME latched recovery operation.
    const [resA, resB] = await Promise.all([
      verifyPost(admin, FACTOR_A, OP_ID_A),
      verifyPost(admin, FACTOR_B, OP_ID_B),
    ]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);
    const jsonA = await resA.json();
    const jsonB = await resB.json();
    const completed = [jsonA, jsonB].filter((j) => j.recovery?.completed === true);
    const refused = [jsonA, jsonB].filter((j) => j.recovery?.completed === false);
    // Exactly one ceremony completes; the other is refused — never two
    // completed:true with zero surviving factors.
    expect(completed).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0].recovery.reason).toBe("completion owned by another ceremony");
    // The winner's chosen factor was never deleted; only the loser's was
    // (deleted by the single fenced ceremony).
    const winnerId = completed[0].recovery.chosenFactorId;
    expect([FACTOR_A, FACTOR_B]).toContain(winnerId);
    expect(deleted).not.toContain(winnerId);
    expect(deleted).toHaveLength(1);
    // Exactly one finalize ran.
    const finalizeCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_finalize");
    expect(finalizeCalls).toHaveLength(1);
  });

  it("L2-006A probe (round 3): same-factor resume re-enters under the fence after a partial failure", async () => {
    const { admin, FACTOR_A } = fencingRaceAdmin();
    await claimsWithFreshFirstFactor();
    // First ceremony: provider deletion throws mid-completion.
    admin.auth.admin._deleteFactor.mockRejectedValueOnce(new Error("provider unavailable"));
    const res1 = await verifyPost(admin, FACTOR_A, OP_ID_A);
    expect((await res1.json()).recovery).toMatchObject({ completed: false, reason: "factor deletion failed" });
    // Second ceremony, same chosen factor, different HTTP operation id:
    // resumes the fenced completion and finishes it.
    const res2 = await verifyPost(admin, FACTOR_A, OP_ID_B);
    const json2 = await res2.json();
    expect(json2.recovery.completed).toBe(true);
    expect(json2.recovery.chosenFactorId).toBe(FACTOR_A);
    const finalizeCalls = admin.rpc.mock.calls.filter(([fn]) => fn === "mfa_recovery_finalize");
    expect(finalizeCalls).toHaveLength(1);
  });

  it("L2-006A probe (round 3): a stale owner presenting a different chosen factor is refused with zero deletions", async () => {
    const admin = fakeAdmin();
    admin.from = vi.fn((table) => {
      if (table === "mfa_security_latch") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: USER.id }, error: null }) }) }) };
      }
      if (table === "mfa_recovery_operations") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "op-recovery-1", status: "latched", created_at: OP_STARTED }, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    admin.auth.admin = {
      _listFactors: vi.fn(() => Promise.resolve({
        data: { factors: [{ id: "factor-new-9", factor_type: "totp", status: "verified", created_at: new Date().toISOString() }] },
        error: null,
      })),
      _deleteFactor: vi.fn(async () => ({ data: {}, error: null })),
    };
    admin.rpc = vi.fn(async (fn, params) => {
      if (fn === "auth_claim_execution") {
        return { data: [{ granted: true, disposition: "granted", outcome: "executing" }], error: null };
      }
      if (fn === "mfa_recovery_begin_completion") {
        // Already claimed by a competing ceremony with another factor.
        return { data: [{ operation_created_at: OP_STARTED, status: "latched", terminal: false, refused: true, refused_reason: "claimed", chosen_factor_id: "factor-other", completion_owner: "owner-other", completion_generation: 1 }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    await claimsWithFreshFirstFactor();
    const res = await verifyPost(admin, "factor-new-9", OP_ID_A);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recovery.completed).toBe(false);
    expect(json.recovery.reason).toBe("completion owned by another ceremony");
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
    const phaseCalls = admin.rpc.mock.calls.filter(([fn]) => fn.startsWith("mfa_recovery_") && fn !== "mfa_recovery_begin_completion");
    expect(phaseCalls).toHaveLength(0);
  });

  it("L2-006A probe (round 3): an older operation is refused when a newer recovery operation exists", async () => {
    const admin = fakeAdmin();
    admin.from = vi.fn((table) => {
      if (table === "mfa_security_latch") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: USER.id }, error: null }) }) }) };
      }
      if (table === "mfa_recovery_operations") {
        // The route resolved an older operation (stale read); the RPC
        // knows a newer non-terminal operation exists.
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "op-old-1", status: "latched", created_at: OP_STARTED }, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    admin.auth.admin = {
      _listFactors: vi.fn(() => Promise.resolve({
        data: { factors: [{ id: "factor-new-9", factor_type: "totp", status: "verified", created_at: new Date().toISOString() }] },
        error: null,
      })),
      _deleteFactor: vi.fn(async () => ({ data: {}, error: null })),
    };
    admin.rpc = vi.fn(async (fn) => {
      if (fn === "auth_claim_execution") {
        return { data: [{ granted: true, disposition: "granted", outcome: "executing" }], error: null };
      }
      if (fn === "mfa_recovery_begin_completion") {
        return { data: [{ operation_created_at: OP_STARTED, status: "latched", terminal: false, refused: true, refused_reason: "stale_operation", chosen_factor_id: null, completion_owner: null, completion_generation: null }], error: null };
      }
      throw new Error(`unexpected rpc ${fn}`);
    });
    await claimsWithFreshFirstFactor();
    const res = await verifyPost(admin, "factor-new-9", OP_ID_A);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.recovery.completed).toBe(false);
    expect(json.recovery.reason).toBe("a newer recovery operation supersedes this one");
    // The older operation deleted nothing and advanced nothing.
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
    const phaseCalls = admin.rpc.mock.calls.filter(([fn]) => fn.startsWith("mfa_recovery_") && fn !== "mfa_recovery_begin_completion");
    expect(phaseCalls).toHaveLength(0);
  });
});

describe("L2-006B verify-response validation ordering (round 3)", () => {
  const NEW_FACTOR_ID = "factor-new-3";
  const OP_STARTED_AT = new Date(Date.now() - 3600 * 1000).toISOString();

  function latchedAdmin() {
    const admin = fakeAdmin();
    admin.from = vi.fn((table) => {
      if (table === "mfa_security_latch") {
        return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { user_id: USER.id }, error: null }) }) }) };
      }
      if (table === "mfa_recovery_operations") {
        return { select: () => ({ eq: () => ({ order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: { id: "op-recovery-1", status: "latched", created_at: OP_STARTED_AT }, error: null }) }) }) }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    });
    admin.auth.admin = {
      _listFactors: vi.fn(() => Promise.resolve({
        data: {
          factors: [
            { id: NEW_FACTOR_ID, factor_type: "totp", status: "verified", created_at: new Date().toISOString() },
            { id: "factor-old-9", factor_type: "totp", status: "verified", created_at: new Date(Date.now() - 86400 * 1000).toISOString() },
          ],
        },
        error: null,
      })),
      _deleteFactor: vi.fn(async () => ({ data: {}, error: null })),
    };
    return admin;
  }

  async function verifyMalformed(admin, verifyResult) {
    const { verifiedSessionClaims } = await import("@/lib/auth/requireSecurityAssurance.js");
    const nowS = Math.floor(Date.now() / 1000);
    vi.mocked(verifiedSessionClaims).mockResolvedValue({
      sub: USER.id,
      session_id: "sess-synthetic-1",
      aal: "aal1",
      iat: nowS - 60,
      amr: [{ method: "password", timestamp: nowS - 60 }],
    });
    mockCreateServerAuthClient.mockReturnValue(admin);
    mockCreateUserScopedAuthClient.mockImplementation(() => fakeUserClient({ verifyResult }));
    return POST(
      post({ action: "verify", access_token: "atk", factor_id: NEW_FACTOR_ID, challenge_id: "c", code: "123456", operationId: OP_ID })
    );
  }

  async function attemptOutcomes() {
    const { recordAttemptOutcome } = await import("@/lib/auth/authRateLimit.js");
    return vi.mocked(recordAttemptOutcome).mock.calls.map((args) => args[0]?.outcome);
  }

  it("L2-006B probe (round 3): {data:{},error:null} is a failed verify with ZERO recovery side effects", async () => {
    const admin = latchedAdmin();
    const res = await verifyMalformed(admin, { data: {}, error: null });
    expect(res.status).toBe(401);
    // No success accounting: mfa_succeeded never recorded.
    const outcomes = await attemptOutcomes();
    expect(outcomes).not.toContain("mfa_succeeded");
    expect(outcomes).toContain("mfa_failed");
    // Zero recovery mutation: no begin, no deletions, no finalize.
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
    const recoveryCalls = admin.rpc.mock.calls.filter(([fn]) => fn.startsWith("mfa_recovery_"));
    expect(recoveryCalls).toHaveLength(0);
  });

  it("L2-006B probe (round 3): a token bound to the WRONG user is rejected before any recovery side effect", async () => {
    const admin = latchedAdmin();
    const res = await verifyMalformed(admin, {
      data: { access_token: "tok-wrong-user", user: { id: "user-attacker" } },
      error: null,
    });
    expect(res.status).toBe(401);
    const outcomes = await attemptOutcomes();
    expect(outcomes).not.toContain("mfa_succeeded");
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
    const recoveryCalls = admin.rpc.mock.calls.filter(([fn]) => fn.startsWith("mfa_recovery_"));
    expect(recoveryCalls).toHaveLength(0);
  });

  it("L2-006B probe (round 3): a response reporting non-AAL2 assurance is rejected before any recovery side effect", async () => {
    const admin = latchedAdmin();
    const res = await verifyMalformed(admin, {
      data: { access_token: "tok-aal1", user: { id: USER.id, aal: "aal1" } },
      error: null,
    });
    expect(res.status).toBe(401);
    const outcomes = await attemptOutcomes();
    expect(outcomes).not.toContain("mfa_succeeded");
    expect(admin.auth.admin._deleteFactor).not.toHaveBeenCalled();
    const recoveryCalls = admin.rpc.mock.calls.filter(([fn]) => fn.startsWith("mfa_recovery_"));
    expect(recoveryCalls).toHaveLength(0);
  });

  it("L2-006B probe (round 3): a valid flat SDK response still verifies and completes the latched recovery", async () => {
    const admin = latchedAdmin();
    const res = await verifyMalformed(admin, {
      data: {
        access_token: "tok-valid",
        refresh_token: "rt-valid",
        expires_in: 3600,
        user: { id: USER.id, aal: "aal2" },
      },
      error: null,
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.status).toBe("ok");
    expect(json.session.access_token).toBe("tok-valid");
    const outcomes = await attemptOutcomes();
    expect(outcomes).toContain("mfa_succeeded");
    expect(json.recovery.completed).toBe(true);
  });
});
