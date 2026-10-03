import { describe, expect, it } from "vitest";
import {
  WP_STATUS, WP_PACKAGE_TYPES,
  defaultGatesFor, isTerminalStatus, findTransition, allowedTransitionsFrom,
  validateTransition, staticTransitionEdges,
  derivePercentComplete, validatePackageInput, hashScopeMembership,
  deriveCurrentBaseline,
} from "./workPackage.js";

const BASE_PKG = {
  status: WP_STATUS.DRAFT, title: "Kitchen remodel", package_type: "remodel",
  planned_start: "2026-11-01", planned_finish: "2026-11-15",
  responsible_party: { domain: "vendor", type: "contractor", id: "c1", display_name: "Acme" },
  description: "Full kitchen remodel scope.",
};

describe("defaultGatesFor", () => {
  it("gives industrial packages the full 12-gate set", () => {
    const gates = defaultGatesFor("industrial");
    expect(gates).toHaveLength(12);
    expect(gates).toContain("equipment_readiness");
    expect(gates).toContain("inspection_prerequisite");
    expect(gates).toContain("logistics");
  });
  it("keeps the novice path small", () => {
    expect(defaultGatesFor("other")).toEqual(["scope", "crew", "safety"]);
  });
  it("gives engineering a drawing-heavy set without industrial gates", () => {
    const gates = defaultGatesFor("engineering");
    expect(gates).toContain("design");
    expect(gates).not.toContain("logistics");
  });
});

describe("validateTransition", () => {
  it("allows Draft -> Planned when requirements are met", () => {
    const r = validateTransition({ ...BASE_PKG }, WP_STATUS.PLANNED);
    expect(r.ok).toBe(true);
  });
  it("rejects Draft -> Planned without a title", () => {
    const r = validateTransition({ ...BASE_PKG, title: " " }, WP_STATUS.PLANNED);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/missing/);
  });
  it("rejects an illegal jump Draft -> Ready", () => {
    const r = validateTransition({ ...BASE_PKG }, WP_STATUS.READY);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Illegal transition/);
  });
  it("allows Blocked from each blockable state and records blocked_from", () => {
    for (const from of ["draft", "planned", "readiness_review", "ready", "in_progress"]) {
      const r = validateTransition({ ...BASE_PKG, status: from }, WP_STATUS.BLOCKED,
        { blockedReason: "waiting on permit", blockedSource: "gate:permit" });
      expect(r.ok).toBe(true);
      expect(r.effects.recordBlockedFrom).toBe(from);
    }
  });
  it("rejects Blocked from Complete", () => {
    const r = validateTransition({ ...BASE_PKG, status: WP_STATUS.COMPLETE }, WP_STATUS.BLOCKED,
      { blockedReason: "x", blockedSource: "y" });
    expect(r.ok).toBe(false);
  });
  it("returns Blocked to exactly blocked_from, never forward", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.BLOCKED, blocked_from: WP_STATUS.READY };
    const back = validateTransition(pkg, WP_STATUS.READY, { blockerCleared: true });
    expect(back.ok).toBe(true);
    const forward = validateTransition(pkg, WP_STATUS.IN_PROGRESS, { blockerCleared: true });
    expect(forward.ok).toBe(false);
  });
  it("requires blocker clearance or an authorized override to leave Blocked", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.BLOCKED, blocked_from: WP_STATUS.READY };
    expect(validateTransition(pkg, WP_STATUS.READY, {}).ok).toBe(false);
    expect(validateTransition(pkg, WP_STATUS.READY, { overrideAuthorized: true }).ok).toBe(true);
  });
  it("sets actual_start on Ready -> In Progress", () => {
    const r = validateTransition({ ...BASE_PKG, status: WP_STATUS.READY }, WP_STATUS.IN_PROGRESS,
      { userConfirmedStart: true });
    expect(r.ok).toBe(true);
    expect(r.effects.setActualStart).toBe(true);
  });
  it("requires percent_complete = 100 or an explicit report for In Progress -> Complete", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.IN_PROGRESS,
      progress_basis: "quantity", planned_qty: 10, planned_unit: "each", earned_qty: 10 };
    expect(validateTransition(pkg, WP_STATUS.COMPLETE).ok).toBe(true);
    const partial = { ...pkg, earned_qty: 4 };
    expect(validateTransition(partial, WP_STATUS.COMPLETE).ok).toBe(false);
    expect(validateTransition(partial, WP_STATUS.COMPLETE, { explicitCompletionReport: true }).ok).toBe(false);
    expect(validateTransition(partial, WP_STATUS.COMPLETE,
      { explicitCompletionReport: true, completionReason: "punch list verified" }).ok).toBe(true);
  });
  it("rework clears actual_finish on Complete -> In Progress", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.COMPLETE, actual_finish: "2026-11-20" };
    const r = validateTransition(pkg, WP_STATUS.IN_PROGRESS,
      { verifier: "user_1", rejectionReason: "paint mismatch" });
    expect(r.ok).toBe(true);
    expect(r.effects.clearActualFinish).toBe(true);
  });
  it("reopens Verified/Closed only to In Progress, never to Complete", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.VERIFIED_CLOSED };
    const ctx = { reopenAuthority: true, reopenReason: "owner found defect" };
    expect(validateTransition(pkg, WP_STATUS.IN_PROGRESS, ctx).ok).toBe(true);
    expect(validateTransition(pkg, WP_STATUS.COMPLETE, ctx).ok).toBe(false);
  });
  it("reopens Cancelled only to Draft", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.CANCELLED };
    const ctx = { reopenAuthority: true, reopenReason: "reinstated" };
    expect(validateTransition(pkg, WP_STATUS.DRAFT, ctx).ok).toBe(true);
    expect(validateTransition(pkg, WP_STATUS.PLANNED, ctx).ok).toBe(false);
  });
  it("cancels from any non-terminal state with a reason", () => {
    for (const from of ["draft", "planned", "readiness_review", "ready", "in_progress", "blocked", "complete"]) {
      const r = validateTransition({ ...BASE_PKG, status: from }, WP_STATUS.CANCELLED,
        { cancelReason: "owner request" });
      expect(r.ok).toBe(true);
    }
    expect(validateTransition({ ...BASE_PKG, status: WP_STATUS.VERIFIED_CLOSED },
      WP_STATUS.CANCELLED, { cancelReason: "x" }).ok).toBe(false);
  });
  it("requires all applicable gates attested for Readiness Review -> Ready (interim rule)", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.READINESS_REVIEW, package_type: "remodel" };
    expect(validateTransition(pkg, WP_STATUS.READY, { attestedGates: ["scope", "crew"] }).ok).toBe(false);
    const all = ["scope", "crew", "safety", "design", "material", "permit", "site", "evidence"];
    expect(validateTransition(pkg, WP_STATUS.READY, { attestedGates: all }).ok).toBe(true);
  });
  it("requires a frozen baseline for industrial Planned -> Readiness Review", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.PLANNED, package_type: "industrial" };
    expect(validateTransition(pkg, WP_STATUS.READINESS_REVIEW).ok).toBe(false);
    expect(validateTransition({ ...pkg, scope_baseline_id: "forge_wsb_1" },
      WP_STATUS.READINESS_REVIEW).ok).toBe(true);
  });
  it("requires scope text for industrial packages even with a frozen baseline", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.PLANNED, package_type: "industrial",
      description: "  ", scope_baseline_id: "forge_wsb_1" };
    expect(validateTransition(pkg, WP_STATUS.READINESS_REVIEW).ok).toBe(false);
    expect(validateTransition({ ...pkg, description: "Exchanger bundle pull." },
      WP_STATUS.READINESS_REVIEW).ok).toBe(true);
  });
  it("requires a reason on an explicit completion report", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.IN_PROGRESS, progress_basis: "quantity",
      planned_qty: 10, planned_unit: "each", earned_qty: 40 };
    expect(validateTransition(pkg, WP_STATUS.COMPLETE,
      { explicitCompletionReport: true }).ok).toBe(false);
    const r = validateTransition(pkg, WP_STATUS.COMPLETE,
      { explicitCompletionReport: true, completionReason: "Field-verified complete." });
    expect(r.ok).toBe(true);
  });
  it("clears actual_finish when Cancelled reopens to Draft", () => {
    const pkg = { ...BASE_PKG, status: WP_STATUS.CANCELLED };
    const r = validateTransition(pkg, WP_STATUS.DRAFT,
      { reopenAuthority: true, reopenReason: "reinstated" });
    expect(r.ok).toBe(true);
    expect(r.effects.clearActualFinish).toBe(true);
  });
});

describe("derivePercentComplete", () => {
  it("computes quantity basis on the 0-100 scale", () => {
    expect(derivePercentComplete({ progress_basis: "quantity", planned_qty: 200,
      planned_unit: "tubes", earned_qty: 50 })).toBe(25);
  });
  it("returns null (unknown) when the denominator is missing or zero", () => {
    expect(derivePercentComplete({ progress_basis: "quantity", planned_qty: null,
      planned_unit: "tubes", earned_qty: 50 })).toBe(null);
    expect(derivePercentComplete({ progress_basis: "quantity", planned_qty: 0,
      planned_unit: "tubes", earned_qty: 0 })).toBe(null);
    expect(derivePercentComplete({ progress_basis: "manhours", planned_manhours: 100,
      earned_manhours: null })).toBe(null);
  });
  it("computes manhours basis", () => {
    expect(derivePercentComplete({ progress_basis: "manhours", planned_manhours: 80,
      earned_manhours: 80 })).toBe(100);
  });
  it("clamps to 0..100 and rounds to one decimal", () => {
    expect(derivePercentComplete({ progress_basis: "quantity", planned_qty: 3,
      planned_unit: "each", earned_qty: 1 })).toBe(33.3);
  });
  it("returns null with no basis", () => {
    expect(derivePercentComplete({})).toBe(null);
  });
});

describe("validatePackageInput", () => {
  it("accepts a valid create input", () => {
    expect(validatePackageInput({ title: "Turnover", package_type: "rental_turn" }).ok).toBe(true);
  });
  it("rejects blank title and bad enums", () => {
    const r = validatePackageInput({ title: " ", package_type: "spaceship", priority: "urgent" });
    expect(r.ok).toBe(false);
    expect(r.errors).toHaveLength(3);
  });
  it("rejects inverted planned dates", () => {
    const r = validatePackageInput({ title: "x", planned_start: "2026-12-01", planned_finish: "2026-11-01" });
    expect(r.errors.join(" ")).toMatch(/planned_finish/);
  });
  it("rejects hand-set percent_complete, status, and code", () => {
    const r = validatePackageInput({ title: "x", percent_complete: 50, status: "ready", code: "WP-1" });
    expect(r.errors).toHaveLength(3);
  });
  it("rejects earned quantities outside 0..planned", () => {
    const r = validatePackageInput({ title: "x", planned_qty: 10, earned_qty: 11 });
    expect(r.errors.join(" ")).toMatch(/earned_qty/);
  });
});

describe("scope baseline helpers", () => {
  it("detects substitution by hash, not by count", () => {
    const a = [{ key: "BUNDLE-01", description: "Pull bundle", quantity: 1, unit: "each" }];
    const b = [{ key: "BUNDLE-02", description: "Pull bundle", quantity: 1, unit: "each" }];
    expect(hashScopeMembership(a)).not.toBe(hashScopeMembership(b));
    expect(hashScopeMembership(a)).toBe(hashScopeMembership(a));
  });
  it("derives the current baseline as the chain head", () => {
    const v1 = { id: "b1", version: 1, supersedes_id: null };
    const v2 = { id: "b2", version: 2, supersedes_id: "b1" };
    expect(deriveCurrentBaseline([v1, v2]).id).toBe("b2");
    expect(deriveCurrentBaseline([v1]).id).toBe("b1");
    expect(deriveCurrentBaseline([])).toBe(null);
  });
});

describe("isTerminalStatus", () => {
  it("treats verified_closed and cancelled as terminal", () => {
    expect(isTerminalStatus(WP_STATUS.VERIFIED_CLOSED)).toBe(true);
    expect(isTerminalStatus(WP_STATUS.CANCELLED)).toBe(true);
    expect(isTerminalStatus(WP_STATUS.COMPLETE)).toBe(false);
  });
});

describe("findTransition", () => {
  it("returns null for unknown transitions", () => {
    expect(findTransition({ status: "draft" }, "verified_closed")).toBe(null);
  });
  it("exposes the package types list", () => {
    expect(WP_PACKAGE_TYPES).toContain("industrial");
  });
});

describe("allowedTransitionsFrom", () => {
  it("lists the static targets for a draft package, including cancel", () => {
    const targets = allowedTransitionsFrom({ status: WP_STATUS.DRAFT });
    expect(targets).toContain(WP_STATUS.PLANNED);
    expect(targets).toContain(WP_STATUS.BLOCKED);
    expect(targets).toContain(WP_STATUS.CANCELLED);
    expect(targets).not.toContain(WP_STATUS.VERIFIED_CLOSED);
  });
  it("returns the blocked_from state for a blocked package", () => {
    const targets = allowedTransitionsFrom({
      status: WP_STATUS.BLOCKED, blocked_from: WP_STATUS.IN_PROGRESS,
    });
    expect(targets).toContain(WP_STATUS.IN_PROGRESS);
  });
  it("offers only the audited reopen from terminal states", () => {
    expect(allowedTransitionsFrom({ status: WP_STATUS.VERIFIED_CLOSED }))
      .toEqual([WP_STATUS.IN_PROGRESS]);
    expect(allowedTransitionsFrom({ status: WP_STATUS.CANCELLED }))
      .toEqual([WP_STATUS.DRAFT]);
  });
});

describe("staticTransitionEdges (DB parity)", () => {
  // The migration seeds these exact edges into forge_work_lifecycle_transitions
  // so the RPC enforces the graph for direct callers. If this test fails,
  // the seed and the domain have drifted — update both.
  it("matches the seeded lifecycle transition table", () => {
    const edges = staticTransitionEdges().map(([f, t]) => `${f} -> ${t}`).sort();
    expect(edges).toEqual([
      "cancelled -> draft",
      "complete -> in_progress",
      "complete -> verified_closed",
      "draft -> blocked",
      "draft -> planned",
      "in_progress -> blocked",
      "in_progress -> complete",
      "planned -> blocked",
      "planned -> readiness_review",
      "readiness_review -> blocked",
      "readiness_review -> ready",
      "ready -> blocked",
      "ready -> in_progress",
      "verified_closed -> in_progress",
    ]);
  });
});
