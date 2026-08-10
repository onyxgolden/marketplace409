import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ReviewedSessionMetadataValidationError,
  applyReviewedSessionMetadata,
  validateReviewedSessionMetadata,
} from "../reviewedSessionMetadataContract.mjs";

function baseSnapshot() {
  return {
    phase: {
      identifier: "REVIEW_REQUIRED",
      title: "REVIEW_REQUIRED",
      status: "incomplete",
    },
    objective: {
      startingObjective: "REVIEW_REQUIRED",
      endingObjective: "REVIEW_REQUIRED",
    },
    work: {
      delivered: [],
      modifiedFiles: ["src/foo.js"],
      knownWarnings: [],
    },
    completion: {
      workComplete: false,
      supportedByEvidence: false,
      incompleteReason:
        "The repository evidence collector does not infer session completion. Human review is required.",
    },
    nextSession: {
      objective: "REVIEW_REQUIRED",
      startingInspection: "REVIEW_REQUIRED",
    },
  };
}

describe("validateReviewedSessionMetadata", () => {
  it("accepts an empty object and defaults markSessionComplete to false", () => {
    const result = validateReviewedSessionMetadata({});

    expect(result).toEqual({
      markSessionComplete: false,
    });
  });

  it("trims and accepts valid string fields", () => {
    const result = validateReviewedSessionMetadata({
      phaseIdentifier: "  16.9  ",
      phaseTitle: " Session Closeout Metadata ",
    });

    expect(result.phaseIdentifier).toBe("16.9");
    expect(result.phaseTitle).toBe(
      "Session Closeout Metadata",
    );
  });

  it("treats blank or whitespace-only strings as omitted", () => {
    const result = validateReviewedSessionMetadata({
      phaseIdentifier: "   ",
      endingObjective: "",
    });

    expect(result.phaseIdentifier).toBeUndefined();
    expect(result.endingObjective).toBeUndefined();
  });

  it("rejects unrecognized fields", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        somethingUnexpected: "value",
      }),
    ).toThrow(ReviewedSessionMetadataValidationError);
  });

  it("rejects non-string values for string fields", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        phaseIdentifier: 123,
      }),
    ).toThrow(ReviewedSessionMetadataValidationError);
  });

  it("rejects strings exceeding the maximum length", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        endingObjective: "x".repeat(2001),
      }),
    ).toThrow(/2000 characters/);
  });

  it("normalizes array fields by trimming each item", () => {
    const result = validateReviewedSessionMetadata({
      deliveredWork: [
        "  Added the results panel  ",
        "Wired clipboard copy",
      ],
    });

    expect(result.deliveredWork).toEqual([
      "Added the results panel",
      "Wired clipboard copy",
    ]);
  });

  it("rejects a non-array value for an array field", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        deliveredWork: "not an array",
      }),
    ).toThrow(ReviewedSessionMetadataValidationError);
  });

  it("rejects an array item that is empty after trimming", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        deliveredWork: ["   "],
      }),
    ).toThrow(/must not be empty/);
  });

  it("rejects an array exceeding the maximum item count", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        knownWarnings: Array.from(
          { length: 51 },
          (_, index) => `warning ${index}`,
        ),
      }),
    ).toThrow(/50 items/);
  });

  it("rejects an array item exceeding the maximum length", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        knownWarnings: ["y".repeat(501)],
      }),
    ).toThrow(/500 characters/);
  });

  it("rejects a non-boolean markSessionComplete", () => {
    expect(() =>
      validateReviewedSessionMetadata({
        markSessionComplete: "yes",
      }),
    ).toThrow(ReviewedSessionMetadataValidationError);
  });

  it("accepts an explicit markSessionComplete value", () => {
    const result = validateReviewedSessionMetadata({
      markSessionComplete: true,
    });

    expect(result.markSessionComplete).toBe(true);
  });
});

describe("applyReviewedSessionMetadata", () => {
  it("overrides only fields present in reviewedMetadata", () => {
    const snapshot = baseSnapshot();

    const reviewedMetadata = validateReviewedSessionMetadata({
      phaseIdentifier: "16.9",
      endingObjective: "Ship the session closeout form",
    });

    const result = applyReviewedSessionMetadata({
      snapshot,
      reviewedMetadata,
    });

    expect(result.phase.identifier).toBe("16.9");
    expect(result.phase.title).toBe("REVIEW_REQUIRED");
    expect(result.objective.endingObjective).toBe(
      "Ship the session closeout form",
    );
    expect(result.objective.startingObjective).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("does not mutate the original snapshot", () => {
    const snapshot = baseSnapshot();

    const reviewedMetadata = validateReviewedSessionMetadata({
      phaseIdentifier: "16.9",
    });

    applyReviewedSessionMetadata({
      snapshot,
      reviewedMetadata,
    });

    expect(snapshot.phase.identifier).toBe(
      "REVIEW_REQUIRED",
    );
  });

  it("replaces deliveredWork and knownWarnings only when supplied", () => {
    const snapshot = baseSnapshot();

    const reviewedMetadata = validateReviewedSessionMetadata({
      deliveredWork: ["Shipped the dashboard redesign"],
    });

    const result = applyReviewedSessionMetadata({
      snapshot,
      reviewedMetadata,
    });

    expect(result.work.delivered).toEqual([
      "Shipped the dashboard redesign",
    ]);
    expect(result.work.knownWarnings).toEqual([]);
    expect(result.work.modifiedFiles).toEqual([
      "src/foo.js",
    ]);
  });

  it("does not resolve markSessionComplete into completion fields", () => {
    const snapshot = baseSnapshot();

    const reviewedMetadata = validateReviewedSessionMetadata({
      markSessionComplete: true,
    });

    const result = applyReviewedSessionMetadata({
      snapshot,
      reviewedMetadata,
    });

    expect(result.completion.workComplete).toBe(false);
    expect(result.completion.supportedByEvidence).toBe(
      false,
    );
  });

  it("returns a frozen snapshot", () => {
    const snapshot = baseSnapshot();

    const reviewedMetadata =
      validateReviewedSessionMetadata({});

    const result = applyReviewedSessionMetadata({
      snapshot,
      reviewedMetadata,
    });

    expect(Object.isFrozen(result)).toBe(true);
  });
});
