import {
  describe,
  expect,
  test,
} from "vitest";

import {
  REVIEW_REQUIRED,
  requiresHumanReview,
} from "../requiresHumanReview.mjs";

function governanceState(stateOverrides = {}) {
  return {
    state: {
      activePhase: {
        identifier: "16.9",
        title: "Reviewed closeout proposal",
      },
      currentObjective:
        "Ship the deterministic closeout proposal workflow.",
      nextSession: {
        objective: "Visually verify the proposal.",
        startingInspection: "Inspect the synced docs.",
      },
      ...stateOverrides,
    },
  };
}

describe("requiresHumanReview", () => {
  test("returns false when every policy-required field is populated", () => {
    expect(
      requiresHumanReview(governanceState()),
    ).toBe(false);
  });

  test.each([
    ["activePhase.identifier", { activePhase: { identifier: REVIEW_REQUIRED, title: "T" } }],
    ["activePhase.title", { activePhase: { identifier: "16.9", title: REVIEW_REQUIRED } }],
    ["currentObjective", { currentObjective: REVIEW_REQUIRED }],
    ["nextSession.objective", { nextSession: { objective: REVIEW_REQUIRED, startingInspection: "x" } }],
    ["nextSession.startingInspection", { nextSession: { objective: "x", startingInspection: REVIEW_REQUIRED } }],
  ])(
    "returns true when %s is REVIEW_REQUIRED",
    (_label, stateOverride) => {
      expect(
        requiresHumanReview(
          governanceState(stateOverride),
        ),
      ).toBe(true);
    },
  );

  test("is not affected by fields outside the policy (delivered work, warnings, starting objective)", () => {
    const state = governanceState();

    // These fields are not part of requiresHumanReview's policy at all --
    // confirm the function doesn't even look at them.
    expect(
      requiresHumanReview({
        ...state,
        work: { delivered: [], knownWarnings: [] },
        objective: { startingObjective: REVIEW_REQUIRED },
        completion: { workComplete: false, incompleteReason: null },
      }),
    ).toBe(false);
  });
});
