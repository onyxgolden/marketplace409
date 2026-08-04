import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowDefinition,
  WorkflowGovernanceEvaluator,
} from "../index.js";

function createWorkflow({
  grantedAuthority = {
    executeWorkflow: true,
  },
  validationExpectations = [
    "structural-validation",
  ],
} = {}) {
  return new WorkflowDefinition({
    workflowId:
      "workflow-governance-1",
    correlationId:
      "correlation-governance-1",
    objective:
      "Inspect repository",
    targetWorkspace:
      "forge-engineering",
    grantedAuthority,
    steps: [
      {
        stepId: "create-plan",
        capability:
          "planning.create",
        validationExpectations,
      },
    ],
  });
}

describe(
  "WorkflowGovernanceEvaluator",
  () => {
    it(
      "approves a governed workflow definition",
      () => {
        const evaluator =
          new WorkflowGovernanceEvaluator();

        const decision =
          evaluator.evaluate({
            workflowDefinition:
              createWorkflow(),
          });

        expect(
          decision.decision,
        ).toBe("approved");

        expect(
          decision.workflowId,
        ).toBe(
          "workflow-governance-1",
        );

        expect(
          decision
            .requirementsEvaluated,
        ).toContain(
          "workflow-authority-present",
        );
      },
    );

    it(
      "rejects workflows without granted authority",
      () => {
        const evaluator =
          new WorkflowGovernanceEvaluator();

        const decision =
          evaluator.evaluate({
            workflowDefinition:
              createWorkflow({
                grantedAuthority: {},
              }),
          });

        expect(
          decision.decision,
        ).toBe("rejected");

        expect(
          decision.reason,
        ).toBe(
          "Workflow execution requires granted authority.",
        );
      },
    );

    it(
      "rejects steps without validation expectations",
      () => {
        const evaluator =
          new WorkflowGovernanceEvaluator();

        const decision =
          evaluator.evaluate({
            workflowDefinition:
              createWorkflow({
                validationExpectations:
                  [],
              }),
          });

        expect(
          decision.decision,
        ).toBe("rejected");

        expect(
          decision.reason,
        ).toBe(
          "Every capability workflow step requires validation expectations.",
        );
      },
    );

    it(
      "rejects non-workflow definitions",
      () => {
        const evaluator =
          new WorkflowGovernanceEvaluator();

        expect(
          () =>
            evaluator.evaluate({
              workflowDefinition: {},
            }),
        ).toThrow(
          "WorkflowGovernanceEvaluator requires a WorkflowDefinition.",
        );
      },
    );
  },
);
