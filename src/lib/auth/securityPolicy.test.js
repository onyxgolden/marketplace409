import { describe, expect, it, vi } from "vitest";

import {
  ACTIVATION_CONFIG,
  COHORT_OPTIONAL,
  COHORT_REQUIRED,
  COHORT_UNKNOWN,
  MFA_STATES,
  isMfaLayer2Activated,
  isValidMfaTransition,
  resolveActorEligibility,
} from "./securityPolicy.js";

// PostgREST-style query builder mock: from().select().eq()[.limit()] resolves a result.
// Mirrors the ACTUAL deployed schema columns (member_user_id, owner_id, auth_user_id).
// The two workspace_members queries are distinguished by their eq() column:
// member_user_id -> the user's memberships; owner_id -> ownership existence.
function mockAdmin({ memberships = [], ownedWorkspaces = [], tenants = [], borrowers = [], error = null, malformed = null } = {}) {
  const buildResult = (table, col) => {
    if (error) return { data: null, error };
    const key = col ? `${table}:${col}` : table;
    if (malformed === table || malformed === key) return { data: { not: "an-array" }, error: null };
    const data =
      table === "workspace_members"
        ? col === "owner_id"
          ? ownedWorkspaces
          : memberships
        : table === "rental_tenants"
          ? tenants
          : borrowers;
    return { data, error: null };
  };
  return {
    from: vi.fn((table) => ({
      select: vi.fn(() => {
        const state = { col: null };
        // Deferred to a microtask so the synchronous eq() call below has
        // already recorded its column before the result is built.
        const p = Promise.resolve().then(() => buildResult(table, state.col));
        p.limit = vi.fn(() => p);
        return {
          eq: vi.fn((col) => {
            if (state.col === null) state.col = col;
            return p;
          }),
        };
      }),
    })),
  };
}

describe("MFA_STATES", () => {
  it("exposes the five required states", () => {
    expect(MFA_STATES).toEqual({
      FIRST_FACTOR: "FIRST_FACTOR",
      ENROLL_REQUIRED: "ENROLL_REQUIRED",
      CHALLENGE_REQUIRED: "CHALLENGE_REQUIRED",
      AUTHORIZED: "AUTHORIZED",
      RECOVERY_PENDING: "RECOVERY_PENDING",
    });
    expect(Object.isFrozen(MFA_STATES)).toBe(true);
  });
});

describe("isValidMfaTransition", () => {
  it("accepts the enrollment and challenge happy paths", () => {
    expect(isValidMfaTransition("FIRST_FACTOR", "ENROLL_REQUIRED")).toBe(true);
    expect(isValidMfaTransition("FIRST_FACTOR", "CHALLENGE_REQUIRED")).toBe(true);
    expect(isValidMfaTransition("ENROLL_REQUIRED", "AUTHORIZED")).toBe(true);
    expect(isValidMfaTransition("CHALLENGE_REQUIRED", "AUTHORIZED")).toBe(true);
  });

  it("accepts the recovery path into RECOVERY_PENDING and back out", () => {
    expect(isValidMfaTransition("CHALLENGE_REQUIRED", "RECOVERY_PENDING")).toBe(true);
    expect(isValidMfaTransition("AUTHORIZED", "RECOVERY_PENDING")).toBe(true);
    expect(isValidMfaTransition("RECOVERY_PENDING", "ENROLL_REQUIRED")).toBe(true);
  });

  it("rejects skipped or reversed transitions", () => {
    expect(isValidMfaTransition("FIRST_FACTOR", "RECOVERY_PENDING")).toBe(false);
    expect(isValidMfaTransition("ENROLL_REQUIRED", "RECOVERY_PENDING")).toBe(false);
    expect(isValidMfaTransition("RECOVERY_PENDING", "AUTHORIZED")).toBe(false);
    expect(isValidMfaTransition("AUTHORIZED", "ENROLL_REQUIRED")).toBe(false);
    expect(isValidMfaTransition("NOPE", "AUTHORIZED")).toBe(false);
    expect(isValidMfaTransition("AUTHORIZED", "NOPE")).toBe(false);
  });
});

describe("ACTIVATION_CONFIG", () => {
  it("is disabled by default and frozen", () => {
    expect(ACTIVATION_CONFIG.enabled).toBe(false);
    expect(isMfaLayer2Activated()).toBe(false);
    expect(isMfaLayer2Activated({ enabled: true })).toBe(true);
  });
});

describe("resolveActorEligibility", () => {
  it("classifies an active membership (any role) as required", async () => {
    const admin = mockAdmin({
      memberships: [{ owner_id: "owner-1", role: "owner", status: "active" }],
    });
    const result = await resolveActorEligibility(admin, "user-1");
    expect(result.cohort).toBe(COHORT_REQUIRED);
    expect(result.workspaceIds).toEqual(["owner-1"]);
    expect(result.memberships).toHaveLength(1);
  });

  it("classifies active staff — including restricted/read-only — as required", async () => {
    const admin = mockAdmin({
      memberships: [{ owner_id: "owner-2", role: "read_only", status: "active" }],
    });
    const result = await resolveActorEligibility(admin, "user-2");
    expect(result.cohort).toBe(COHORT_REQUIRED);
  });

  it("does NOT count inactive memberships: suspended staff with no ownership/link is UNKNOWN (never classified by absence)", async () => {
    const admin = mockAdmin({
      memberships: [{ owner_id: "owner-3", role: "staff", status: "suspended" }],
    });
    const result = await resolveActorEligibility(admin, "user-3");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
    expect(result.memberships).toHaveLength(0);
  });

  it("classifies a linked tenant (no membership) as optional", async () => {
    const admin = mockAdmin({ memberships: [], tenants: [{ id: "t-1" }], borrowers: [] });
    const result = await resolveActorEligibility(admin, "tenant-user");
    expect(result.cohort).toBe(COHORT_OPTIONAL);
    expect(result.workspaceIds).toEqual([]);
    expect(result.memberships).toEqual([]);
  });

  it("classifies a linked borrower (no membership) as optional", async () => {
    const admin = mockAdmin({ memberships: [], tenants: [], borrowers: [{ id: "b-1" }] });
    const result = await resolveActorEligibility(admin, "borrower-user");
    expect(result.cohort).toBe(COHORT_OPTIONAL);
  });

  it("L2-001 probe: membership wins over a tenant link (required, never optional)", async () => {
    const admin = mockAdmin({
      memberships: [{ owner_id: "owner-4", role: "manager", status: "active" }],
      tenants: [{ id: "t-2" }],
    });
    const result = await resolveActorEligibility(admin, "user-4");
    expect(result.cohort).toBe(COHORT_REQUIRED);
  });

  it("L2-001 probe: a canonical owner (owner_id row) linked as a tenant is REQUIRED — ownership takes precedence over the consumer link", async () => {
    const admin = mockAdmin({
      memberships: [],
      ownedWorkspaces: [{ id: "wm-1" }],
      tenants: [{ id: "t-3" }],
    });
    const result = await resolveActorEligibility(admin, "owner-user");
    expect(result.cohort).toBe(COHORT_REQUIRED);
    expect(result.workspaceIds).toEqual(["owner-user"]);
  });

  it("L2-001 probe: ownership evidence alone (no membership row) is REQUIRED", async () => {
    const admin = mockAdmin({
      memberships: [],
      ownedWorkspaces: [{ id: "wm-2" }],
      tenants: [],
      borrowers: [],
    });
    const result = await resolveActorEligibility(admin, "owner-user-2");
    expect(result.cohort).toBe(COHORT_REQUIRED);
  });

  it("L2-001 probe: an ordinary unlinked consumer (no rows at all) is UNKNOWN — never classified by absence", async () => {
    const admin = mockAdmin({ memberships: [], ownedWorkspaces: [], tenants: [], borrowers: [] });
    const result = await resolveActorEligibility(admin, "consumer-user");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
    expect(result.workspaceIds).toEqual([]);
  });

  it("returns unknown on query failure (never assumes exemption)", async () => {
    const admin = mockAdmin({ error: new Error("db down") });
    const result = await resolveActorEligibility(admin, "user-4");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
    expect(result.workspaceIds).toEqual([]);
  });

  it("L2-001 probe: a malformed ownership result is UNKNOWN, not optional", async () => {
    const admin = mockAdmin({ memberships: [], malformed: "workspace_members:owner_id" });
    const result = await resolveActorEligibility(admin, "user-6");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
  });

  it("L2-001 probe: a malformed successful result is UNKNOWN, not optional", async () => {
    const admin = mockAdmin({ memberships: [], malformed: "workspace_members" });
    const result = await resolveActorEligibility(admin, "user-5");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
  });

  it("returns unknown for a missing user id", async () => {
    const admin = mockAdmin();
    expect((await resolveActorEligibility(admin, "")).cohort).toBe(COHORT_UNKNOWN);
    expect((await resolveActorEligibility(admin, null)).cohort).toBe(COHORT_UNKNOWN);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("queries the deployed tables (workspace_members twice: memberships + ownership, rental_tenants, private_financing_borrowers)", async () => {
    const admin = mockAdmin();
    await resolveActorEligibility(admin, "user-5");
    const tables = admin.from.mock.calls.map((c) => c[0]).sort();
    expect(tables).toEqual([
      "private_financing_borrowers",
      "rental_tenants",
      "workspace_members",
      "workspace_members",
    ]);
  });
});
