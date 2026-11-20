// Field verification — application tests. Supabase-shaped chain
// mock, same shape as busts.test.js. Writes go through the SECURITY
// DEFINER RPCs only (the RPCs derive the actor from auth.uid() and
// enforce workspace access, the state machine, two-person integrity,
// terminal guards, optimistic versions, reason rules, source
// freshness, and dedup) — so these tests prove the service maps
// inputs to exactly those RPCs, never writes a table directly, never
// passes a caller-supplied actor, validates before touching the
// database, and turns every WPPFV_* failure into plain English. Also
// covers the pre-migration window and scope isolation: a
// verification from another package reads as not found.

import { describe, expect, it, vi } from "vitest";
import {
  NOT_APPLIED_ERROR,
  createFieldVerification,
  decideFieldVerification,
  getFieldVerificationDetail,
  getFieldVerificationSources,
  linkFieldVerificationTarget,
  listFieldVerificationBadges,
  listFieldVerifications,
  mapFieldVerificationRpcErrorResult,
  retireFieldVerification,
  unlinkFieldVerificationLink,
  updateFieldVerification,
} from "./fieldVerifications.js";

function mockDb(chains = [], rpcResults = []) {
  const queue = [...chains];
  const rpcQueue = [...rpcResults];
  return {
    from: vi.fn(() => {
      if (queue.length === 0) throw new Error("mockDb: from() called more times than chains queued");
      return queue.shift();
    }),
    rpc: vi.fn(async () => {
      if (rpcQueue.length === 0) throw new Error("mockDb: rpc() called more times than results queued");
      return rpcQueue.shift();
    }),
  };
}

function chain(result = { data: null, error: null }) {
  const node = {
    select: vi.fn(() => node), eq: vi.fn(() => node), order: vi.fn(() => node),
    gte: vi.fn(() => node), lte: vi.fn(() => node), is: vi.fn(() => node),
    not: vi.fn(() => node), neq: vi.fn(() => node), in: vi.fn(() => node),
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const PKG = "pkg_1";
const PKG_ROW = { id: PKG, status: "in_progress" };
const pkgChain = () => chain({ data: PKG_ROW, error: null });

const STEP_ROW = {
  id: "forge_wpfv_1", owner_id: OWNER, work_package_id: PKG,
  target_type: "WORK_STEP", step_id: "forge_step_1", takeoff_line_id: null,
  work_location: "FIELD", inspection_date: "2026-11-20",
  source_checked_at: "2026-11-20T15:00:00.000Z",
  source_step_version: 3, source_line_id: null, source_drawing_id: null,
  source_drawing_revision_id: null, scope_baseline_id: null,
  scope_baseline_version: null, source_progress_entry_ids: null,
  progress_as_of: null, source_progress_digest: null,
  source_progress_total_quantity: null,
  source_fingerprint: "a".repeat(32),
  planned_step_hours: 10, planned_line_quantity: null, unit: null,
  observed_installed_quantity: null, observed_basis: null,
  physical_completion: "PARTIALLY_COMPLETE",
  acceptance_criteria_checked: null,
  field_reported_hours: 11.5, field_hours_source: "Foreman daily log, 2026-11-20",
  observation_note: "Spool welded and aligned against IFC revision R2.",
  evidence_ref: "field-photo-2026-11-20-01.jpg", evidence_summary: null,
  status: "DRAFT", version: 1, supersedes_verification_id: null,
  submitted_by: null, submitted_at: null, reviewed_by: null,
  reviewed_at: null, review_note: null, retired_at: null,
  retired_by: null, retirement_reason: null,
  created_by: "user_9", updated_by: "user_9",
  created_at: "t0", updated_at: "t0",
};

const LINE_ROW = {
  ...STEP_ROW,
  id: "forge_wpfv_2",
  target_type: "TAKEOFF_LINE", step_id: null, takeoff_line_id: "forge_line_1",
  work_location: "SHOP", source_step_version: null, source_line_id: "forge_line_1",
  source_drawing_id: "forge_dwg_1", source_drawing_revision_id: null,
  source_progress_entry_ids: ["forge_pe_1", "forge_pe_2"],
  progress_as_of: "2026-11-20", source_progress_digest: "c".repeat(32),
  source_progress_total_quantity: 8, source_fingerprint: "b".repeat(32),
  planned_step_hours: null, planned_line_quantity: 12, unit: "EA",
  observed_installed_quantity: 9, observed_basis: "Counted on the rack",
  physical_completion: null, field_reported_hours: null,
  field_hours_source: null, status: "SUBMITTED", version: 2,
  submitted_by: "user_9", submitted_at: "t1",
};

const STEP_LABEL_ROW = { id: "forge_step_1", title: "Fabricate spool SP-101", retired_at: null };
const LINE_LABEL_ROW = { id: "forge_line_1", drawing_id: "forge_dwg_1", quantity: 12, unit: "EA" };
const DRAWING_LABEL_ROW = { id: "forge_dwg_1", drawing_number: "W-0005-1" };

describe("mapFieldVerificationRpcErrorResult", () => {
  it("maps a missing RPC to the 503 not-applied result", () => {
    const result = mapFieldVerificationRpcErrorResult({ code: "PGRST202", message: "Could not find the function" });
    expect(result).toEqual({ ok: false, httpStatus: 503, error: NOT_APPLIED_ERROR, notApplied: true });
  });

  it("maps self-review to a 409 with the two-person message", () => {
    const result = mapFieldVerificationRpcErrorResult({ message: "WPPFV_SELF_REVIEW" });
    expect(result.httpStatus).toBe(409);
    expect(result.error).toContain("different person");
  });

  it("maps a duplicate-active error to a 409 naming the existing verification", () => {
    const result = mapFieldVerificationRpcErrorResult({ message: "WPPFV_DUPLICATE_ACTIVE:forge_wpfv_abc" });
    expect(result.httpStatus).toBe(409);
    expect(result.existingVerificationId).toBe("forge_wpfv_abc");
  });

  it("maps a stale source to a 409", () => {
    const result = mapFieldVerificationRpcErrorResult({ message: "WPPFV_SOURCE_CHANGED" });
    expect(result.httpStatus).toBe(409);
    expect(result.error).toContain("changed since");
  });

  it("throws on an unknown error instead of dressing it up", () => {
    expect(() => mapFieldVerificationRpcErrorResult({ message: "boom" })).toThrow("boom");
  });
});

describe("getFieldVerificationSources", () => {
  it("returns the assembled source preview for a step", async () => {
    const db = mockDb([pkgChain()], [
      { data: {
        packageStatus: "in_progress", asOf: "2026-11-20",
        targetType: "WORK_STEP", targetId: "forge_step_1",
        targetLabel: "Fabricate spool SP-101", targetRetired: false,
        stepVersion: 3, plannedStepHours: 10,
        plannedLineQuantity: null, unit: null,
        drawingId: null, drawingNumber: null, latestRevision: null,
        progressAsOf: null, installedAsOf: null, progressEntryIds: null,
        sourceProgressDigest: null, sourceFingerprint: "a".repeat(32),
      }, error: null },
    ]);
    const result = await getFieldVerificationSources(db, {
      ownerId: OWNER, packageId: PKG, targetType: "WORK_STEP", targetId: "forge_step_1", asOf: "2026-11-20",
    });
    expect(result.ok).toBe(true);
    expect(result.sourceFingerprint).toBe("a".repeat(32));
    expect(result.plannedStepHours).toBe(10);
    expect(db.rpc).toHaveBeenCalledWith("forge_work_field_verification_sources", {
      p_owner_id: OWNER, p_package_id: PKG, p_target_type: "WORK_STEP",
      p_target_id: "forge_step_1", p_as_of: "2026-11-20",
    });
  });

  it("rejects a bad target type before touching the database", async () => {
    const db = mockDb([pkgChain()], []);
    const result = await getFieldVerificationSources(db, {
      ownerId: OWNER, packageId: PKG, targetType: "CRAFT_DAY", targetId: "x",
    });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("returns the 503 not-applied result when the RPC is missing", async () => {
    const db = mockDb([pkgChain()], [
      { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
    ]);
    const result = await getFieldVerificationSources(db, {
      ownerId: OWNER, packageId: PKG, targetType: "WORK_STEP", targetId: "forge_step_1",
    });
    expect(result.httpStatus).toBe(503);
    expect(result.notApplied).toBe(true);
  });
});

describe("listFieldVerifications", () => {
  it("returns verifications with labels, variances, source status, and summary counts", async () => {
    const db = mockDb(
      [
        pkgChain(),
        chain({ data: [STEP_ROW, LINE_ROW], error: null, count: 2 }),
        chain({ data: [STEP_LABEL_ROW], error: null }),
        chain({ data: [LINE_LABEL_ROW], error: null }),
        chain({ data: [DRAWING_LABEL_ROW], error: null }),
        chain({ data: [{ id: "forge_wpfv_1", status: "DRAFT" }, { id: "forge_wpfv_2", status: "SUBMITTED" }], error: null }),
      ],
      [{ data: { forge_wpfv_1: "CURRENT", forge_wpfv_2: "CHANGED_SINCE_REVIEW" }, error: null }],
    );
    const result = await listFieldVerifications(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(true);
    expect(result.total).toBe(2);
    expect(result.verifications[0].targetLabel).toBe("Fabricate spool SP-101");
    expect(result.verifications[0].sourceStatus).toBe("CURRENT");
    expect(result.verifications[0].hoursDifference).toEqual({ hoursVsPlan: 1.5, label: "OVER" });
    expect(result.verifications[1].targetLabel).toBe("W-0005-1 — 12 EA");
    expect(result.verifications[1].sourceStatus).toBe("CHANGED_SINCE_REVIEW");
    expect(result.verifications[1].variances).toEqual({
      varianceVsPlan: -3, varianceVsRecorded: 1, percentVsPlan: -25, percentVsRecorded: 12.5,
    });
    expect(result.summary).toMatchObject({ total: 2, draft: 1, submitted: 1, changedSinceReview: 1 });
  });

  it("returns the 503 not-applied result when the table is missing", async () => {
    const db = mockDb(
      [pkgChain(), chain({ data: null, error: { code: "42P01", message: "relation does not exist" } })],
      [],
    );
    const result = await listFieldVerifications(db, { ownerId: OWNER, packageId: PKG });
    expect(result.httpStatus).toBe(503);
    expect(result.notApplied).toBe(true);
  });
});

describe("getFieldVerificationDetail", () => {
  it("returns the verification with its history and links with human labels", async () => {
    const revisionRow = {
      id: "forge_wpfvr_1", owner_id: OWNER, verification_id: "forge_wpfv_1",
      version: 1, actor_id: "user_9", action: "create",
      old_values: null, new_values: { status: "DRAFT" }, reason: "Field verification recorded",
      recorded_at: "t0", request_id: null,
    };
    const linkRow = {
      id: "forge_wpfvl_1", owner_id: OWNER, verification_id: "forge_wpfv_1",
      work_package_id: PKG, target_kind: "BUST", bust_id: "forge_bust_1",
      change_order_id: null, progress_entry_id: null, drawing_id: null,
      created_by: "user_9", created_at: "t0", retired_at: null,
      retired_by: null, reason: null, version: 1,
    };
    const db = mockDb(
      [
        pkgChain(),
        chain({ data: STEP_ROW, error: null }),
        chain({ data: [revisionRow], error: null }),
        chain({ data: [linkRow], error: null }),
        chain({ data: [STEP_LABEL_ROW], error: null }),
        chain({ data: [{ id: "forge_bust_1", dimension: "QUANTITY", scope_type: "TAKEOFF_LINE", status: "OPEN" }], error: null }),
      ],
      [{ data: { forge_wpfv_1: "CURRENT" }, error: null }],
    );
    const result = await getFieldVerificationDetail(db, { ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1" });
    expect(result.ok).toBe(true);
    expect(result.verification.id).toBe("forge_wpfv_1");
    expect(result.revisions).toHaveLength(1);
    expect(result.revisions[0].action).toBe("create");
    expect(result.links).toHaveLength(1);
    expect(result.links[0].targetLabel).toBe("Bust — QUANTITY (OPEN)");
    expect(result.activeLinks).toHaveLength(1);
  });

  it("reads a verification from another package as not found", async () => {
    const db = mockDb(
      [pkgChain(), chain({ data: null, error: null })],
      [],
    );
    const result = await getFieldVerificationDetail(db, { ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_other" });
    expect(result.httpStatus).toBe(404);
  });
});

describe("listFieldVerificationBadges", () => {
  it("groups active verifications by step and line with their statuses", async () => {
    const db = mockDb([
      pkgChain(),
      chain({ data: [
        { id: "forge_wpfv_1", target_type: "WORK_STEP", step_id: "forge_step_1", takeoff_line_id: null, status: "DRAFT" },
        { id: "forge_wpfv_2", target_type: "TAKEOFF_LINE", step_id: null, takeoff_line_id: "forge_line_1", status: "ACCEPTED" },
        { id: "forge_wpfv_3", target_type: "TAKEOFF_LINE", step_id: null, takeoff_line_id: "forge_line_1", status: "SUBMITTED" },
      ], error: null }),
    ], []);
    const result = await listFieldVerificationBadges(db, { ownerId: OWNER, packageId: PKG });
    expect(result.ok).toBe(true);
    expect(result.byWorkStep).toEqual({ forge_step_1: { count: 1, statuses: ["DRAFT"] } });
    expect(result.byTakeoffLine).toEqual({ forge_line_1: { count: 2, statuses: ["ACCEPTED", "SUBMITTED"] } });
  });
});

describe("createFieldVerification", () => {
  const input = {
    ownerId: OWNER, packageId: PKG, targetType: "WORK_STEP", stepId: "forge_step_1",
    workLocation: "FIELD", inspectionDate: "2026-11-20",
    sourceCheckedAt: "2026-11-20T15:00:00.000Z",
    physicalCompletion: "PARTIALLY_COMPLETE",
    observationNote: "Spool welded and aligned against IFC revision R2.",
    evidenceRef: "field-photo-2026-11-20-01.jpg",
    sourceFingerprint: "a".repeat(32),
  };

  it("calls the create RPC with the exact params and no actor", async () => {
    const db = mockDb(
      [pkgChain(), chain({ data: [STEP_LABEL_ROW], error: null })],
      [{ data: STEP_ROW, error: null }],
    );
    const result = await createFieldVerification(db, input);
    expect(result.ok).toBe(true);
    expect(result.verification.id).toBe("forge_wpfv_1");
    const rpcArgs = db.rpc.mock.calls[0][1];
    expect(db.rpc).toHaveBeenCalledWith("forge_work_field_verification_create", expect.anything());
    expect(rpcArgs.p_owner_id).toBe(OWNER);
    expect(rpcArgs.p_package_id).toBe(PKG);
    expect(rpcArgs.p_target_type).toBe("WORK_STEP");
    expect(rpcArgs.p_source_fingerprint).toBe("a".repeat(32));
    expect(rpcArgs).not.toHaveProperty("p_actor_id");
    expect(rpcArgs).not.toHaveProperty("p_created_by");
    expect(typeof rpcArgs.p_request_id).toBe("string");
  });

  it("validates before touching the database", async () => {
    const db = mockDb([pkgChain()], []);
    const result = await createFieldVerification(db, { ...input, physicalCompletion: null });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("maps a stale-source failure to a 409", async () => {
    const db = mockDb(
      [pkgChain()],
      [{ data: null, error: { message: "WPPFV_SOURCE_CHANGED" } }],
    );
    const result = await createFieldVerification(db, input);
    expect(result.httpStatus).toBe(409);
  });
});

describe("updateFieldVerification", () => {
  it("calls the update RPC with set flags and a required reason", async () => {
    const db = mockDb(
      [pkgChain(), chain({ data: [STEP_LABEL_ROW], error: null })],
      [{ data: { ...STEP_ROW, version: 2, observation_note: "Corrected note." }, error: null }],
    );
    const result = await updateFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1",
      expectedVersion: 1, setObservationNote: true, observationNote: "Corrected note.",
      reason: "Typo in the note.",
    });
    expect(result.ok).toBe(true);
    const rpcArgs = db.rpc.mock.calls[0][1];
    expect(rpcArgs.p_set_observation_note).toBe(true);
    expect(rpcArgs.p_set_evidence_ref).toBe(false);
    expect(rpcArgs.p_reason).toBe("Typo in the note.");
  });

  it("refuses an update without a reason", async () => {
    const db = mockDb([pkgChain()], []);
    const result = await updateFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1",
      expectedVersion: 1, reason: "",
    });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("decideFieldVerification", () => {
  it("refuses an accept without a review statement before touching the database", async () => {
    const db = mockDb([pkgChain()], []);
    const result = await decideFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_2",
      action: "accept", expectedVersion: 2, sourceFingerprint: "b".repeat(32), reviewNote: "",
    });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the decision RPC for a submit", async () => {
    const db = mockDb(
      [pkgChain(), chain({ data: [STEP_LABEL_ROW], error: null })],
      [{ data: { ...STEP_ROW, status: "SUBMITTED", version: 2 }, error: null }],
    );
    const result = await decideFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1",
      action: "submit", expectedVersion: 1, sourceFingerprint: "a".repeat(32),
    });
    expect(result.ok).toBe(true);
    expect(result.verification.status).toBe("SUBMITTED");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_field_verification_decision", expect.objectContaining({
      p_action: "submit",
      p_source_fingerprint: "a".repeat(32),
    }));
  });

  it("maps a self-review failure to a 409", async () => {
    const db = mockDb(
      [pkgChain()],
      [{ data: null, error: { message: "WPPFV_SELF_REVIEW" } }],
    );
    const result = await decideFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_2",
      action: "accept", expectedVersion: 2, sourceFingerprint: "b".repeat(32),
      reviewNote: "Checked the welds against R2; matches.",
    });
    expect(result.httpStatus).toBe(409);
  });
});

describe("retireFieldVerification / link / unlink", () => {
  it("refuses a retire without a reason", async () => {
    const db = mockDb([pkgChain()], []);
    const result = await retireFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1", expectedVersion: 1, reason: "",
    });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the retire RPC with the reason", async () => {
    const db = mockDb(
      [pkgChain(), chain({ data: [STEP_LABEL_ROW], error: null })],
      [{ data: { ...STEP_ROW, status: "RETIRED", version: 2, retired_at: "t2" }, error: null }],
    );
    const result = await retireFieldVerification(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1",
      expectedVersion: 1, reason: "Recorded against the wrong step.",
    });
    expect(result.ok).toBe(true);
    expect(result.verification.status).toBe("RETIRED");
  });

  it("calls the link RPC for a bust link", async () => {
    const linkRow = {
      id: "forge_wpfvl_1", owner_id: OWNER, verification_id: "forge_wpfv_1",
      work_package_id: PKG, target_kind: "BUST", bust_id: "forge_bust_1",
      change_order_id: null, progress_entry_id: null, drawing_id: null,
      created_by: "user_9", created_at: "t0", retired_at: null,
      retired_by: null, reason: null, version: 1,
    };
    const db = mockDb(
      [
        pkgChain(),
        chain({ data: [{ id: "forge_bust_1", dimension: "QUANTITY", scope_type: "TAKEOFF_LINE", status: "OPEN" }], error: null }),
      ],
      [{ data: linkRow, error: null }],
    );
    const result = await linkFieldVerificationTarget(db, {
      ownerId: OWNER, packageId: PKG, verificationId: "forge_wpfv_1",
      targetKind: "BUST", targetId: "forge_bust_1",
    });
    expect(result.ok).toBe(true);
    expect(result.link.targetLabel).toBe("Bust — QUANTITY (OPEN)");
    expect(db.rpc).toHaveBeenCalledWith("forge_work_field_verification_link", expect.objectContaining({
      p_target_kind: "BUST", p_target_id: "forge_bust_1",
    }));
  });

  it("refuses an unlink without a reason", async () => {
    const db = mockDb([pkgChain()], []);
    const result = await unlinkFieldVerificationLink(db, {
      ownerId: OWNER, packageId: PKG, linkId: "forge_wpfvl_1", expectedVersion: 1, reason: "",
    });
    expect(result.httpStatus).toBe(400);
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
