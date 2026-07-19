import {
  describe,
  expect,
  test,
} from "vitest";

import {
  evaluateGovernanceEvolutionReadiness,
} from "../evaluateGovernanceEvolutionReadiness.mjs";

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

    ...overrides,
  };
}

describe(
  "evaluateGovernanceEvolutionReadiness",
  () => {
    test(
      "returns ready when all evolution requirements are satisfied",
      () => {
        const result =
          evaluateGovernanceEvolutionReadiness(
            createInput(),
          );

        expect(
          result.status,
        ).toBe(
          "ready",
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
          result.reasons,
        ).toEqual(
          [],
        );
      },
    );

    test(
      "requires review when repository is dirty",
      () => {
        const result =
          evaluateGovernanceEvolutionReadiness(
            createInput({
              repository: {
                workingTreeClean: false,
                headMatchesOriginMain: true,
              },
            }),
          );

        expect(
          result.status,
        ).toBe(
          "review-required",
        );

        expect(
          result.reasons[0].code,
        ).toBe(
          "working-tree-not-clean",
        );
      },
    );

    test(
      "requires review when promotion is not eligible",
      () => {
        const result =
          evaluateGovernanceEvolutionReadiness(
            createInput({
              promotion: {
                eligible: false,
              },
            }),
          );

        expect(
          result.eligible,
        ).toBe(
          false,
        );

        expect(
          result.reasons.some(
            (reason) =>
              reason.code ===
              "promotion-not-eligible",
          ),
        ).toBe(
          true,
        );
      },
    );

    test(
      "deeply freezes the result",
      () => {
        const result =
          evaluateGovernanceEvolutionReadiness(
            createInput(),
          );

        expect(
          Object.isFrozen(result),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(result.reasons),
        ).toBe(
          true,
        );
      },
    );

    test(
      "rejects invalid repository input",
      () => {
        expect(
          () =>
            evaluateGovernanceEvolutionReadiness({
              ...createInput(),
              repository: null,
            }),
        ).toThrow();
      },
    );

    test(
      "rejects invalid governance input",
      () => {
        expect(
          () =>
            evaluateGovernanceEvolutionReadiness({
              ...createInput(),
              governance: null,
            }),
        ).toThrow();
      },
    );

    test(
      "rejects invalid evidence input",
      () => {
        expect(
          () =>
            evaluateGovernanceEvolutionReadiness({
              ...createInput(),
              evidence: null,
            }),
        ).toThrow();
      },
    );

    test(
      "rejects invalid promotion input",
      () => {
        expect(
          () =>
            evaluateGovernanceEvolutionReadiness({
              ...createInput(),
              promotion: null,
            }),
        ).toThrow();
      },
    );
  },
);
