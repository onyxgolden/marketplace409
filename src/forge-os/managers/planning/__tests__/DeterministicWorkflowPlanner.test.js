import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EngineeringWorkflow,
} from "../../../workflows/index.js";

import {
  DeterministicWorkflowPlanner,
} from "../DeterministicWorkflowPlanner.js";

describe(
  "DeterministicWorkflowPlanner",
  () => {
    it(
      "creates a governed repository inspection workflow from an objective",
      () => {
        const planner =
          new DeterministicWorkflowPlanner();

        const workflow =
          planner.plan({
            objectiveType:
              "repository-inspection",
            objective:
              "Inspect the current repository.",
            workflowId:
              "workflow-objective-1",
            correlationId:
              "correlation-objective-1",
            repositoryPath:
              process.cwd(),
            targetWorkspace:
              "forge-engineering",
            grantedAuthority: {
              executeWorkflow: true,
            },
            securityScope: {
              repositoryRead: true,
            },
          });

        expect(
          workflow,
        ).toBeInstanceOf(
          EngineeringWorkflow,
        );

        expect(
          workflow.objective,
        ).toBe(
          "Inspect the current repository.",
        );

        expect(
          workflow.steps.map(
            (step) => ({
              stepId: step.stepId,
              capability:
                step.capability,
            }),
          ),
        ).toEqual([
          {
            stepId: "create-plan",
            capability:
              "planning.create",
          },
          {
            stepId:
              "inspect-repository",
            capability:
              "repository.inspect",
          },
        ]);

        expect(
          workflow.grantedAuthority,
        ).toEqual({
          executeWorkflow: true,
        });
      },
    );

    it(
      "reports supported objective classifications",
      () => {
        const planner =
          new DeterministicWorkflowPlanner();

        expect(
          planner.supports(
            "repository-inspection",
          ),
        ).toBe(true);

        expect(
          planner.supports(
            "unknown-objective",
          ),
        ).toBe(false);

        expect(
          planner.listSupportedObjectives(),
        ).toEqual([
          "repository-inspection",
        ]);
      },
    );

    it(
      "rejects unsupported objective classifications",
      () => {
        const planner =
          new DeterministicWorkflowPlanner();

        expect(
          () =>
            planner.plan({
              objectiveType:
                "unknown-objective",
            }),
        ).toThrow(
          "Unsupported engineering objective: unknown-objective",
        );
      },
    );

    it(
      "rejects objectives without a classification",
      () => {
        const planner =
          new DeterministicWorkflowPlanner();

        expect(
          () =>
            planner.plan({
              objective:
                "Unclassified objective",
            }),
        ).toThrow(
          "DeterministicWorkflowPlanner requires an objectiveType.",
        );
      },
    );
  },
);
