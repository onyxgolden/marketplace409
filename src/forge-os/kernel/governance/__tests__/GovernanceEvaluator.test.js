import {
  describe,
  expect,
  it,
} from "vitest";

import {
  GovernanceEvaluator,
} from "../GovernanceEvaluator.js";


function createOutcome({
  contextContribution,
  producedEvidence = [],
} = {}) {
  return {
    payload: {
      managerIdentity:
        "repository-intelligence-manager",
      contextContribution,
      producedEvidence,
    },
  };
}


describe(
  "GovernanceEvaluator",
  () => {
    it(
      "approves outcomes without context mutation",
      () => {
        const evaluator =
          new GovernanceEvaluator();

        const decision =
          evaluator.evaluate({
            outcome:
              createOutcome(),
          });

        expect(
          decision.decision,
        ).toBe(
          "approved",
        );
      },
    );

    it(
      "approves valid context evolution requests",
      () => {
        const evaluator =
          new GovernanceEvaluator();

        const decision =
          evaluator.evaluate({
            outcome:
              createOutcome({
                contextContribution: {
                  architecture:
                    "updated",
                },
              }),
            evidenceReferences: [
              "test-result",
            ],
          });

        expect(
          decision.decision,
        ).toBe(
          "approved",
        );

        expect(
          decision.evidenceReferences,
        ).toEqual([
          "test-result",
        ]);
      },
    );

    it(
      "rejects missing outcomes",
      () => {
        const evaluator =
          new GovernanceEvaluator();

        expect(
          () =>
            evaluator.evaluate({}),
        ).toThrow();
      },
    );
  },
);
