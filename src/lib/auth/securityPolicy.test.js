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
// Mirrors the ACTUAL deployed schema columns (member_user_id, auth_user_id).
function mockAdmin({ memberships = [], tenants = [], borrowers = [], error = null, malformed = null } = {}) {
  return {
    from: vi.fn((table) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => {
          const p = Promise.resolve(
            error
              ? { data: null, error }
              : malformed === table
                ? { data: { not: "an-array" }, error: null }
                : {
                    data:
                      table === "workspace_members"
                        ? memberships
                        : table === "rental_tenants"
                          ? tenants
                          : borrowers,
                    error: null,
                  }
          );
          p.limit = vi.fn(() => p);
          return p;
        }),
      })),
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

  it("does NOT count inactive memberships, but the user is still required as primary owner", async () => {
    // Suspended staff with no tenant/borrower link: no ACTIVE membership,
    // so the primary-owner fallback applies (fail-closed direction).
    const admin = mockAdmin({
      memberships: [{ owner_id: "owner-3", role: "staff", status: "suspended" }],
    });
    const result = await resolveActorEligibility(admin, "user-3");
    expect(result.cohort).toBe(COHORT_REQUIRED);
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

  it("classifies a user with no rows at all as required (primary-owner fallback, matching the data plane)", async () => {
    const admin = mockAdmin({ memberships: [], tenants: [], borrowers: [] });
    const result = await resolveActorEligibility(admin, "owner-user");
    expect(result.cohort).toBe(COHORT_REQUIRED);
  });

  it("returns unknown on query failure (never assumes exemption)", async () => {
    const admin = mockAdmin({ error: new Error("db down") });
    const result = await resolveActorEligibility(admin, "user-4");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
    expect(result.workspaceIds).toEqual([]);
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

  it("queries the deployed tables (workspace_members, rental_tenants, private_financing_borrowers)", async () => {
    const admin = mockAdmin();
    await resolveActorEligibility(admin, "user-5");
    const tables = admin.from.mock.calls.map((c) => c[0]).sort();
    expect(tables).toEqual([
      "private_financing_borrowers",
      "rental_tenants",
      "workspace_members",
    ]);
  });
});
