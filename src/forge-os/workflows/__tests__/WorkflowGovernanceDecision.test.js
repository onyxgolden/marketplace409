import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createWorkflowGovernanceDecision,
} from "../index.js";

describe(
  "createWorkflowGovernanceDecision",
  () => {
    it(
      "creates an immutable workflow governance decision",
      () => {
        const decision =
          createWorkflowGovernanceDecision({
            decision: "approved",
            workflowId:
              "workflow-governance-1",
            requirementsEvaluated: [
              "workflow-definition-valid",
            ],
            reason:
              "Requirements satisfied.",
          });

        expect(
          Object.isFrozen(decision),
        ).toBe(true);

        expect(
          Object.isFrozen(
            decision
              .requirementsEvaluated,
          ),
        ).toBe(true);

        expect(
          decision.decision,
        ).toBe("approved");
      },
    );

    it(
      "requires a workflow identity",
      () => {
        expect(
          () =>
            createWorkflowGovernanceDecision({
              decision: "approved",
            }),
        ).toThrow(
          "Workflow governance decision requires a workflowId.",
        );
      },
    );
  },
);
