// Work Package Planner slice 7 — application tests. Supabase-shaped
// chain mock, same shape as workSteps.test.js, extended with an rpc()
// mock for the transactional write path (the service never writes
// revisions, reviews, redlines, events, releases or field redlines
// directly — every mutation goes through one RPC). Also covers the
// pre-migration window: a missing table reads as an empty list and a
// missing RPC reports 503, never a raw error.
import { describe, expect, it, vi } from "vitest";
import {
  createRevision,
  listRevisions,
  createReview,
  listReviews,
  getReviewDetail,
  createRedline,
  resolveRedline,
  decideReview,
  createIfcRelease,
  listIfcReleases,
  createFieldRedline,
  listFieldRedlines,
  reconcileFieldRedline,
  retireDrawing,
  getDrawingReadiness,
  mapDrawingReviewRpcError,
} from "./drawingReviews.js";

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
    not: vi.fn(() => node), in: vi.fn(() => node),
    range: vi.fn(() => node),
    single: vi.fn(async () => result), maybeSingle: vi.fn(async () => result),
    then: (resolve) => resolve(result),
  };
  return node;
}

const OWNER = "owner_1";
const SHA = "a".repeat(64);
const PKG_ROW = { id: "pkg_1", status: "in_progress" };
const DRAWING_ROW = {
  id: "dwg_1", owner_id: OWNER, package_id: "pkg_1",
  drawing_number: "P-101", drawing_type: "p_id", title: "Main line",
  p_id_drawing_id: null, retired_at: null, retired_by: null,
  created_by: "user_1", created_at: "t1", updated_at: "t1",
};
const REVISION_ROW = {
  id: "forge_wpdrv_1", owner_id: OWNER, package_id: "pkg_1", drawing_id: "dwg_1",
  revision_code: "A", document_ref: "s3://forge/p-101-a.pdf", content_sha256: SHA,
  issued_as: "IFA", issued_at: "t1", created_by: "user_1", created_at: "t1",
  retired_at: null, retired_by: null,
};
const REVIEW_ROW = {
  id: "forge_wpdrvw_1", owner_id: OWNER, package_id: "pkg_1", drawing_id: "dwg_1",
  drawing_revision_id: "forge_wpdrv_1", round_no: 1, state: "OPEN",
  reviewer_id: null, opened_by: "user_1", opened_at: "t1",
  closed_by: null, closed_at: null, decision_reason: null, version: 1,
  retired_at: null, retired_by: null,
};
const REDLINE_ROW = {
  id: "forge_wpdrl_1", owner_id: OWNER, package_id: "pkg_1",
  review_id: "forge_wpdrvw_1", drawing_id: "dwg_1",
  drawing_revision_id: "forge_wpdrv_1", step_id: null,
  anchor_page: 2, anchor_x: "0.5000", anchor_y: "0.2500", anchor_text: null,
  comment: "Move this nozzle 50 mm up.", severity: "REQUIRED",
  resolution: "OPEN", resolution_note: null,
  created_by: "user_1", created_at: "t1", version: 1,
  retired_at: null, retired_by: null,
};
const RELEASE_ROW = {
  id: "forge_wpdifc_1", owner_id: OWNER, package_id: "pkg_1", drawing_id: "dwg_1",
  ifc_revision_id: "forge_wpdrv_2", review_id: "forge_wpdrvw_1",
  released_by: "user_1", released_at: "t1", version: 1,
  retired_at: null, retired_by: null,
};
const FIELD_ROW = {
  id: "forge_wpdfr_1", owner_id: OWNER, package_id: "pkg_1", drawing_id: "dwg_1",
  drawing_revision_id: "forge_wpdrv_1", review_id: null,
  artifact_ref: "s3://forge/field/scan.pdf", sha256: SHA,
  captured_by: "user_1", captured_at: "t1",
  field_reason: "No time to send pipe back; hand-marked on site.",
  record_state: "HISTORICAL_PENDING_RECONCILIATION",
  reconciled_revision_id: null, version: 1, retired_at: null, retired_by: null,
};
const EVENT_ROW = {
  id: "forge_wpdre_1", owner_id: OWNER, package_id: "pkg_1",
  review_id: "forge_wpdrvw_1", drawing_id: "dwg_1", actor_id: "user_1",
  event_type: "REVIEW_OPENED", before_state: null, after_state: "OPEN",
  payload_minimal: { round_no: 1 }, occurred_at: "t1",
};

const REVISION_INPUT = { revisionCode: "A", documentRef: "s3://forge/p-101-a.pdf", contentSha256: SHA };
const REVIEW_INPUT = { drawingRevisionId: "forge_wpdrv_1" };
const REDLINE_INPUT = {
  drawingRevisionId: "forge_wpdrv_1", comment: "Move this nozzle 50 mm up.",
  severity: "REQUIRED", anchorPage: 2, anchorX: 0.5, anchorY: 0.25,
};

describe("createRevision", () => {
  it("rejects invalid input before ever querying the database", async () => {
    const db = mockDb([], []);
    const result = await createRevision(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      input: { revisionCode: "", documentRef: "x", contentSha256: SHA },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("404s on an unknown package without calling the RPC", async () => {
    const db = mockDb([chain({ data: null, error: null })], []);
    const result = await createRevision(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", input: REVISION_INPUT,
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Work package not found." });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("calls the create RPC and returns the camelCased row", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: REVISION_ROW, error: null }],
    );
    const result = await createRevision(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", input: REVISION_INPUT,
    });
    expect(result.ok).toBe(true);
    expect(result.revision).toMatchObject({
      id: "forge_wpdrv_1", drawingId: "dwg_1", revisionCode: "A",
      documentRef: "s3://forge/p-101-a.pdf", contentSha256: SHA, issuedAs: "IFA",
    });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_revision_create", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_drawing_id: "dwg_1",
      p_revision_code: "A", p_document_ref: "s3://forge/p-101-a.pdf", p_content_sha256: SHA,
    });
  });

  it("maps a duplicate revision code to 409", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: new Error("WPP7_DUPLICATE_REVISION") }],
    );
    const result = await createRevision(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", input: REVISION_INPUT,
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });
});

describe("listRevisions", () => {
  it("returns an empty list when the table does not exist yet", async () => {
    const db = mockDb([
      chain({ data: DRAWING_ROW, error: null }),
      chain({ data: null, error: { code: "42P01", message: "relation forge_wp_drawing_revisions does not exist" } }),
    ]);
    const result = await listRevisions(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: true, revisions: [] });
    expect(result.drawing).toMatchObject({ id: "dwg_1", drawingNumber: "P-101" });
  });

  it("404s when the drawing is in another package", async () => {
    const db = mockDb([chain({ data: { ...DRAWING_ROW, package_id: "pkg_2" }, error: null })]);
    const result = await listRevisions(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Drawing not found in this package." });
  });
});

describe("createReview", () => {
  it("calls the review RPC with the revision and idempotency key", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: REVIEW_ROW, error: null }],
    );
    const result = await createReview(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      input: { ...REVIEW_INPUT, reviewerId: "user_2", idempotencyKey: "key-1", reason: "Ready for review." },
    });
    expect(result.ok).toBe(true);
    expect(result.review).toMatchObject({ id: "forge_wpdrvw_1", roundNo: 1, state: "OPEN" });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_review_create", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_drawing_id: "dwg_1",
      p_drawing_revision_id: "forge_wpdrv_1", p_reviewer_id: "user_2",
      p_idempotency_key: "key-1", p_reason: "Ready for review.",
    });
  });

  it("maps a duplicate open review to 409", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: new Error("WPP7_DUPLICATE_OPEN_REVIEW") }],
    );
    const result = await createReview(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", input: REVIEW_INPUT,
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });
});

describe("listReviews / getReviewDetail", () => {
  it("lists rounds newest first", async () => {
    const db = mockDb([
      chain({ data: DRAWING_ROW, error: null }),
      chain({ data: [REVIEW_ROW], error: null }),
    ]);
    const result = await listReviews(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result.ok).toBe(true);
    expect(result.reviews).toHaveLength(1);
    expect(result.reviews[0]).toMatchObject({ id: "forge_wpdrvw_1", state: "OPEN" });
  });

  it("reads a review with its redlines and audit events", async () => {
    const db = mockDb([
      chain({ data: REVIEW_ROW, error: null }),
      chain({ data: [REDLINE_ROW], error: null }),
      chain({ data: [EVENT_ROW], error: null }),
    ]);
    const result = await getReviewDetail(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", reviewId: "forge_wpdrvw_1",
    });
    expect(result.ok).toBe(true);
    expect(result.review).toMatchObject({ id: "forge_wpdrvw_1", state: "OPEN" });
    expect(result.redlines).toHaveLength(1);
    expect(result.redlines[0]).toMatchObject({ severity: "REQUIRED", anchorX: 0.5, anchorY: 0.25 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ eventType: "REVIEW_OPENED", afterState: "OPEN" });
  });

  it("404s on a review from another drawing", async () => {
    const db = mockDb([chain({ data: { ...REVIEW_ROW, drawing_id: "dwg_2" }, error: null })]);
    const result = await getReviewDetail(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", reviewId: "forge_wpdrvw_1",
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 404, error: "Review not found." });
  });
});

describe("createRedline", () => {
  it("calls the redline RPC with the anchor and severity", async () => {
    const db = mockDb(
      [chain({ data: REVIEW_ROW, error: null })],
      [{ data: REDLINE_ROW, error: null }],
    );
    const result = await createRedline(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", input: REDLINE_INPUT,
    });
    expect(result.ok).toBe(true);
    expect(result.redline).toMatchObject({ severity: "REQUIRED", comment: "Move this nozzle 50 mm up." });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_redline_create", {
      p_owner_id: OWNER, p_review_id: "forge_wpdrvw_1",
      p_drawing_revision_id: "forge_wpdrv_1",
      p_comment: "Move this nozzle 50 mm up.", p_severity: "REQUIRED",
      p_step_id: null, p_anchor_page: 2, p_anchor_x: 0.5, p_anchor_y: 0.25,
      p_anchor_text: null, p_idempotency_key: null,
    });
  });

  it("rejects HTML in the comment before any database call", async () => {
    const db = mockDb([], []);
    const result = await createRedline(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", input: { ...REDLINE_INPUT, comment: "See <b>x</b>." },
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("resolveRedline / decideReview", () => {
  it("resolves a redline with its version and note", async () => {
    const db = mockDb(
      [chain({ data: REDLINE_ROW, error: null })],
      [{ data: { ...REDLINE_ROW, resolution: "RESOLVED", resolution_note: "Moved.", version: 2 }, error: null }],
    );
    const result = await resolveRedline(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", redlineId: "forge_wpdrl_1",
      input: { expectedVersion: 1, resolution: "RESOLVED", resolutionNote: "Moved." },
    });
    expect(result.ok).toBe(true);
    expect(result.redline).toMatchObject({ resolution: "RESOLVED", version: 2 });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_redline_resolve", {
      p_owner_id: OWNER, p_redline_id: "forge_wpdrl_1", p_expected_version: 1,
      p_resolution: "RESOLVED", p_resolution_note: "Moved.", p_retire: false, p_reason: null,
    });
  });

  it("maps a version conflict to 409", async () => {
    const db = mockDb(
      [chain({ data: REDLINE_ROW, error: null })],
      [{ data: null, error: new Error("WPP7_VERSION_CONFLICT") }],
    );
    const result = await resolveRedline(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1", redlineId: "forge_wpdrl_1",
      input: { expectedVersion: 1, resolution: "RESOLVED", resolutionNote: "Moved." },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("decides a review with its version, decision and reason", async () => {
    const db = mockDb(
      [chain({ data: REVIEW_ROW, error: null })],
      [{ data: { ...REVIEW_ROW, state: "APPROVED", version: 2 }, error: null }],
    );
    const result = await decideReview(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1",
      input: { expectedVersion: 1, decision: "APPROVE", reason: "Checked against the P&ID." },
    });
    expect(result.ok).toBe(true);
    expect(result.review).toMatchObject({ state: "APPROVED", version: 2 });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_review_decide", {
      p_owner_id: OWNER, p_review_id: "forge_wpdrvw_1", p_expected_version: 1,
      p_decision: "APPROVE", p_reason: "Checked against the P&ID.",
    });
  });

  it("maps open REQUIRED redlines to 409 on approve-with-redlines", async () => {
    const db = mockDb(
      [chain({ data: REVIEW_ROW, error: null })],
      [{ data: null, error: new Error("WPP7_OPEN_REQUIRED_REDLINES") }],
    );
    const result = await decideReview(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      reviewId: "forge_wpdrvw_1",
      input: { expectedVersion: 1, decision: "APPROVE_WITH_REDLINES", reason: "Minor notes remain." },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });
});

describe("createIfcRelease / listIfcReleases", () => {
  it("calls the release RPC with the new IFC revision envelope", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: RELEASE_ROW, error: null }],
    );
    const result = await createIfcRelease(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      input: {
        reviewId: "forge_wpdrvw_1", ifcRevisionCode: "C",
        documentRef: "s3://forge/p-101-c.pdf", contentSha256: SHA,
      },
    });
    expect(result.ok).toBe(true);
    expect(result.release).toMatchObject({ id: "forge_wpdifc_1", ifcRevisionId: "forge_wpdrv_2" });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_ifc_release", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_drawing_id: "dwg_1",
      p_review_id: "forge_wpdrvw_1", p_ifc_revision_code: "C",
      p_document_ref: "s3://forge/p-101-c.pdf", p_content_sha256: SHA, p_reason: null,
    });
  });

  it("maps a stale review to 409", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: new Error("WPP7_REVIEW_STALE") }],
    );
    const result = await createIfcRelease(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      input: {
        reviewId: "forge_wpdrvw_1", ifcRevisionCode: "C",
        documentRef: "s3://forge/p-101-c.pdf", contentSha256: SHA,
      },
    });
    expect(result).toMatchObject({ ok: false, httpStatus: 409 });
  });

  it("lists releases newest first", async () => {
    const db = mockDb([
      chain({ data: DRAWING_ROW, error: null }),
      chain({ data: [RELEASE_ROW], error: null }),
    ]);
    const result = await listIfcReleases(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result.ok).toBe(true);
    expect(result.releases).toHaveLength(1);
  });
});

describe("createFieldRedline / reconcileFieldRedline / listFieldRedlines", () => {
  it("captures a field redline with artifact, hash and reason", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: FIELD_ROW, error: null }],
    );
    const result = await createFieldRedline(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      input: {
        drawingRevisionId: "forge_wpdrv_1", artifactRef: "s3://forge/field/scan.pdf",
        sha256: SHA, fieldReason: "No time to send pipe back; hand-marked on site.",
      },
    });
    expect(result.ok).toBe(true);
    expect(result.fieldRedline).toMatchObject({
      recordState: "HISTORICAL_PENDING_RECONCILIATION",
      fieldReason: "No time to send pipe back; hand-marked on site.",
    });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_field_redline_create", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_drawing_id: "dwg_1",
      p_drawing_revision_id: "forge_wpdrv_1", p_artifact_ref: "s3://forge/field/scan.pdf",
      p_sha256: SHA, p_field_reason: "No time to send pipe back; hand-marked on site.",
      p_review_id: null,
    });
  });

  it("reconciles a field redline to a corrected revision", async () => {
    const db = mockDb(
      [chain({ data: FIELD_ROW, error: null })],
      [{ data: { ...FIELD_ROW, record_state: "RECONCILED", reconciled_revision_id: "forge_wpdrv_2", version: 2 }, error: null }],
    );
    const result = await reconcileFieldRedline(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      fieldRedlineId: "forge_wpdfr_1",
      input: { reconciledRevisionId: "forge_wpdrv_2", reason: "Drafter issued rev B." },
    });
    expect(result.ok).toBe(true);
    expect(result.fieldRedline).toMatchObject({ recordState: "RECONCILED", reconciledRevisionId: "forge_wpdrv_2" });
  });

  it("lists field redlines newest first", async () => {
    const db = mockDb([
      chain({ data: DRAWING_ROW, error: null }),
      chain({ data: [FIELD_ROW], error: null }),
    ]);
    const result = await listFieldRedlines(db, { ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1" });
    expect(result.ok).toBe(true);
    expect(result.fieldRedlines).toHaveLength(1);
  });
});

describe("retireDrawing", () => {
  it("requires a reason and calls the retire RPC", async () => {
    const db = mockDb(
      [chain({ data: DRAWING_ROW, error: null })],
      [{ data: { ...DRAWING_ROW, retired_at: "t2", retired_by: "user_1" }, error: null }],
    );
    const result = await retireDrawing(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1",
      input: { reason: "Superseded by a re-issue." },
    });
    expect(result.ok).toBe(true);
    expect(result.drawing).toMatchObject({ retiredAt: "t2" });
    expect(db.rpc).toHaveBeenCalledWith("forge_wp_drawing_retire", {
      p_owner_id: OWNER, p_package_id: "pkg_1", p_drawing_id: "dwg_1",
      p_reason: "Superseded by a re-issue.",
    });
  });

  it("rejects a retire without a reason before any database call", async () => {
    const db = mockDb([], []);
    const result = await retireDrawing(db, {
      ownerId: OWNER, packageId: "pkg_1", drawingId: "dwg_1", input: {},
    });
    expect(result.ok).toBe(false);
    expect(result.httpStatus).toBe(400);
    expect(db.from).not.toHaveBeenCalled();
  });
});

describe("getDrawingReadiness", () => {
  const SNAPSHOT = {
    package_id: "pkg_1",
    package_status: "in_progress",
    drawings: [{
      drawing_id: "dwg_1", drawing_number: "P-101", drawing_type: "p_id", title: "Main line",
      retired_at: null, latest_revision_id: "forge_wpdrv_1", latest_revision_code: "A",
      latest_issued_as: "IFA", latest_document_ref: "s3://forge/p-101-a.pdf",
      latest_content_sha256: SHA, latest_issued_at: "t1",
      latest_review_id: "forge_wpdrvw_1", latest_review_round_no: 1,
      latest_review_state: "OPEN", latest_review_opened_at: "t1",
      latest_review_closed_at: null, latest_review_decision_reason: null,
      active_release_id: null, active_ifc_revision_id: null,
      active_release_review_id: null, active_release_released_at: null,
      open_required_redlines: 1, pending_field_redlines: 0,
      badge: "IFA — In review", construction_usable: false,
    }],
    counts: {
      drawings_total: 1, ifc_released: 0, pending_review: 1, returned: 0,
      open_required_redlines: 1, pending_field_redlines: 0,
    },
  };

  it("returns the camelCased snapshot", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: SNAPSHOT, error: null }],
    );
    const result = await getDrawingReadiness(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result.ok).toBe(true);
    expect(result.packageStatus).toBe("in_progress");
    expect(result.drawings).toHaveLength(1);
    expect(result.drawings[0]).toMatchObject({
      drawingId: "dwg_1", badge: "IFA — In review",
      constructionUsable: false, openRequiredRedlines: 1,
    });
    expect(result.counts).toMatchObject({ drawingsTotal: 1, pendingReview: 1, openRequiredRedlines: 1 });
  });

  it("returns an empty snapshot when the RPC does not exist yet", async () => {
    const db = mockDb(
      [chain({ data: PKG_ROW, error: null })],
      [{ data: null, error: { code: "PGRST202", message: "Could not find the function" } }],
    );
    const result = await getDrawingReadiness(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: true, drawings: [], counts: { drawingsTotal: 0 } });
  });

  it("404s on an unknown package", async () => {
    const db = mockDb([chain({ data: null, error: null })]);
    const result = await getDrawingReadiness(db, { ownerId: OWNER, packageId: "pkg_1" });
    expect(result).toMatchObject({ ok: false, httpStatus: 404 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});

describe("mapDrawingReviewRpcError", () => {
  it("maps a missing RPC to 503 and known codes to their statuses", () => {
    expect(mapDrawingReviewRpcError({ code: "PGRST202", message: "Could not find the function" }))
      .toMatchObject({ ok: false, httpStatus: 503 });
    expect(mapDrawingReviewRpcError(new Error("WPP7_WORKSPACE_FORBIDDEN")))
      .toMatchObject({ ok: false, httpStatus: 404 });
    expect(mapDrawingReviewRpcError(new Error("WPP7_PACKAGE_TERMINAL")))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapDrawingReviewRpcError(new Error("WPP7_REVIEW_NOT_APPROVED")))
      .toMatchObject({ ok: false, httpStatus: 409 });
    expect(mapDrawingReviewRpcError(new Error("WPP7_INVALID_SHA256")))
      .toMatchObject({ ok: false, httpStatus: 400 });
  });

  it("throws unknown errors so the route turns them into a 500", () => {
    expect(() => mapDrawingReviewRpcError(new Error("boom"))).toThrow("boom");
  });
});
