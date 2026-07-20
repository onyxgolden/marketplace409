import {
  describe,
  expect,
  test,
} from "vitest";

import {
  evaluateGovernanceEvolutionDecision,
} from "../evaluateGovernanceEvolutionDecision.mjs";

function createInput(overrides = {}) {
  return {
    repository: {
      workingTreeClean: true,
      headMatchesOriginMain: true,
    },

    governance: {
      status: "completed",
    },

    evidence: {
      status: "completed",
    },

    promotion: {
      eligible: true,
    },

    evolutionReadiness: {
      status: "ready",
      eligible: true,
      reasons: [],
    },

    ...overrides,
  };
}

describe(
  "evaluateGovernanceEvolutionDecision",
  () => {
    test(
      "returns ready for review when evolution requirements are satisfied",
      () => {
        const result =
          evaluateGovernanceEvolutionDecision(
            createInput(),
          );

        expect(
          result.decision,
        ).toBe(
          "READY_FOR_REVIEW",
        );

        expect(
          result.eligible,
        ).toBe(
          true,
        );

        expect(
          result.requiresHumanApproval,
        ).toBe(
          true,
        );

        expect(
          result.blockers,
        ).toEqual(
          [],
        );
      },
    );

    test(
      "blocks evolution when readiness requirements fail",
      () => {
        const result =
          evaluateGovernanceEvolutionDecision(
            createInput({
              evolutionReadiness: {
                status: "review-required",
                eligible: false,
                reasons: [
                  {
                    code:
                      "working-tree-not-clean",
                    message:
                      "Repository contains uncommitted changes.",
                  },
                ],
              },
            }),
          );

        expect(
          result.decision,
        ).toBe(
          "EVOLUTION_BLOCKED",
        );

        expect(
          result.eligible,
        ).toBe(
          false,
        );

        expect(
          result.blockers[0].code,
        ).toBe(
          "working-tree-not-clean",
        );
      },
    );

    test(
      "requires human approval for all successful decisions",
      () => {
        const result =
          evaluateGovernanceEvolutionDecision(
            createInput(),
          );

        expect(
          result.requiresHumanApproval,
        ).toBe(
          true,
        );
      },
    );

    test(
      "deeply freezes the decision result",
      () => {
        const result =
          evaluateGovernanceEvolutionDecision(
            createInput(),
          );

        expect(
          Object.isFrozen(result),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(result.blockers),
        ).toBe(
          true,
        );
      },
    );

    test(
      "rejects invalid readiness input",
      () => {
        expect(
          () =>
            evaluateGovernanceEvolutionDecision({
              ...createInput(),
              evolutionReadiness: null,
            }),
        ).toThrow();
      },
    );

    test(
      "rejects invalid repository input",
      () => {
        expect(
          () =>
            evaluateGovernanceEvolutionDecision({
              ...createInput(),
              repository: null,
            }),
        ).toThrow();
      },
    );
  },
);
