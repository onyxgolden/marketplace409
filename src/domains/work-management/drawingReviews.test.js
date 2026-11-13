// Work Package Planner slice 7 — domain tests: validators, the shared
// readiness-badge derivation, and the step-view label. The badge rules
// here must agree with the migration's readiness snapshot RPC; the
// migration tests assert both on the same fixtures.
import { describe, it, expect } from "vitest";
import {
  validateRevisionInput,
  validateReviewInput,
  validateRedlineInput,
  validateRedlineResolveInput,
  validateReviewDecisionInput,
  validateIfcReleaseInput,
  validateFieldRedlineInput,
  validateFieldRedlineReconcileInput,
  validateDrawingRetireInput,
  validateControlledDrawingIntakeInput,
  validateIfcStageInput,
  validatePdfFile,
  deriveDrawingReadiness,
  stepDrawingLabel,
  preIfcTag,
} from "./drawingReviews.js";

const SHA = "a".repeat(64);
const SHA_UPPER = "A".repeat(64);

describe("validateRevisionInput", () => {
  it("accepts a plain revision code, document ref and sha", () => {
    expect(validateRevisionInput({ revisionCode: "A", documentRef: "s3://forge/drawings/p-101-a.pdf", contentSha256: SHA }).ok).toBe(true);
    expect(validateRevisionInput({ revisionCode: "IFA-2", documentRef: "lib://doc-1", contentSha256: SHA_UPPER }).ok).toBe(true);
  });

  it("rejects bad codes, refs and hashes", () => {
    expect(validateRevisionInput({ revisionCode: "", documentRef: "x", contentSha256: SHA }).ok).toBe(false);
    expect(validateRevisionInput({ revisionCode: "<A>", documentRef: "x", contentSha256: SHA }).ok).toBe(false);
    expect(validateRevisionInput({ revisionCode: "A".repeat(41), documentRef: "x", contentSha256: SHA }).ok).toBe(false);
    expect(validateRevisionInput({ revisionCode: "A", documentRef: "", contentSha256: SHA }).ok).toBe(false);
    expect(validateRevisionInput({ revisionCode: "A", documentRef: "x", contentSha256: "zz" }).ok).toBe(false);
    expect(validateRevisionInput({ revisionCode: "A", documentRef: "x", contentSha256: "a".repeat(63) }).ok).toBe(false);
  });
});

describe("validateRedlineInput", () => {
  const base = {
    reviewId: "rev_1",
    drawingRevisionId: "drv_1",
    comment: "Move this nozzle 50 mm up.",
    severity: "REQUIRED",
  };

  it("accepts a plain anchored comment", () => {
    expect(validateRedlineInput({ ...base, anchorPage: 2, anchorX: 0.5, anchorY: 0.25 }).ok).toBe(true);
    expect(validateRedlineInput({ ...base, anchorText: "nozzle N-1" }).ok).toBe(true);
    expect(validateRedlineInput(base).ok).toBe(true);
  });

  it("rejects HTML, control characters and overlong comments", () => {
    expect(validateRedlineInput({ ...base, comment: "See <b>this</b>." }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, comment: "bad\u0007char" }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, comment: "x".repeat(2001) }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, comment: "   " }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, severity: "BLOCKER" }).ok).toBe(false);
  });

  it("rejects half anchors and out-of-range coordinates", () => {
    expect(validateRedlineInput({ ...base, anchorX: 0.5 }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, anchorX: 1.5, anchorY: 0.5 }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, anchorX: -0.1, anchorY: 0.5 }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, anchorPage: 0 }).ok).toBe(false);
    expect(validateRedlineInput({ ...base, anchorText: "x".repeat(501) }).ok).toBe(false);
  });
});

describe("validateRedlineResolveInput", () => {
  it("accepts a resolution with a valid version", () => {
    expect(validateRedlineResolveInput({ expectedVersion: 2, resolution: "RESOLVED", resolutionNote: "Moved." }).ok).toBe(true);
    expect(validateRedlineResolveInput({ expectedVersion: 1, resolution: "ACCEPTED_AS_NOTED" }).ok).toBe(true);
  });

  it("accepts a retire with a reason and no resolution", () => {
    expect(validateRedlineResolveInput({ expectedVersion: 1, retire: true, reason: "Duplicate of another redline." }).ok).toBe(true);
  });

  it("rejects a retire without a reason and bad versions", () => {
    expect(validateRedlineResolveInput({ expectedVersion: 1, retire: true }).ok).toBe(false);
    expect(validateRedlineResolveInput({ expectedVersion: 0, resolution: "RESOLVED" }).ok).toBe(false);
    expect(validateRedlineResolveInput({ expectedVersion: 1, resolution: "OPEN" }).ok).toBe(false);
  });
});

describe("validateReviewDecisionInput", () => {
  it("accepts each decision with a reason", () => {
    for (const decision of ["APPROVE", "APPROVE_WITH_REDLINES", "RETURN_TO_DRAFTER"]) {
      expect(validateReviewDecisionInput({ expectedVersion: 1, decision, reason: "Checked." }).ok).toBe(true);
    }
  });

  it("rejects a missing reason and unknown decisions", () => {
    expect(validateReviewDecisionInput({ expectedVersion: 1, decision: "APPROVE" }).ok).toBe(false);
    expect(validateReviewDecisionInput({ expectedVersion: 1, decision: "APPROVE", reason: "   " }).ok).toBe(false);
    expect(validateReviewDecisionInput({ expectedVersion: 1, decision: "MAYBE", reason: "x" }).ok).toBe(false);
  });
});

describe("validateIfcReleaseInput", () => {
  it("accepts a release with a new IFC revision envelope", () => {
    expect(validateIfcReleaseInput({
      reviewId: "rev_1", ifcRevisionCode: "C", documentRef: "s3://forge/ifc.pdf", contentSha256: SHA,
    }).ok).toBe(true);
  });

  it("rejects a release with a bad revision envelope", () => {
    expect(validateIfcReleaseInput({
      reviewId: "rev_1", ifcRevisionCode: "C", documentRef: "s3://forge/ifc.pdf", contentSha256: "nope",
    }).ok).toBe(false);
    expect(validateIfcReleaseInput({
      ifcRevisionCode: "C", documentRef: "s3://forge/ifc.pdf", contentSha256: SHA,
    }).ok).toBe(false);
  });

  // Slice-7 PDF blockers: with a staged artifact the typed reference +
  // hash are not required and are ignored; the revision code still is.
  it("accepts a staged-artifact release without a typed ref or hash", () => {
    expect(validateIfcReleaseInput({
      reviewId: "rev_1", ifcRevisionCode: "C", stagedArtifactId: "forge_wpa_1",
    }).ok).toBe(true);
    expect(validateIfcReleaseInput({
      reviewId: "rev_1", ifcRevisionCode: "C", stagedArtifactId: "forge_wpa_1",
      documentRef: "anything", contentSha256: "not-a-hash",
    }).ok).toBe(true);
  });

  it("rejects a staged-artifact release with a bad revision code or no review", () => {
    expect(validateIfcReleaseInput({
      reviewId: "rev_1", ifcRevisionCode: "", stagedArtifactId: "forge_wpa_1",
    }).ok).toBe(false);
    expect(validateIfcReleaseInput({
      ifcRevisionCode: "C", stagedArtifactId: "forge_wpa_1",
    }).ok).toBe(false);
  });
});

describe("validateFieldRedlineInput / reconcile / retire", () => {
  it("accepts a field capture with artifact, hash and reason", () => {
    expect(validateFieldRedlineInput({
      drawingRevisionId: "drv_1", artifactRef: "s3://forge/field/scan.pdf",
      sha256: SHA, fieldReason: "No time to send pipe back; hand-marked on site.",
    }).ok).toBe(true);
  });

  it("rejects a field capture without a reason or with a bad hash", () => {
    expect(validateFieldRedlineInput({
      drawingRevisionId: "drv_1", artifactRef: "s3://forge/field/scan.pdf",
      sha256: SHA, fieldReason: "",
    }).ok).toBe(false);
    expect(validateFieldRedlineInput({
      drawingRevisionId: "drv_1", artifactRef: "s3://forge/field/scan.pdf",
      sha256: "x", fieldReason: "Field mark.",
    }).ok).toBe(false);
  });

  it("validates reconcile and retire inputs", () => {
    expect(validateFieldRedlineReconcileInput({ reconciledRevisionId: "drv_2" }).ok).toBe(true);
    expect(validateFieldRedlineReconcileInput({}).ok).toBe(false);
    expect(validateDrawingRetireInput({ reason: "Superseded by a re-issue." }).ok).toBe(true);
    expect(validateDrawingRetireInput({}).ok).toBe(false);
    expect(validateReviewInput({ drawingRevisionId: "drv_1" }).ok).toBe(true);
    expect(validateReviewInput({}).ok).toBe(false);
  });
});

describe("deriveDrawingReadiness", () => {
  const revision = { issuedAs: "IFA" };
  const ifcRevision = { issuedAs: "IFC" };

  it("retired beats everything", () => {
    expect(deriveDrawingReadiness({
      retiredAt: "2026-11-08T00:00:00Z", latestRevision: ifcRevision,
      latestReview: { state: "APPROVED" }, activeRelease: { id: "rel_1" },
    })).toEqual({ badge: "Retired", constructionUsable: false, preliminary: false });
  });

  it("an ACTIVE release is IFC and construction-usable", () => {
    expect(deriveDrawingReadiness({
      retiredAt: null, latestRevision: ifcRevision,
      latestReview: { state: "APPROVED" }, activeRelease: { id: "rel_1" },
    })).toEqual({ badge: "IFC — Issued for construction", constructionUsable: true, preliminary: false });
  });

  it("maps each review state to its badge, never IFC without a release", () => {
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: { state: "OPEN" }, activeRelease: null }).badge)
      .toBe("IFA — In review");
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: { state: "RETURNED" }, activeRelease: null }).badge)
      .toBe("IFA — Returned to drafter");
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: { state: "APPROVED" }, activeRelease: null }).badge)
      .toBe("IFA — Approved; IFC not issued");
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: { state: "APPROVED_WITH_REDLINES" }, activeRelease: null }).badge)
      .toBe("IFA — Approved; IFC not issued");
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: { state: "APPROVED" }, activeRelease: null }).constructionUsable)
      .toBe(false);
  });

  it("a cancelled round or no round is awaiting review; no revision is its own state", () => {
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: { state: "CANCELLED" }, activeRelease: null }))
      .toEqual({ badge: "IFA — Awaiting review", constructionUsable: false, preliminary: true });
    expect(deriveDrawingReadiness({ latestRevision: revision, latestReview: null, activeRelease: null }))
      .toEqual({ badge: "IFA — Awaiting review", constructionUsable: false, preliminary: true });
    expect(deriveDrawingReadiness({ latestRevision: null, latestReview: null, activeRelease: null }))
      .toEqual({ badge: "No issued revision", constructionUsable: false, preliminary: false });
  });

  it("a terminal package withdraws every drawing that has a revision", () => {
    // An ACTIVE release no longer authorizes construction once the
    // package is cancelled or verified closed.
    expect(deriveDrawingReadiness({
      packageStatus: "cancelled", latestRevision: ifcRevision,
      latestReview: { state: "APPROVED" }, activeRelease: { id: "rel_1" },
    })).toEqual({ badge: "Withdrawn — package cancelled", constructionUsable: false, preliminary: false });
    expect(deriveDrawingReadiness({
      packageStatus: "verified_closed", latestRevision: revision,
      latestReview: { state: "OPEN" }, activeRelease: null,
    })).toEqual({ badge: "Withdrawn — package verified closed", constructionUsable: false, preliminary: false });
    // A drawing with no revision at all keeps its own state — there
    // is nothing to withdraw.
    expect(deriveDrawingReadiness({
      packageStatus: "cancelled", latestRevision: null,
      latestReview: null, activeRelease: null,
    })).toEqual({ badge: "No issued revision", constructionUsable: false, preliminary: false });
  });

  it("retired beats a terminal package", () => {
    expect(deriveDrawingReadiness({
      retiredAt: "2026-11-08T00:00:00Z", packageStatus: "cancelled",
      latestRevision: ifcRevision, latestReview: { state: "APPROVED" },
      activeRelease: { id: "rel_1" },
    })).toEqual({ badge: "Retired", constructionUsable: false, preliminary: false });
  });
});

describe("stepDrawingLabel", () => {
  it("labels IFA preliminary, IFC construction issue, retired by name", () => {
    expect(stepDrawingLabel({ badge: "IFA — In review", constructionUsable: false, preliminary: true }))
      .toBe("Drawing: IFA — preliminary");
    expect(stepDrawingLabel({ badge: "IFC — Issued for construction", constructionUsable: true, preliminary: false }))
      .toBe("IFC — construction issue");
    expect(stepDrawingLabel({ badge: "Retired", constructionUsable: false, preliminary: false }))
      .toBe("Retired drawing");
    expect(stepDrawingLabel({ badge: "No issued revision", constructionUsable: false, preliminary: false }))
      .toBe("Drawing: no issued revision");
    expect(stepDrawingLabel(null)).toBe("Drawing: readiness unknown");
  });

  it("labels a withdrawn drawing by the package state that withdrew it", () => {
    expect(stepDrawingLabel({ badge: "Withdrawn — package cancelled", constructionUsable: false, preliminary: false }))
      .toBe("Drawing: withdrawn — package cancelled");
    expect(stepDrawingLabel({ badge: "Withdrawn — package verified closed", constructionUsable: false, preliminary: false }))
      .toBe("Drawing: withdrawn — package verified closed");
  });
});

describe("preIfcTag", () => {
  it("flags preliminary (IFA) drawings and nothing else", () => {
    expect(preIfcTag({ badge: "IFA — In review", constructionUsable: false, preliminary: true })).toBe("PRE-IFC");
    expect(preIfcTag({ badge: "IFA — Approved; IFC not issued", constructionUsable: false, preliminary: true })).toBe("PRE-IFC");
    expect(preIfcTag({ badge: "IFC — Issued for construction", constructionUsable: true, preliminary: false })).toBe(null);
    expect(preIfcTag({ badge: "Withdrawn — package cancelled", constructionUsable: false, preliminary: false })).toBe(null);
    expect(preIfcTag({ badge: "Retired", constructionUsable: false, preliminary: false })).toBe(null);
    expect(preIfcTag({ badge: "No issued revision", constructionUsable: false, preliminary: false })).toBe(null);
    expect(preIfcTag(null)).toBe(null);
    expect(preIfcTag(undefined)).toBe(null);
  });
});

describe("validatePdfFile", () => {
  const goodPdf = () => new TextEncoder().encode("%PDF-1.7\n%test isometric\n%%EOF\n");

  it("accepts a small well-formed PDF", () => {
    expect(validatePdfFile({ bytes: goodPdf(), mimeType: "application/pdf" }).ok).toBe(true);
    // The MIME type is advisory — the magic bytes are authoritative.
    expect(validatePdfFile({ bytes: goodPdf(), mimeType: "" }).ok).toBe(true);
  });

  it("rejects empty, non-PDF and truncated files", () => {
    expect(validatePdfFile({ bytes: new Uint8Array(0), mimeType: "application/pdf" }).ok).toBe(false);
    expect(validatePdfFile({ bytes: null, mimeType: "application/pdf" }).ok).toBe(false);
    expect(validatePdfFile({
      bytes: new TextEncoder().encode("not a pdf at all\n%%EOF\n"),
      mimeType: "application/pdf",
    }).ok).toBe(false);
    expect(validatePdfFile({
      bytes: new TextEncoder().encode("%PDF-1.7\nno eof marker here\n"),
      mimeType: "application/pdf",
    }).ok).toBe(false);
  });

  it("rejects a wrong MIME type and an oversized file", () => {
    expect(validatePdfFile({ bytes: goodPdf(), mimeType: "image/png" }).ok).toBe(false);
    const big = new Uint8Array(26214401);
    big.set(new TextEncoder().encode("%PDF-1.7\n"));
    big.set(new TextEncoder().encode("%%EOF"), big.length - 5);
    expect(validatePdfFile({ bytes: big, mimeType: "application/pdf" }).ok).toBe(false);
  });
});

describe("validateControlledDrawingIntakeInput", () => {
  const base = {
    drawingType: "isometric",
    drawingNumber: "W-0005-1",
    lineNumber: '2"-PL-101',
    revisionCode: "0",
    issueDate: "2026-11-13",
    issuerRef: "Drafter A",
    title: "Test isometric",
    pIdDrawingId: "",
    requestId: "req-1",
  };

  it("accepts a plain isometric intake, with or without optional fields", () => {
    expect(validateControlledDrawingIntakeInput(base).ok).toBe(true);
    expect(validateControlledDrawingIntakeInput({
      ...base, lineNumber: "", issuerRef: "", title: "",
    }).ok).toBe(true);
    expect(validateControlledDrawingIntakeInput({ ...base, drawingType: "p_id" }).ok).toBe(true);
    expect(validateControlledDrawingIntakeInput({ ...base, drawingType: "cut_sheet" }).ok).toBe(true);
  });

  it("rejects a bad type, missing number, bad revision code and bad date", () => {
    expect(validateControlledDrawingIntakeInput({ ...base, drawingType: "sketch" }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, drawingNumber: "" }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, drawingNumber: "W".repeat(121) }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, revisionCode: "" }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, issueDate: "13/11/2026" }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, issueDate: "2026-02-30" }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, issueDate: "" }).ok).toBe(false);
  });

  it("rejects a P&ID parent on a p_id drawing and a missing request id", () => {
    expect(validateControlledDrawingIntakeInput({
      ...base, drawingType: "p_id", pIdDrawingId: "forge_wdwg_1",
    }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, requestId: "" }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, requestId: "r".repeat(129) }).ok).toBe(false);
  });

  it("rejects overlong optional fields", () => {
    expect(validateControlledDrawingIntakeInput({ ...base, lineNumber: "L".repeat(121) }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, issuerRef: "I".repeat(201) }).ok).toBe(false);
    expect(validateControlledDrawingIntakeInput({ ...base, title: "T".repeat(201) }).ok).toBe(false);
  });
});

describe("validateIfcStageInput", () => {
  it("accepts a request id and rejects a missing one", () => {
    expect(validateIfcStageInput({ requestId: "req-2" }).ok).toBe(true);
    expect(validateIfcStageInput({ requestId: "" }).ok).toBe(false);
    expect(validateIfcStageInput({}).ok).toBe(false);
  });
});
