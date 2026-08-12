import {
  describe,
  expect,
  it,
} from "vitest";

import {
  compareSnapshotToReviewedMetadata,
  computeExpectedWorkComplete,
} from "./compareSnapshotToReviewedMetadata";

function baseSnapshot(overrides = {}) {
  return {
    phase: {
      identifier: "16.9",
      title: "Reviewed closeout proposal",
    },
    objective: {
      startingObjective: "REVIEW_REQUIRED",
      endingObjective: "Ship the fix.",
    },
    work: {
      delivered: ["Did the thing."],
      knownWarnings: ["Known issue."],
    },
    completion: {
      workComplete: false,
      incompleteReason: null,
    },
    nextSession: {
      objective: "Next.",
      startingInspection: "REVIEW_REQUIRED",
    },
    repository: {
      head: "a".repeat(40),
    },
    validation: {
      focusedTests: { status: "not-run" },
      fullTests: { status: "passing" },
      productionBuild: { status: "passing" },
    },
    evidence: {
      selectedValidationArtifact: null,
    },
    ...overrides,
  };
}

describe("compareSnapshotToReviewedMetadata", () => {
  it("reports no mismatches when every supplied field matches", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        phaseIdentifier: "16.9",
        endingObjective: "Ship the fix.",
        deliveredWork: ["Did the thing."],
        knownWarnings: ["Known issue."],
        nextSessionObjective: "Next.",
        markSessionComplete: false,
      },
    );

    expect(mismatches).toEqual([]);
  });

  it("skips fields the reviewer did not submit -- omission is never a mismatch", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot({
        phase: {
          identifier: "REVIEW_REQUIRED",
          title: "REVIEW_REQUIRED",
        },
      }),
      {
        // Only markSessionComplete is present (it always is, post
        // normalization). phaseIdentifier/phaseTitle/etc. were never
        // submitted and must not be compared.
        markSessionComplete: false,
      },
    );

    expect(mismatches).toEqual([]);
  });

  it("detects a changed phaseIdentifier", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        phaseIdentifier: "16.10",
        markSessionComplete: false,
      },
    );

    expect(mismatches).toEqual([
      {
        field: "phaseIdentifier",
        expected: "16.10",
        actual: "16.9",
      },
    ]);
  });

  it("detects changed deliveredWork with an exact array comparison", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        deliveredWork: ["Did the thing.", "Did another thing."],
        markSessionComplete: false,
      },
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].field).toBe("deliveredWork");
  });

  it("detects deliveredWork that matches by content but not by order", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot({
        work: {
          delivered: ["Second.", "First."],
          knownWarnings: [],
        },
      }),
      {
        deliveredWork: ["First.", "Second."],
        markSessionComplete: false,
      },
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].field).toBe("deliveredWork");
  });

  it("detects changed knownWarnings", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot({
        work: {
          delivered: ["Did the thing."],
          knownWarnings: [],
        },
      }),
      {
        knownWarnings: ["Known issue."],
        markSessionComplete: false,
      },
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].field).toBe("knownWarnings");
  });

  it("detects a changed nextSessionStartingInspection", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        nextSessionStartingInspection: "Inspect the new thing.",
        markSessionComplete: false,
      },
    );

    expect(mismatches).toEqual([
      {
        field: "nextSessionStartingInspection",
        expected: "Inspect the new thing.",
        actual: "REVIEW_REQUIRED",
      },
    ]);
  });

  it("detects an incompleteReason that was not applied", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        incompleteReason: "Waiting on a follow-up decision.",
        markSessionComplete: false,
      },
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].field).toBe("incompleteReason");
  });

  describe("markSessionComplete resolution", () => {
    it("passes when markSessionComplete=true resolves workComplete=true and evidence supports it", () => {
      const snapshot = baseSnapshot({
        completion: {
          workComplete: true,
          incompleteReason: null,
        },
        validation: {
          focusedTests: { status: "passing" },
          fullTests: { status: "passing" },
          productionBuild: { status: "passing" },
        },
        evidence: {
          selectedValidationArtifact: {
            repositoryHead: "a".repeat(40),
          },
        },
      });

      const mismatches = compareSnapshotToReviewedMetadata(
        snapshot,
        { markSessionComplete: true },
      );

      expect(mismatches).toEqual([]);
    });

    it("detects incorrect completion resolution: markSessionComplete=true submitted and evidence genuinely supports it, but workComplete never resolved to true", () => {
      const snapshot = baseSnapshot({
        completion: {
          // Evidence fully supports completion (all three categories
          // passing, artifact bound to the current commit) yet
          // workComplete was somehow never resolved to true -- a genuine
          // application bug, not a legitimate "not yet eligible" case.
          workComplete: false,
          incompleteReason: null,
        },
        validation: {
          focusedTests: { status: "passing" },
          fullTests: { status: "passing" },
          productionBuild: { status: "passing" },
        },
        evidence: {
          selectedValidationArtifact: {
            repositoryHead: "a".repeat(40),
          },
        },
      });

      const mismatches = compareSnapshotToReviewedMetadata(
        snapshot,
        { markSessionComplete: true },
      );

      expect(mismatches).toEqual([
        {
          field: "markSessionComplete",
          expected: "true",
          actual: "false",
        },
      ]);
    });

    it("detects incorrect completion resolution: workComplete=true even though markSessionComplete was false", () => {
      const snapshot = baseSnapshot({
        completion: {
          workComplete: true,
          incompleteReason: null,
        },
      });

      const mismatches = compareSnapshotToReviewedMetadata(
        snapshot,
        { markSessionComplete: false },
      );

      expect(mismatches).toEqual([
        {
          field: "markSessionComplete",
          expected: "false",
          actual: "true",
        },
      ]);
    });

    it("does not flag markSessionComplete=true when evidence legitimately does not cover the current commit -- false is the correct resolution", () => {
      const snapshot = baseSnapshot({
        completion: {
          workComplete: false,
          incompleteReason:
            "Validation evidence does not yet cover a passing result for the current commit.",
        },
        evidence: {
          selectedValidationArtifact: {
            repositoryHead: "b".repeat(40),
          },
        },
      });

      const mismatches = compareSnapshotToReviewedMetadata(
        snapshot,
        { markSessionComplete: true },
      );

      expect(mismatches).toEqual([]);
    });
  });

  it("collects multiple independent mismatches in one pass", () => {
    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        phaseIdentifier: "16.10",
        deliveredWork: ["Something else."],
        markSessionComplete: false,
      },
    );

    const fields = mismatches.map((mismatch) => mismatch.field);

    expect(fields).toEqual(
      expect.arrayContaining([
        "phaseIdentifier",
        "deliveredWork",
      ]),
    );
    expect(mismatches).toHaveLength(2);
  });

  it("truncates long values in mismatch output instead of dumping raw data", () => {
    const longValue = "x".repeat(500);

    const mismatches = compareSnapshotToReviewedMetadata(
      baseSnapshot(),
      {
        endingObjective: longValue,
        markSessionComplete: false,
      },
    );

    expect(mismatches).toHaveLength(1);
    expect(mismatches[0].expected.length).toBeLessThan(200);
    expect(mismatches[0].expected.endsWith("…")).toBe(true);
  });
});

describe("computeExpectedWorkComplete", () => {
  it("returns false when markSessionComplete is not true", () => {
    expect(
      computeExpectedWorkComplete(baseSnapshot(), false),
    ).toBe(false);
  });

  it("returns false when evidence does not cover the current commit, even if markSessionComplete is true", () => {
    const snapshot = baseSnapshot({
      evidence: {
        selectedValidationArtifact: {
          repositoryHead: "different-head",
        },
      },
    });

    expect(
      computeExpectedWorkComplete(snapshot, true),
    ).toBe(false);
  });

  it("returns false when not every validation category is passing", () => {
    const snapshot = baseSnapshot({
      validation: {
        focusedTests: { status: "not-run" },
        fullTests: { status: "passing" },
        productionBuild: { status: "failing" },
      },
      evidence: {
        selectedValidationArtifact: {
          repositoryHead: "a".repeat(40),
        },
      },
    });

    expect(
      computeExpectedWorkComplete(snapshot, true),
    ).toBe(false);
  });

  it("returns true only when markSessionComplete is true, evidence covers the current commit, and every category passes", () => {
    const snapshot = baseSnapshot({
      validation: {
        focusedTests: { status: "passing" },
        fullTests: { status: "passing" },
        productionBuild: { status: "passing" },
      },
      evidence: {
        selectedValidationArtifact: {
          repositoryHead: "a".repeat(40),
        },
      },
    });

    expect(
      computeExpectedWorkComplete(snapshot, true),
    ).toBe(true);
  });
});
