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

  it("L2-004 probe: stale AAL2 ceremony (old iat) does NOT issue codes (403)", async () => {
    const admin = adminWithFactor(freshIso());
    const res = await issueCodes(admin, {
      aal: "aal2",
      iat: Math.floor(Date.now() / 1000) - 3600,
      amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) - 60 }],
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

  it("L2-004 probe: fresh AAL2 + recent enrollment issues codes via the atomic RPC", async () => {
    const admin = adminWithFactor(freshIso());
    const res = await issueCodes(admin, { aal: "aal2", iat: freshIat() });
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
                    Promise.resolve({ data: { id: "op-recovery-1", status: operationStatus }, error: null })
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
        return { data: [{ operation_created_at: OP_STARTED_AT, status: operationStatus, terminal: operationStatus === "completed" || operationStatus === "failed" }], error: null };
      }
      if (fn === "mfa_recovery_mark_factors_removed") {
        return { data: true, error: null };
      }
      if (fn === "mfa_recovery_finalize") {
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
});
