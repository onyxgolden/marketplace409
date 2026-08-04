import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EngineeringWorkflow,
  WorkflowDefinition,
  WorkflowStep,
} from "../index.js";

describe(
  "WorkflowDefinition",
  () => {
    it(
      "creates an immutable workflow definition",
      () => {
        const definition =
          new WorkflowDefinition({
            workflowId:
              "workflow-definition-1",
            correlationId:
              "correlation-definition-1",
            objective:
              "Inspect repository",
            targetWorkspace:
              "forge-engineering",
            repositoryPath:
              process.cwd(),
            steps: [
              {
                stepId:
                  "inspect-repository",
                capability:
                  "repository.inspect",
                input: {
                  repositoryPath:
                    process.cwd(),
                },
              },
            ],
          });

        expect(
          definition.steps[0],
        ).toBeInstanceOf(
          WorkflowStep,
        );

        expect(
          Object.isFrozen(
            definition,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            definition.steps,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            definition.steps[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects duplicate step identities",
      () => {
        expect(
          () =>
            new WorkflowDefinition({
              workflowId:
                "workflow-duplicate",
              correlationId:
                "correlation-duplicate",
              objective:
                "Invalid workflow",
              targetWorkspace:
                "forge-engineering",
              steps: [
                {
                  stepId: "duplicate",
                  capability:
                    "planning.create",
                },
                {
                  stepId: "duplicate",
                  capability:
                    "repository.inspect",
                },
              ],
            }),
        ).toThrow(
          "WorkflowDefinition stepIds must be unique.",
        );
      },
    );

    it(
      "preserves EngineeringWorkflow compatibility",
      () => {
        const workflow =
          new EngineeringWorkflow({
            workflowId:
              "engineering-workflow-1",
            correlationId:
              "engineering-correlation-1",
            objective:
              "Create plan",
            targetWorkspace:
              "forge-engineering",
            steps: [
              {
                stepId: "create-plan",
                capability:
                  "planning.create",
              },
            ],
          });

        expect(
          workflow,
        ).toBeInstanceOf(
          WorkflowDefinition,
        );

        expect(
          workflow,
        ).toBeInstanceOf(
          EngineeringWorkflow,
        );
      },
    );
  },
);
