import { describe, expect, it, vi } from "vitest";

import { requireSecurityAssurance, verifiedSessionClaims } from "./requireSecurityAssurance.js";

const ENABLED = { enabled: true };
const USER = { id: "user-1" };

// Builds a supabaseAdmin mock for the CORRECTED guard contracts:
// - auth.getUser(accessToken) -> { data: { user } } (identity only)
// - auth.getClaims(accessToken) -> { data: { claims: { sub, aal, amr, session_id } } }
// - auth.admin._listFactors({ userId }) -> { data: { factors } }
// - from("workspace_members").select().eq(member_user_id)
// - from("rental_tenants" | "private_financing_borrowers").select().eq(auth_user_id)
// - from("mfa_security_latch") / from("session_grandfather_registry") -> maybeSingle
function mockAdmin({
  getUserResult = { data: { user: { id: "user-1" } }, error: null },
  claimsResult = {
    data: { claims: { sub: "user-1", aal: "aal1", amr: [{ method: "password" }], session_id: "sess-1" } },
    error: null,
  },
  factors = [],
  latch = null,
  grandfatherRow = null,
  fromError = null,
  membershipsData = [],
  tenantsData = [],
  borrowersData = [],
} = {}) {
  return {
    auth: {
      getUser: vi.fn(() => Promise.resolve(getUserResult)),
      getClaims: vi.fn(() => Promise.resolve(claimsResult)),
      admin: {
        _listFactors: vi.fn(() => Promise.resolve({ data: { factors }, error: null })),
      },
    },
    from: vi.fn((table) => {
      const singleRow =
        table === "mfa_security_latch" ? latch : table === "session_grandfather_registry" ? grandfatherRow : null;
      const listData =
        table === "workspace_members"
          ? membershipsData
          : table === "rental_tenants"
            ? tenantsData
            : table === "private_financing_borrowers"
              ? borrowersData
              : [];
      const eqPromise = Promise.resolve(
        fromError ? { data: null, error: fromError } : { data: listData, error: null }
      );
      // PostgREST thenable: awaitable directly, and chainable to maybeSingle.
      eqPromise.maybeSingle = () =>
        Promise.resolve(fromError ? { data: null, error: fromError } : { data: singleRow, error: null });
      eqPromise.eq = () => eqPromise;
      eqPromise.limit = () => eqPromise;
      return {
        select: vi.fn(() => ({ eq: vi.fn(() => eqPromise) })),
      };
    }),
  };
}

function session() {
  return { access_token: "token-abc" };
}

// Cohort resolution is exercised through the real resolveActorEligibility
// with the ACTUAL deployed schema columns (member_user_id / auth_user_id).
function adminForCohort({ memberships = [], tenants = [], borrowers = [], ...rest } = {}) {
  const admin = mockAdmin(rest);
  const origFrom = admin.from;
  admin.from = vi.fn((table) => {
    if (table === "workspace_members" || table === "rental_tenants" || table === "private_financing_borrowers") {
      const data =
        table === "workspace_members" ? memberships : table === "rental_tenants" ? tenants : borrowers;
      const p = Promise.resolve({ data, error: null });
      p.maybeSingle = () => Promise.resolve({ data: null, error: null });
      p.eq = () => p;
      p.limit = () => p;
      return { select: vi.fn(() => ({ eq: vi.fn(() => p) })) };
    }
    return origFrom(table);
  });
  return admin;
}

describe("requireSecurityAssurance", () => {
  it("is an explicit labeled pass-through while Layer 2 is disabled", async () => {
    const admin = mockAdmin();
    const result = await requireSecurityAssurance({ supabaseAdmin: admin, user: USER, session: session() });
    expect(result).toMatchObject({ authorized: true, reason: "layer2-disabled" });
    expect(admin.auth.getUser).not.toHaveBeenCalled();
    expect(admin.auth.getClaims).not.toHaveBeenCalled();
  });

  it("denies when the session token cannot be validated", async () => {
    const admin = mockAdmin({ getUserResult: { data: { user: null }, error: new Error("bad token") } });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("invalid-session");
  });

  it("denies on identity mismatch between claim and verified session", async () => {
    const admin = mockAdmin({ getUserResult: { data: { user: { id: "user-2" } }, error: null } });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("identity-mismatch");
  });

  it("denies when JWT claims cannot be validated or are not bound to the user", async () => {
    const admin = mockAdmin({
      claimsResult: { data: { claims: { sub: "user-2", aal: "aal2", amr: [], session_id: "sess-1" } }, error: null },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.reason).toBe("claims-validation-failed");
  });

  it("denies privileged access when cohort resolution fails (unknown, never exemption)", async () => {
    const admin = mockAdmin({ fromError: new Error("db down") });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.cohort).toBe("unknown");
    expect(result.reason).toBe("unknown-cohort");
  });

  it("authorizes an optional-cohort consumer (linked tenant, no membership) without AAL2", async () => {
    const admin = adminForCohort({ memberships: [], tenants: [{ id: "t-1" }], borrowers: [] });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, cohort: "optional", reason: "optional-cohort" });
  });

  it("treats a user with no membership and no tenant/borrower link as required (primary owner)", async () => {
    const admin = adminForCohort({ memberships: [], tenants: [], borrowers: [] });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result.cohort).toBe("required");
    expect(result.authorized).toBe(false);
    expect(result.state).toBe("ENROLL_REQUIRED");
  });

  it("denies a latched user even with an otherwise-valid AAL2 session", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      latch: { user_id: "user-1", latched_at: "2026-10-13T00:00:00Z", reason: "recovery" },
    });
    admin.auth.getClaims = vi.fn(() =>
      Promise.resolve({
        data: { claims: { sub: "user-1", aal: "aal2", amr: [{ method: "totp" }], session_id: "sess-1" } },
        error: null,
      })
    );
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "RECOVERY_PENDING", reason: "recovery-latch" });
  });

  it("authorizes a required-cohort session with provider-issued AAL2 claims", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "staff", status: "active" }],
    });
    admin.auth.getClaims = vi.fn(() =>
      Promise.resolve({
        data: { claims: { sub: "user-1", aal: "aal2", amr: [{ method: "totp" }], session_id: "sess-1" } },
        error: null,
      })
    );
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, state: "AUTHORIZED", cohort: "required", reason: "aal2" });
  });

  it("L2-001 probe: AAL1+oauth amr is NOT AAL2 (oauth never counts as a second factor)", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [],
    });
    admin.auth.getClaims = vi.fn(() =>
      Promise.resolve({
        data: {
          claims: {
            sub: "user-1",
            aal: "aal1",
            amr: [{ method: "password" }, { method: "oauth" }],
            session_id: "sess-1",
          },
        },
        error: null,
      })
    );
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.state).toBe("ENROLL_REQUIRED");
  });

  it("accepts amr totp as a second factor even without the aal2 claim", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
    });
    admin.auth.getClaims = vi.fn(() =>
      Promise.resolve({
        data: {
          claims: {
            sub: "user-1",
            aal: "aal1",
            amr: [{ method: "password" }, { method: "totp" }],
            session_id: "sess-1",
          },
        },
        error: null,
      })
    );
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, reason: "aal2" });
  });

  it("requires enrollment for a required-cohort AAL1 session with no verified factor", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [],
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "ENROLL_REQUIRED", reason: "no-enrolled-factor" });
  });

  it("requires a challenge for a required-cohort AAL1 session with a verified factor", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      grandfatherRow: null,
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "CHALLENGE_REQUIRED", reason: "aal1-with-factor" });
    // The grandfather lookup used the session_id from the validated CLAIMS,
    // never a caller-supplied field.
    expect(admin.auth.getClaims).toHaveBeenCalledWith("token-abc");
  });

  it("L2-001 probe: honors a grandfathered session family with NO enrolled factor", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [],
      grandfatherRow: { user_id: "user-1", session_id: "sess-1" },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, reason: "grandfathered" });
    // No factor listing needed: grandfathering is checked BEFORE factors.
    expect(admin.auth.admin._listFactors).not.toHaveBeenCalled();
  });

  it("L2-001 probe: honors a grandfathered session family with a verified factor", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      grandfatherRow: { user_id: "user-1", session_id: "sess-1" },
    });
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: true, reason: "grandfathered" });
  });

  it("does NOT grandfather a NEW session family (session_id not in the registry)", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [{ id: "f-1", status: "verified", factor_type: "totp" }],
      grandfatherRow: null, // no row for sess-1
    });
    admin.auth.getClaims = vi.fn(() =>
      Promise.resolve({
        data: { claims: { sub: "user-1", aal: "aal1", amr: [{ method: "password" }], session_id: "sess-NEW" } },
        error: null,
      })
    );
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: session(), config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, state: "CHALLENGE_REQUIRED", reason: "aal1-with-factor" });
  });

  it("L2-001 probe: a caller-supplied session_id cannot fake grandfathering", async () => {
    const admin = adminForCohort({
      memberships: [{ owner_id: "user-1", role: "owner", status: "active" }],
      factors: [],
      // Registry has a DIFFERENT session; the caller tries to smuggle
      // sess-1 via a caller-supplied field (which the guard must ignore).
      grandfatherRow: null,
    });
    // Claims (the only trusted session_id source) say sess-9: no row.
    admin.auth.getClaims = vi.fn(() =>
      Promise.resolve({
        data: { claims: { sub: "user-1", aal: "aal1", amr: [{ method: "password" }], session_id: "sess-9" } },
        error: null,
      })
    );
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin,
      user: USER,
      session: { access_token: "token-abc", user: { session_id: "sess-1" } },
      config: ENABLED,
    });
    expect(result.authorized).toBe(false);
    expect(result.state).toBe("ENROLL_REQUIRED");
  });

  it("denies when the session or user claim is missing", async () => {
    const admin = mockAdmin();
    const result = await requireSecurityAssurance({
      supabaseAdmin: admin, user: USER, session: null, config: ENABLED,
    });
    expect(result).toMatchObject({ authorized: false, reason: "missing-session" });
  });
});

describe("verifiedSessionClaims", () => {
  it("returns claims bound to the verified user", async () => {
    const admin = mockAdmin();
    const claims = await verifiedSessionClaims(admin, "token-abc", "user-1");
    expect(claims).toMatchObject({ sub: "user-1", aal: "aal1", session_id: "sess-1" });
    expect(admin.auth.getClaims).toHaveBeenCalledWith("token-abc");
  });

  it("returns null when claims name a different subject", async () => {
    const admin = mockAdmin();
    expect(await verifiedSessionClaims(admin, "token-abc", "user-9")).toBeNull();
  });

  it("returns null when the provider reports an error", async () => {
    const admin = mockAdmin({ claimsResult: { data: null, error: new Error("bad") } });
    expect(await verifiedSessionClaims(admin, "token-abc", "user-1")).toBeNull();
  });
});
