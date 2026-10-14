import { describe, expect, it, vi } from "vitest";

import { requireSecurityAssurance } from "./requireSecurityAssurance.js";

const ENABLED = { enabled: true };
const USER = { id: "user-1" };

// Builds a supabaseAdmin mock. from(table) supports the query shapes used by
// the guard: .select().eq().maybeSingle() and auth.admin.listFactors.
function mockAdmin({
  getUserResult = { data: { user: { id: "user-1", aal: "aal1", amr: [{ method: "password" }] } }, error: null },
  factors = [],
  latch = null,
  family = null,
  fromError = null,
  membershipsData = [],
  workspacesData = [],
} = {}) {
  return {
    auth: {
      getUser: vi.fn(() => Promise.resolve(getUserResult)),
      admin: {
        listFactors: vi.fn(() => Promise.resolve({ data: { totp: factors, all: factors }, error: null })),
      },
    },
    from: vi.fn((table) => {
      const isCohortTable = table === "workspace_members" || table === "workspaces";
      const row = table === "mfa_security_latch" ? latch : family;
      const cohortData = table === "workspace_members" ? membershipsData : workspacesData;
      const eqPromise = Promise.resolve(
        fromError
          ? { data: null, error: fromError }
          : isCohortTable
            ? { data: cohortData, error: null }
            : { data: null, error: null }
      );
      // PostgREST thenable: awaitable directly, and chainable to maybeSingle.
      eqPromise.maybeSingle = () =>
        Promise.resolve(fromError ? { data: null, error: fromError } : { data: row, error: null });
      eqPromise.eq = () => eqPromise;
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => eqPromise) })),
      };
    }),
  };
}

function sessionWith({ aal = "aal1", amr, sessionId = "sess-1" } = {}) {
  return {
    access_token: "token-abc",
    user: { id: "user-1", aal, amr: amr ?? [{ method: "password" }], session_id: sessionId },
  };
}

// Cohort resolution is exercised through the real resolveActorEligibility with
// a workspace_members/workspaces mock — no fallback to primary_owner anywhere.
function adminForCohort({ memberships = [], workspaces = [], ...rest } = {}) {
  const admin = mockAdmin(rest);
  const origFrom = admin.from;
  admin.from = vi.fn((table) => {
    if (table === "workspace_members" || table === "workspaces") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() =>
            Promise.resolve({
              data: table === "workspace_members" ? memberships : workspaces,
              error: null,
            })
          ),
        })),
      };
    }
    return origFrom(table);
  });
  return admin;
}

describe("requireSecurityAssurance", () => {
  it("is an explicit labeled pass-through while Layer 2 is disabled", async () => {
    const admin = mockAdmin();
    const result = await requireSecurityAssurance({ supabaseAdmin: admin, user: USER, session: sessionWith() });
    expect(result).toMatchObject({ authorized: true, reason: "layer2-disabled" });
    expect(admin.auth.getUser).not.toHaveBeenCalled();
  });

  it("denies when the session token cannot be validated", async () => {
    const admin = mockAdmin({ getUserResult: { data: { user: null }, error: new Error("bad token") } });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("invalid-session");
  });

  it("denies on identity mismatch between claim and verified session", async () => {
    const admin = mockAdmin({
      getUserResult: { data: { user: { id: "user-2", aal: "aal1", amr: [] } }, error: null },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("identity-mismatch");
  });

  it("denies privileged access when cohort resolution fails (unknown, never exemption)", async () => {
    const admin = mockAdmin({ fromError: new Error("db down") });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.cohort).toBe("unknown");
    expect(result.reason).toBe("unknown-cohort");
  });

  it("authorizes an optional-cohort consumer without AAL2", async () => {
    const admin = adminForCohort({ memberships: [], workspaces: [] });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, cohort: "optional", reason: "optional-cohort" });
  });

  it("denies a latched user even with an otherwise-valid AAL2 session", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      latch: { user_id: "user-1", latched_at: "2026-10-13T00:00:00Z", reason: "recovery" },
      getUserResult: { data: { user: { id: "user-1", aal: "aal2", amr: [{ method: "totp" }] } }, error: null },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith({ aal: "aal2" }), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "RECOVERY_PENDING", reason: "recovery-latch" });
  });

  it("authorizes a required-cohort session with provider-issued AAL2", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "staff", status: "active" }],
      getUserResult: { data: { user: { id: "user-1", aal: "aal2", amr: [{ method: "totp" }] } }, error: null },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith({ aal: "aal2" }), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, state: "AUTHORIZED", cohort: "required", reason: "aal2" });
  });

  it("requires enrollment for a required-cohort AAL1 session with no verified factor", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      factors: [],
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "ENROLL_REQUIRED", reason: "no-enrolled-factor" });
  });

  it("requires a challenge for a required-cohort AAL1 session with a verified factor", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      family: null,
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "CHALLENGE_REQUIRED", reason: "challenge-required" });
  });

  it("honors a grandfathered session family for the same user + session_id", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      family: { user_id: "user-1", session_id: "sess-1", state: "AUTHORIZED", revoked_at: null },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith({ sessionId: "sess-1" }), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, reason: "grandfathered-session-family" });
  });

  it("does NOT grandfather a revoked family", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      family: { user_id: "user-1", session_id: "sess-1", state: "AUTHORIZED", revoked_at: "2026-10-13T01:00:00Z" },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith({ sessionId: "sess-1" }), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "CHALLENGE_REQUIRED" });
  });

  it("does NOT grandfather a recovery-pending family", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      family: { user_id: "user-1", session_id: "sess-1", state: "RECOVERY_PENDING", revoked_at: null },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith({ sessionId: "sess-1" }), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false });
  });

  it("does NOT grandfather a NEW session family (different session_id)", async () => {
    const admin = adminForCohort({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      family: null, // no row for the new family
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: sessionWith({ sessionId: "sess-NEW" }), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "CHALLENGE_REQUIRED", reason: "challenge-required" });
  });

  it("denies when the session or user claim is missing", async () => {
    const admin = mockAdmin();
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: null, config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, reason: "missing-session" });
  });
});
