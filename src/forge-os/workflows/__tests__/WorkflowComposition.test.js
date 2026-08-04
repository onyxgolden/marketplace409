import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createForgeRuntime,
} from "../../runtime/index.js";

import {
  EngineeringWorkflow,
  WorkflowExecutionRegistry,
  WorkflowExecutor,
  WorkflowRegistry,
} from "../index.js";

function createChildWorkflow({
  workflowId =
    "child-repository-workflow",
  childWorkflowId,
} = {}) {
  return new EngineeringWorkflow({
    workflowId,
    correlationId:
      `${workflowId}.definition`,
    objective:
      "Inspect the repository",
    targetWorkspace:
      "forge-engineering",
    repositoryPath:
      process.cwd(),
    grantedAuthority: {
      executeWorkflow: true,
    },
    steps:
      childWorkflowId
        ? [
            {
              stepId:
                "nested-child",
              workflowId:
                childWorkflowId,
            },
          ]
        : [
            {
              stepId:
                "inspect-repository",
              capability:
                "repository.inspect",
              input: {
                repositoryPath:
                  process.cwd(),
              },
              validationExpectations: [
                "structural-validation",
              ],
            },
          ],
  });
}

function createParentWorkflow({
  childWorkflowId =
    "child-repository-workflow",
} = {}) {
  return new EngineeringWorkflow({
    workflowId:
      "parent-engineering-workflow",
    correlationId:
      "correlation-composition-1",
    objective:
      "Plan and inspect repository",
    targetWorkspace:
      "forge-engineering",
    repositoryPath:
      process.cwd(),
    grantedAuthority: {
      executeWorkflow: true,
    },
    steps: [
      {
        stepId: "create-plan",
        capability:
          "planning.create",
        validationExpectations: [
          "structural-validation",
        ],
      },
      {
        stepId:
          "run-repository-workflow",
        workflowId:
          childWorkflowId,
      },
    ],
  });
}

describe(
  "Workflow composition",
  () => {
    it(
      "executes a registered child workflow",
      async () => {
        const runtime =
          createForgeRuntime();

        const workflowRegistry =
          new WorkflowRegistry();

        const executionRegistry =
          new WorkflowExecutionRegistry();

        workflowRegistry.register(
          createChildWorkflow(),
        );

        const timestamps = [
          "2026-08-04T04:00:00.000Z",
          "2026-08-04T04:00:10.000Z",
          "2026-08-04T04:00:20.000Z",
          "2026-08-04T04:00:30.000Z",
        ];

        const executor =
          new WorkflowExecutor({
            runtime,
            workflowRegistry,
            executionRegistry,
            clock: () =>
              timestamps.shift(),
          });

        const result =
          await executor.execute(
            createParentWorkflow(),
          );

        expect(
          result.completedSteps,
        ).toEqual([
          "create-plan",
          "run-repository-workflow",
        ]);

        expect(
          result.childResults.length,
        ).toBe(1);

        expect(
          result.childResults[0]
            .workflowId,
        ).toBe(
          "child-repository-workflow",
        );

        expect(
          result.outcomes.map(
            (outcome) =>
              outcome.payload
                .capabilityInvoked,
          ),
        ).toEqual([
          "planning.create",
          "repository.inspect",
        ]);

        expect(
          result.outcomes.map(
            (outcome) =>
              outcome.provenance
                .correlationId,
          ),
        ).toEqual([
          "correlation-composition-1",
          "correlation-composition-1",
        ]);

        expect(
          executionRegistry.list()
            .length,
        ).toBe(2);

        expect(
          runtime.contextStore
            .getCurrent()
            .payload
            .contributionHistory
            .length,
        ).toBe(2);
      },
    );

    it(
      "rejects unknown child workflows",
      async () => {
        const executor =
          new WorkflowExecutor({
            runtime:
              createForgeRuntime(),
            workflowRegistry:
              new WorkflowRegistry(),
          });

        await expect(
          executor.execute(
            createParentWorkflow({
              childWorkflowId:
                "missing-workflow",
            }),
          ),
        ).rejects.toThrow(
          "Unknown child workflow: missing-workflow",
        );
      },
    );

    it(
      "rejects recursive workflow cycles",
      async () => {
        const registry =
          new WorkflowRegistry();

        registry.register(
          createChildWorkflow({
            workflowId:
              "workflow-a",
            childWorkflowId:
              "workflow-b",
          }),
        );

        registry.register(
          createChildWorkflow({
            workflowId:
              "workflow-b",
            childWorkflowId:
              "workflow-a",
          }),
        );

        const root =
          new EngineeringWorkflow({
            workflowId:
              "root-workflow",
            correlationId:
              "correlation-cycle-1",
            objective:
              "Detect composition cycle",
            targetWorkspace:
              "forge-engineering",
            grantedAuthority: {
              executeWorkflow: true,
            },
            steps: [
              {
                stepId:
                  "start-cycle",
                workflowId:
                  "workflow-a",
              },
            ],
          });

        const executor =
          new WorkflowExecutor({
            runtime:
              createForgeRuntime(),
            workflowRegistry:
              registry,
          });

        await expect(
          executor.execute(root),
        ).rejects.toThrow(
          "Workflow composition cycle detected: root-workflow -> workflow-a -> workflow-b -> workflow-a",
        );
      },
    );
  },
);
