import {
  describe,
  expect,
  test,
} from "vitest";

import {
  buildEvolutionReviewContext,
} from "../buildEvolutionReviewContext.mjs";

function createInputs() {
  return {
    repositoryEvidence: {
      branch: "main",
      workingTreeClean: true,
      headMatchesOriginMain: true,
    },

    governanceState: {
      status: "completed",
    },

    validationEvidence: {
      focusedTests: {
        status: "passing",
      },
    },

    promotionEvaluation: {
      eligible: true,
      reasons: [],
    },

    evolutionReadiness: {
      status: "ready",
      eligible: true,
      requiresHumanApproval: true,
      reasons: [],
    },

    evolutionDecision: {
      decision: "READY_FOR_REVIEW",
      eligible: true,
      requiresHumanApproval: true,
      blockers: [],
      requiredActions: [],
    },
  };
}

describe(
  "buildEvolutionReviewContext",
  () => {
    test(
      "builds deterministic human review context",
      () => {
        const inputs =
          createInputs();

        const context =
          buildEvolutionReviewContext(
            inputs,
          );

        expect(
          context,
        ).toEqual({
          ...inputs,

          humanDecision: {
            status: "pending",
          },
        });
      },
    );

    test(
      "rejects missing required inputs",
      () => {
        expect(
          () =>
            buildEvolutionReviewContext(),
        ).toThrow();
      },
    );

    test(
      "returns deeply frozen context",
      () => {
        const context =
          buildEvolutionReviewContext(
            createInputs(),
          );

        expect(
          Object.isFrozen(context),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context.humanDecision,
          ),
        ).toBe(true);
      },
    );
  },
);
