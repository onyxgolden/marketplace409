import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createGovernanceDecision,
} from "../GovernanceDecision.js";


describe(
  "GovernanceDecision",
  () => {
    it(
      "creates an immutable governance decision",
      () => {
        const decision =
          createGovernanceDecision({
            decision:
              "approved",
            managerIdentity:
              "repository-intelligence-manager",
            evidenceReferences: [
              "evidence-1",
            ],
            requirementsEvaluated: [
              "evidence-required",
            ],
            reason:
              "Governance requirements satisfied.",
          });

        expect(
          decision.decision,
        ).toBe(
          "approved",
        );

        expect(
          decision.managerIdentity,
        ).toBe(
          "repository-intelligence-manager",
        );

        expect(
          decision.evidenceReferences,
        ).toEqual([
          "evidence-1",
        ]);

        expect(
          Object.isFrozen(
            decision,
          ),
        ).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            decision.evidenceReferences,
          ),
        ).toBe(
          true,
        );
      },
    );

    it(
      "rejects missing decision values",
      () => {
        expect(
          () =>
            createGovernanceDecision({
              managerIdentity:
                "manager",
            }),
        ).toThrow();
      },
    );
  },
);
