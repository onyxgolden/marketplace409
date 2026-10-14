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

// PostgREST-style query builder mock: from().select().eq() resolves a result.
function mockAdmin({ memberships = [], workspaces = [], error = null } = {}) {
  return {
    from: vi.fn((table) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() =>
          Promise.resolve(
            error
              ? { data: null, error }
              : {
                  data: table === "workspace_members" ? memberships : workspaces,
                  error: null,
                }
          )
        ),
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
  it("classifies a workspace owner as required", async () => {
    const admin = mockAdmin({
      memberships: [{ workspace_id: "ws-1", role: "owner", status: "active" }],
      workspaces: [{ id: "ws-1" }],
    });
    const result = await resolveActorEligibility(admin, "user-1");
    expect(result.cohort).toBe(COHORT_REQUIRED);
    expect(result.workspaceIds).toContain("ws-1");
    expect(result.memberships).toHaveLength(1);
  });

  it("classifies a workspace owner with NO membership row as required (owned workspaces count)", async () => {
    const admin = mockAdmin({ memberships: [], workspaces: [{ id: "ws-9" }] });
    const result = await resolveActorEligibility(admin, "user-1");
    expect(result.cohort).toBe(COHORT_REQUIRED);
    expect(result.workspaceIds).toEqual(["ws-9"]);
  });

  it("classifies active staff — including restricted/read-only — as required", async () => {
    const admin = mockAdmin({
      memberships: [{ workspace_id: "ws-2", role: "staff_readonly", status: "active" }],
      workspaces: [],
    });
    const result = await resolveActorEligibility(admin, "user-2");
    expect(result.cohort).toBe(COHORT_REQUIRED);
  });

  it("does NOT count inactive memberships toward the required cohort", async () => {
    const admin = mockAdmin({
      memberships: [{ workspace_id: "ws-3", role: "staff", status: "suspended" }],
      workspaces: [],
    });
    const result = await resolveActorEligibility(admin, "user-3");
    expect(result.cohort).toBe(COHORT_OPTIONAL);
    expect(result.memberships).toHaveLength(0);
  });

  it("classifies an ordinary consumer (no rows at all) as optional — no owner fallback", async () => {
    const admin = mockAdmin({ memberships: [], workspaces: [] });
    const result = await resolveActorEligibility(admin, "tenant-user");
    expect(result.cohort).toBe(COHORT_OPTIONAL);
    expect(result.workspaceIds).toEqual([]);
    expect(result.memberships).toEqual([]);
  });

  it("returns unknown on query failure (never assumes exemption)", async () => {
    const admin = mockAdmin({ error: new Error("db down") });
    const result = await resolveActorEligibility(admin, "user-4");
    expect(result.cohort).toBe(COHORT_UNKNOWN);
    expect(result.workspaceIds).toEqual([]);
  });

  it("returns unknown for a missing user id", async () => {
    const admin = mockAdmin();
    expect((await resolveActorEligibility(admin, "")).cohort).toBe(COHORT_UNKNOWN);
    expect((await resolveActorEligibility(admin, null)).cohort).toBe(COHORT_UNKNOWN);
    expect(admin.from).not.toHaveBeenCalled();
  });

  it("queries workspace_members and workspaces directly by user id", async () => {
    const admin = mockAdmin();
    await resolveActorEligibility(admin, "user-5");
    const tables = admin.from.mock.calls.map((c) => c[0]).sort();
    expect(tables).toEqual(["workspace_members", "workspaces"]);
  });
});
