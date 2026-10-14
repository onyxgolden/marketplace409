import { describe, expect, it, vi } from "vitest";
import {
  PREVIEW_COOKIE_MAX_AGE_SECONDS,
  PREVIEW_COOKIE_NAME,
  getActorRentalAuthorization,
  requireRentalPermission,
  requireTeamManager,
} from "./teamAuthorization.js";
import { RENTAL_PERMISSION_KEYS } from "./permissions.js";

// Controllable mock for the Layer 2 guard (dynamically imported by
// teamAuthorization.js only when a security context is supplied AND
// activation is on). Default: authorize. vi.hoisted so the hoisted vi.mock
// factory can reference it.
const { mockRequireSecurityAssurance } = vi.hoisted(() => ({
  mockRequireSecurityAssurance: vi.fn(async () => ({
    authorized: true, state: "AUTHORIZED", cohort: "required", reason: "aal2",
  })),
}));
vi.mock("@/lib/auth/requireSecurityAssurance.js", () => ({
  requireSecurityAssurance: (...args) => mockRequireSecurityAssurance(...args),
  verifiedSessionClaims: vi.fn(async () => null),
}));

// Builds a supabase-client stub that answers the two workspace_members queries the
// authorization layer makes: the actor membership lookup and the preview target lookup.
// The two queries are told apart by their .eq() arguments.
function stubClient({ membership = null, target = null, membershipError = null, targetError = null } = {}) {
  return {
    from: (table) => {
      if (table !== "workspace_members") throw new Error(`unexpected table ${table}`);
      const eqArgs = [];
      const query = {
        select: () => query,
        eq: (column, value) => {
          eqArgs.push([column, value]);
          return query;
        },
        maybeSingle: async () => {
          const cols = eqArgs.map(([c]) => c);
          if (cols.includes("member_user_id")) {
            return { data: membership, error: membershipError };
          }
          if (cols.includes("owner_id")) {
            return { data: target, error: targetError };
          }
          throw new Error(`unexpected eq pattern ${JSON.stringify(eqArgs)}`);
        },
      };
      return query;
    },
  };
}

function requestWithCookie(cookie) {
  return {
    headers: {
      get: (name) => (name === "cookie" ? cookie : null),
    },
  };
}

const noPreview = requestWithCookie("");
const previewAs = (memberId) => requestWithCookie(`${PREVIEW_COOKIE_NAME}=${memberId}`);

const authenticated = (supabaseClient, userId = "owner_1") => ({
  user: { id: userId },
  effectiveOwnerId: "owner_1",
  supabaseClient,
});

const member = (overrides = {}) => ({
  id: "member_staff",
  role: "bookkeeper",
  status: "active",
  permission_overrides: null,
  invited_email: "staff@example.com",
  owner_id: "owner_1",
  member_user_id: "staff_user",
  ...overrides,
});

describe("getActorRentalAuthorization", () => {
  it("treats a missing membership row as the implicit primary owner with full access", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({ membership: null }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: noPreview,
    });
    expect(auth.forbidden).toBeNull();
    expect(auth.isPrimaryOwner).toBe(true);
    expect(auth.role).toBe("primary_owner");
    expect([...auth.permissions].sort()).toEqual([...RENTAL_PERMISSION_KEYS].sort());
    expect(auth.preview).toBeNull();
  });

  it("gives a co-owner the same full access", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({ membership: member({ role: "co_owner" }) }),
      actorUserId: "staff_user",
      effectiveOwnerId: "owner_1",
      request: noPreview,
    });
    expect([...auth.permissions].sort()).toEqual([...RENTAL_PERMISSION_KEYS].sort());
  });

  it("resolves a staff member's effective permissions from role defaults plus overrides", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: member({ role: "maintenance", permission_overrides: { "payments.record": true } }),
      }),
      actorUserId: "staff_user",
      effectiveOwnerId: "owner_1",
      request: noPreview,
    });
    expect(auth.role).toBe("maintenance");
    expect(auth.permissions).toContain("maintenance.manage");
    expect(auth.permissions).toContain("payments.record");
    expect(auth.permissions).not.toContain("team.manage");
  });

  it("grants nothing for an unknown role (deny by default)", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({ membership: member({ role: "mystery" }) }),
      actorUserId: "staff_user",
      effectiveOwnerId: "owner_1",
      request: noPreview,
    });
    expect(auth.permissions).toEqual([]);
  });

  it("returns a 500 when the membership lookup fails", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({ membershipError: { message: "db down" } }),
      actorUserId: "staff_user",
      effectiveOwnerId: "owner_1",
      request: noPreview,
    });
    expect(auth.forbidden.status).toBe(500);
  });
});

describe("requireRentalPermission", () => {
  it("allows the owner through", async () => {
    const gate = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: null })),
      request: noPreview,
      permission: "payments.record",
    });
    expect(gate.response).toBeNull();
    expect(gate.authorization.permissions).toContain("payments.record");
  });

  it("denies a missing permission with 403 and a plain-English label", async () => {
    const gate = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: member({ role: "read_only" }) }), "staff_user"),
      request: noPreview,
      permission: "payments.record",
    });
    expect(gate.response.status).toBe(403);
    const body = await gate.response.json();
    expect(body.error).toMatch(/Can record rent payments/);
    expect(gate.authorization).toBeNull();
  });

  it("denies a missing permission even when the role has others", async () => {
    const gate = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: member({ role: "bookkeeper" }) }), "staff_user"),
      request: noPreview,
      permission: "team.manage",
    });
    expect(gate.response.status).toBe(403);
    const body = await gate.response.json();
    expect(body.error).toMatch(/manage the team/i);
  });

  it("grants an override-given permission", async () => {
    const gate = await requireRentalPermission({
      authenticated: authenticated(
        stubClient({ membership: member({ role: "read_only", permission_overrides: { "payments.record": true } }) }),
        "staff_user"
      ),
      request: noPreview,
      permission: "payments.record",
    });
    expect(gate.response).toBeNull();
  });
});

describe("requireTeamManager", () => {
  it("allows the owner and a co-owner", async () => {
    for (const membership of [null, member({ role: "co_owner" })]) {
      const gate = await requireTeamManager({
        authenticated: authenticated(stubClient({ membership }), membership ? "staff_user" : "owner_1"),
        request: noPreview,
      });
      expect(gate.response).toBeNull();
    }
  });

  it("403s a staff member without team.manage", async () => {
    const gate = await requireTeamManager({
      authenticated: authenticated(stubClient({ membership: member({ role: "bookkeeper" }) }), "staff_user"),
      request: noPreview,
    });
    expect(gate.response.status).toBe(403);
  });
});

describe("view-as preview", () => {
  it("resolves the target's effective permissions when the owner previews staff", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: null,
        target: member({ id: "member_staff", role: "maintenance" }),
      }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: previewAs("member_staff"),
    });
    expect(auth.forbidden).toBeNull();
    expect(auth.preview).toMatchObject({ memberId: "member_staff", role: "maintenance" });
    expect(auth.permissions).toContain("maintenance.manage");
    expect(auth.permissions).not.toContain("payments.record");
  });

  it("denies EVERY mutation in preview mode, even ones the target could perform", async () => {
    const gate = await requireRentalPermission({
      authenticated: authenticated(stubClient({
        membership: null,
        target: member({ id: "member_staff", role: "bookkeeper" }),
      })),
      request: previewAs("member_staff"),
      permission: "payments.record", // the bookkeeper target holds this
    });
    expect(gate.response.status).toBe(403);
    const body = await gate.response.json();
    expect(body.error).toMatch(/read-only/i);
    expect(gate.authorization).toBeNull();
  });

  it("denies preview for an actor without team.manage", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: member({ role: "bookkeeper" }),
        target: member({ id: "member_other", role: "read_only" }),
      }),
      actorUserId: "staff_user",
      effectiveOwnerId: "owner_1",
      request: previewAs("member_other"),
    });
    expect(auth.forbidden.status).toBe(403);
    const body = await auth.forbidden.json();
    expect(body.error).toMatch(/owner or co-owner/i);
  });

  it("fails closed when the preview cookie points at a missing member", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({ membership: null, target: null }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: previewAs("member_gone"),
    });
    expect(auth.forbidden.status).toBe(403);
    const body = await auth.forbidden.json();
    expect(body.error).toMatch(/invalid or expired/i);
  });

  it("fails closed when the preview target is suspended", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: null,
        target: member({ id: "member_staff", status: "suspended" }),
      }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: previewAs("member_staff"),
    });
    expect(auth.forbidden.status).toBe(403);
  });

  it("rejects previewing a co-owner (no lateral preview)", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: null,
        target: member({ id: "member_co", role: "co_owner", member_user_id: "co_user" }),
      }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: previewAs("member_co"),
    });
    expect(auth.forbidden.status).toBe(403);
  });

  it("rejects previewing yourself", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: null,
        target: member({ id: "member_staff", role: "read_only", member_user_id: "owner_1" }),
      }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: previewAs("member_staff"),
    });
    expect(auth.forbidden.status).toBe(403);
  });

  it("treats a malformed preview cookie as no preview rather than failing closed", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({ membership: null }),
      actorUserId: "owner_1",
      effectiveOwnerId: "owner_1",
      request: { headers: { get: () => { throw new Error("bad header"); } } },
    });
    expect(auth.forbidden).toBeNull();
    expect(auth.preview).toBeNull();
  });
});

describe("preview cookie constants", () => {
  it("uses an httpOnly-safe cookie name with a 4-hour lifetime", () => {
    expect(PREVIEW_COOKIE_NAME).toBe("forge_rental_preview_as");
    expect(PREVIEW_COOKIE_MAX_AGE_SECONDS).toBe(4 * 60 * 60);
  });
});

describe("NO-GO fix 2026-10-01 (finding 2): requireTeamManager enforces role, not just the bit", () => {
  it("403s a staff member even with team.manage=true in their overrides", async () => {
    const gate = await requireTeamManager({
      authenticated: authenticated(
        stubClient({ membership: member({ role: "manager", permission_overrides: { "team.manage": true } }) }),
        "staff_user"
      ),
      request: noPreview,
    });
    expect(gate.response.status).toBe(403);
    const body = await gate.response.json();
    expect(body.error).toMatch(/owner or co-owner/i);
  });

  it("denies preview start for a staff member with team.manage=true in overrides", async () => {
    const auth = await getActorRentalAuthorization({
      supabaseClient: stubClient({
        membership: member({ role: "manager", permission_overrides: { "team.manage": true } }),
      }),
      actorUserId: "staff_user",
      effectiveOwnerId: "owner_1",
      request: { headers: { get: () => `${PREVIEW_COOKIE_NAME}=some_member_id` } },
    });
    expect(auth.forbidden).not.toBeNull();
    expect(auth.forbidden.status).toBe(403);
  });
});

describe("Layer 2 security-assurance hook (wired, activation-gated)", () => {
  it("exposes a documented, wired hook descriptor with AND semantics", async () => {
    const { SECURITY_ASSURANCE_HOOK } = await import("./teamAuthorization.js");
    expect(SECURITY_ASSURANCE_HOOK.status).toBe("wired");
    expect(SECURITY_ASSURANCE_HOOK.guardModule).toBe("@/lib/auth/requireSecurityAssurance.js");
    expect(SECURITY_ASSURANCE_HOOK.andSemantics).toBe("deny-unless-both-assurance-and-rental-checks-pass");
    expect([...SECURITY_ASSURANCE_HOOK.wirePoints]).toEqual(
      expect.arrayContaining(["requireRentalPermission", "requireTeamManager"])
    );
    expect(SECURITY_ASSURANCE_HOOK.activationGated).toBe(true);
    expect(Object.isFrozen(SECURITY_ASSURANCE_HOOK)).toBe(true);
  });

  it("L2-002 probe: behaves EXACTLY as before when no security context is supplied (inert)", async () => {
    mockRequireSecurityAssurance.mockClear();
    const result = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: null })),
      request: noPreview,
      permission: "tenants.manage",
    });
    expect(result.response).toBeNull();
    expect(result.authorization.isPrimaryOwner).toBe(true);
    expect(mockRequireSecurityAssurance).not.toHaveBeenCalled();
  });

  it("L2-002 probe: behaves EXACTLY as before when activation is off, even with a security context", async () => {
    mockRequireSecurityAssurance.mockClear();
    const result = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: null })),
      request: noPreview,
      permission: "tenants.manage",
      security: {
        supabaseAdmin: { kind: "fake-admin" },
        session: { access_token: "atk" },
        config: { enabled: false },
      },
    });
    expect(result.response).toBeNull();
    expect(result.authorization.isPrimaryOwner).toBe(true);
    expect(mockRequireSecurityAssurance).not.toHaveBeenCalled();
  });

  it("L2-002 probe: ANDs the MFA guard when activated — guard deny becomes 403", async () => {
    mockRequireSecurityAssurance.mockResolvedValueOnce({
      authorized: false, state: "CHALLENGE_REQUIRED", cohort: "required", reason: "aal1-with-factor",
    });
    const result = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: null })),
      request: noPreview,
      permission: "tenants.manage",
      security: {
        supabaseAdmin: { kind: "fake-admin" },
        session: { access_token: "atk" },
        config: { enabled: true },
      },
    });
    expect(mockRequireSecurityAssurance).toHaveBeenCalledWith(
      expect.objectContaining({ user: { id: "owner_1" }, session: { access_token: "atk" } })
    );
    expect(result.response).not.toBeNull();
    expect(result.response.status).toBe(403);
    expect(result.authorization).toBeNull();
  });

  it("L2-002 probe: AND allows when both the guard and the rental checks pass", async () => {
    mockRequireSecurityAssurance.mockResolvedValueOnce({
      authorized: true, state: "AUTHORIZED", cohort: "required", reason: "aal2",
    });
    const result = await requireTeamManager({
      authenticated: authenticated(stubClient({ membership: null })),
      request: noPreview,
      security: {
        supabaseAdmin: { kind: "fake-admin" },
        session: { access_token: "atk" },
        config: { enabled: true },
      },
    });
    expect(result.response).toBeNull();
    expect(result.authorization.isPrimaryOwner).toBe(true);
  });

  it("L2-002 probe: rental deny still wins even when the guard would authorize", async () => {
    mockRequireSecurityAssurance.mockClear();
    const result = await requireRentalPermission({
      authenticated: authenticated(stubClient({ membership: member({ role: "bookkeeper" }) }), "staff_user"),
      request: noPreview,
      permission: "team.manage",
      security: {
        supabaseAdmin: { kind: "fake-admin" },
        session: { access_token: "atk" },
        config: { enabled: true },
      },
    });
    // Rental permission check fails first: the guard is never consulted.
    expect(result.response).not.toBeNull();
    expect(result.response.status).toBe(403);
    expect(mockRequireSecurityAssurance).not.toHaveBeenCalled();
  });

  it("L2-002 probe: fail-closed on a misconfigured security context under activation", async () => {
    const result = await requireTeamManager({
      authenticated: authenticated(stubClient({ membership: null })),
      request: noPreview,
      security: { supabaseAdmin: { kind: "fake" }, session: null, config: { enabled: true } },
    });
    expect(result.response).not.toBeNull();
    expect(result.response.status).toBe(403);
    expect(result.authorization).toBeNull();
  });
});
