// Tests for forge-capture-app/ui/review-core.js — the C2-P6A review panel's
// pure logic (grouping, payload construction, error categorization, highlight
// geometry). DOM-free, plain node environment.

import { describe, it, expect } from "vitest";
import {
  DISPOSITIONS,
  ReviewError,
  groupCandidatesByDisposition,
  isBlankReason,
  buildReviewActionPayload,
  buildSnapshotRequestPayload,
  categorizeError,
  describeErrorCategory,
  RequestGenerationTracker,
  buildLoadedViewState,
  boxToDisplayRect,
} from "../review-core.js";

function candidate(id, disposition, overrides = {}) {
  return {
    candidateId: id,
    detectorId: "det.ssn",
    reasonCode: "SSN_SHAPE",
    disposition,
    originalBox: [1, 2, 3, 4],
    expandedBox: [0, 1, 4, 5],
    ...overrides,
  };
}

function snapshot(overrides = {}) {
  return {
    sessionRevision: 0,
    policyVersion: "policy-v1",
    modelManifestSha256: "model-manifest-v1",
    frameId: "f1",
    frameWidth: 100,
    frameHeight: 100,
    candidates: [],
    ...overrides,
  };
}

describe("groupCandidatesByDisposition", () => {
  it("groups into all four buckets, preserving order, even when some are empty", () => {
    const c1 = candidate("c1", DISPOSITIONS.PENDING);
    const c2 = candidate("c2", DISPOSITIONS.REDACT);
    const c3 = candidate("c3", DISPOSITIONS.PENDING);
    const groups = groupCandidatesByDisposition([c1, c2, c3]);
    expect(groups.PENDING).toEqual([c1, c3]);
    expect(groups.REDACT).toEqual([c2]);
    expect(groups.MARK_NON_SENSITIVE).toEqual([]);
    expect(groups.UNKNOWN).toEqual([]);
  });

  it("sorts an unrecognized disposition into its own UNKNOWN bucket, never a real one", () => {
    const weird = candidate("c1", "DELETE_FOREVER");
    const groups = groupCandidatesByDisposition([weird]);
    expect(groups.PENDING).toEqual([]);
    expect(groups.UNKNOWN).toEqual([weird]);
  });

  it("handles an empty/undefined list without throwing, UNKNOWN always present and empty", () => {
    const empty = { PENDING: [], REDACT: [], MARK_NON_SENSITIVE: [], UNKNOWN: [] };
    expect(groupCandidatesByDisposition([])).toEqual(empty);
    expect(groupCandidatesByDisposition(undefined)).toEqual(empty);
  });
});

describe("isBlankReason", () => {
  it("rejects empty, whitespace-only, non-string, and missing reasons", () => {
    expect(isBlankReason("")).toBe(true);
    expect(isBlankReason("   ")).toBe(true);
    expect(isBlankReason(null)).toBe(true);
    expect(isBlankReason(undefined)).toBe(true);
    expect(isBlankReason(42)).toBe(true);
  });

  it("accepts a real reason", () => {
    expect(isBlankReason("verified with the customer")).toBe(false);
  });
});

describe("buildReviewActionPayload", () => {
  it("builds the exact REDACT payload with an empty reason and no confirmation fields", () => {
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "session.json", snapshot: snapshot() });
    const payload = buildReviewActionPayload({
      snapshot: view,
      candidateId: "c1",
      newDisposition: DISPOSITIONS.REDACT,
      reason: "",
      eventId: "evt-fixed-1",
      localTimestamp: "2026-11-02T00:00:00Z",
      visualReviewToken: "token-c1",
    });
    expect(payload).toEqual({
      workspaceRoot: "C:/ws",
      sessionRelativePath: "session.json",
      frameId: "f1",
      candidateId: "c1",
      newDisposition: "REDACT",
      reason: "",
      expectedSessionRevision: 0,
      expectedPolicyVersion: "policy-v1",
      expectedModelManifestSha256: "model-manifest-v1",
      eventId: "evt-fixed-1",
      localTimestamp: "2026-11-02T00:00:00Z",
      visualReviewToken: "token-c1",
    });
  });

  it("builds the exact MARK_NON_SENSITIVE payload, trimming the reason", () => {
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "session.json", snapshot: snapshot({ sessionRevision: 3 }) });
    const payload = buildReviewActionPayload({
      snapshot: view,
      candidateId: "c2",
      newDisposition: DISPOSITIONS.MARK_NON_SENSITIVE,
      reason: "  verified with the customer  ",
      eventId: "evt-fixed-2",
      localTimestamp: "2026-11-02T00:00:01Z",
      visualReviewToken: "token-c2",
    });
    expect(payload.reason).toBe("verified with the customer");
    expect(payload.expectedSessionRevision).toBe(3);
  });

  it("refuses a blank reason for MARK_NON_SENSITIVE before building any payload", () => {
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "session.json", snapshot: snapshot() });
    expect(() =>
      buildReviewActionPayload({ snapshot: view, candidateId: "c1", newDisposition: DISPOSITIONS.MARK_NON_SENSITIVE, reason: "   ", eventId: "e", localTimestamp: "t" }),
    ).toThrow(ReviewError);
  });

  it("refuses an unrecognized disposition", () => {
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "session.json", snapshot: snapshot() });
    expect(() => buildReviewActionPayload({ snapshot: view, candidateId: "c1", newDisposition: "DELETE_FOREVER", reason: "", eventId: "e", localTimestamp: "t" })).toThrow(
      ReviewError,
    );
  });

  it("refuses with no snapshot at all", () => {
    expect(() => buildReviewActionPayload({ snapshot: null, candidateId: "c1", newDisposition: DISPOSITIONS.REDACT, reason: "", eventId: "e", localTimestamp: "t" })).toThrow(
      ReviewError,
    );
  });

  it("refuses a missing visual review token before building any payload", () => {
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "session.json", snapshot: snapshot() });
    expect(() => buildReviewActionPayload({ snapshot: view, candidateId: "c1", newDisposition: DISPOSITIONS.REDACT, reason: "", eventId: "e", localTimestamp: "t" })).toThrow(
      ReviewError,
    );
    expect(() => buildReviewActionPayload({ snapshot: view, candidateId: "c1", newDisposition: DISPOSITIONS.REDACT, reason: "", eventId: "e", localTimestamp: "t", visualReviewToken: "" })).toThrow(
      ReviewError,
    );
  });

  it("uses the loaded view's own frozen context, never a later mutation of the inputs", () => {
    const mutableSnapshot = snapshot({ sessionRevision: 1 });
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "session.json", snapshot: mutableSnapshot });
    mutableSnapshot.sessionRevision = 99; // the panel's own later mutation must not leak backward.
    const payload = buildReviewActionPayload({ snapshot: view, candidateId: "c1", newDisposition: DISPOSITIONS.REDACT, reason: "", eventId: "e", localTimestamp: "t", visualReviewToken: "token-c1" });
    expect(payload.expectedSessionRevision).toBe(1);
    expect(() => {
      view.sessionRevision = 100;
    }).toThrow(); // frozen.
  });
});

describe("buildSnapshotRequestPayload", () => {
  it("builds the exact get_review_candidates payload", () => {
    expect(buildSnapshotRequestPayload({ workspaceRoot: "C:/ws", sessionRelativePath: "s.json", frameId: "f1" })).toEqual({
      workspaceRoot: "C:/ws",
      sessionRelativePath: "s.json",
      frameId: "f1",
    });
  });
});

describe("categorizeError", () => {
  const cases = [
    ["review action refused: StaleSessionRevision { expected: 1, current: 2 }", "stale-revision"],
    ["review action refused: PolicyVersionMismatch { expected: \"a\", current: \"b\" }", "stale-revision"],
    ["review action refused: MissingExplicitConfirmation", "confirmation-declined"],
    ["review action refused: MissingReason", "blank-reason"],
    ["review action refused: ProtectedCredentialNonOverridable { detector_id: \"det.payment_card\" }", "protected-credential"],
    ["review action refused: UnknownFrame { frame_id: \"f9\" }", "not-found"],
    ["no session exists yet at that path", "not-found"],
    ["no frame with id f9 in this session", "not-found"],
    ["review-limit refused: this frame has too many candidates to review here (5001, max 5000)", "review-limit"],
    ["session file is not a valid session: UnsupportedSchemaVersion", "malformed"],
    ["event id evt-1 already exists in this session's edit log", "duplicate-event"],
    ["some completely unrecognized backend text", "unknown"],
  ];
  it.each(cases)("categorizes %j as %j", (message, expected) => {
    expect(categorizeError(message)).toBe(expected);
  });

  it("never returns an empty category for null/undefined input", () => {
    expect(categorizeError(null)).toBe("unknown");
    expect(categorizeError(undefined)).toBe("unknown");
  });
});

describe("describeErrorCategory", () => {
  it("returns a fixed, non-empty label for every known category and the fallback", () => {
    for (const category of ["stale-revision", "confirmation-declined", "blank-reason", "protected-credential", "not-found", "review-limit", "malformed", "duplicate-event", "unknown", "something-made-up"]) {
      const label = describeErrorCategory(category);
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }
  });

  it("never echoes raw backend debug content back out", () => {
    const label = describeErrorCategory(categorizeError("review action refused: StaleSessionRevision { expected: 1, current: 2 }"));
    expect(label).not.toMatch(/StaleSessionRevision|expected:|current:/);
  });
});

describe("RequestGenerationTracker", () => {
  it("only the latest begun generation is current", () => {
    const tracker = new RequestGenerationTracker();
    const g1 = tracker.begin();
    expect(tracker.isCurrent(g1)).toBe(true);
    const g2 = tracker.begin();
    expect(tracker.isCurrent(g1)).toBe(false);
    expect(tracker.isCurrent(g2)).toBe(true);
  });

  it("models a deferred-response race across two sessions sharing a candidate id: an older generation's late response must not be current", () => {
    // Scope review item 2's exact scenario: two different sessions,
    // the same frame id "f1", the same candidate id "c1" in both —
    // nothing about the generation check depends on distinguishing the
    // payloads by content; it is purely "which load started most
    // recently."
    const tracker = new RequestGenerationTracker();
    const older = tracker.begin(); // load started for session X, frame f1 (has candidate c1)
    const newer = tracker.begin(); // load started for session Y, frame f1 (also has a candidate c1) — before X's slow response arrives
    const newView = buildLoadedViewState({
      workspaceRoot: "C:/ws",
      sessionRelativePath: "session-y.json",
      snapshot: snapshot({ frameId: "f1", sessionRevision: 7, candidates: [candidate("c1", DISPOSITIONS.REDACT)] }),
    });
    expect(tracker.isCurrent(newer)).toBe(true);
    // Session X's deferred response finally arrives — it must be
    // recognized as stale and never overwrite the already-loaded session
    // Y view, even though both share frame id "f1" and candidate id "c1".
    expect(tracker.isCurrent(older)).toBe(false);
    expect(newView.sessionRevision).toBe(7); // unchanged by the stale arrival.
  });
});

describe("buildLoadedViewState", () => {
  it("merges request context and snapshot into one frozen object", () => {
    const view = buildLoadedViewState({ workspaceRoot: "C:/ws", sessionRelativePath: "s.json", snapshot: snapshot({ frameId: "f2" }) });
    expect(view.workspaceRoot).toBe("C:/ws");
    expect(view.sessionRelativePath).toBe("s.json");
    expect(view.frameId).toBe("f2");
    expect(Object.isFrozen(view)).toBe(true);
  });
});

describe("boxToDisplayRect", () => {
  it("scales a box proportionally to the display size", () => {
    const rect = boxToDisplayRect([10, 20, 30, 40], 100, 200, 200, 400);
    expect(rect).toEqual({ left: 20, top: 40, width: 60, height: 80 });
  });

  it("returns null for a malformed box or a zero-dimension frame", () => {
    expect(boxToDisplayRect(null, 100, 100, 200, 200)).toBeNull();
    expect(boxToDisplayRect([0, 0, 1, 1], 0, 100, 200, 200)).toBeNull();
    expect(boxToDisplayRect([0, 0, 1, 1], 100, 0, 200, 200)).toBeNull();
  });
});
