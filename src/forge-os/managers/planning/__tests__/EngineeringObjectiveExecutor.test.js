import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createForgeRuntime,
} from "../../../runtime/index.js";

import {
  WorkflowExecutionRegistry,
  WorkflowRegistry,
} from "../../../workflows/index.js";

import {
  createEngineeringObjectiveExecutor,
  EngineeringObjectiveExecutor,
} from "../index.js";

describe(
  "EngineeringObjectiveExecutor",
  () => {
    it(
      "plans and executes a repository inspection objective",
      async () => {
        const runtime =
          createForgeRuntime();

        const workflowRegistry =
          new WorkflowRegistry();

        const executionRegistry =
          new WorkflowExecutionRegistry();

        const timestamps = [
          "2026-08-04T04:00:00.000Z",
          "2026-08-04T04:01:00.000Z",
        ];

        const executor =
          new EngineeringObjectiveExecutor({
            runtime,
            workflowRegistry,
            executionRegistry,
            clock: () =>
              timestamps.shift(),
          });

        const result =
          await executor.execute({
            objectiveType:
              "repository-inspection",
            objective:
              "Inspect the current repository.",
            workflowId:
              "workflow-objective-execution-1",
            correlationId:
              "correlation-objective-execution-1",
            repositoryPath:
              process.cwd(),
            grantedAuthority: {
              executeWorkflow: true,
            },
            securityScope: {
              repositoryRead: true,
            },
          });

        expect(
          result.completionStatus,
        ).toBe("completed");

        expect(
          result.workflowResult
            .completedSteps,
        ).toEqual([
          "create-plan",
          "inspect-repository",
        ]);

        expect(
          result.workflowResult
            .outcomes.map(
              (outcome) =>
                outcome.payload
                  .capabilityInvoked,
            ),
        ).toEqual([
          "planning.create",
          "repository.inspect",
        ]);

        expect(
          workflowRegistry.has(
            "workflow-objective-execution-1",
          ),
        ).toBe(true);

        expect(
          executionRegistry.list()
            .length,
        ).toBe(1);

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
      "preserves objective lineage through workflow outcomes",
      async () => {
        const executor =
          createEngineeringObjectiveExecutor({
            clock: () =>
              "2026-08-04T04:00:00.000Z",
          });

        const result =
          await executor.execute({
            objectiveType:
              "repository-inspection",
            objective:
              "Inspect repository lineage.",
            workflowId:
              "workflow-objective-lineage-1",
            correlationId:
              "correlation-objective-lineage-1",
            repositoryPath:
              process.cwd(),
            grantedAuthority: {
              executeWorkflow: true,
            },
          });

        for (
          const outcome
          of result.workflowResult
            .outcomes
        ) {
          expect(
            outcome.provenance
              .correlationId,
          ).toBe(
            "correlation-objective-lineage-1",
          );
        }

        expect(
          result.executionRecord
            .workflowId,
        ).toBe(
          "workflow-objective-lineage-1",
        );
      },
    );

    it(
      "rejects objectives denied by workflow governance",
      async () => {
        const executor =
          createEngineeringObjectiveExecutor();

        await expect(
          executor.execute({
            objectiveType:
              "repository-inspection",
            objective:
              "Inspect without authority.",
            workflowId:
              "workflow-objective-rejected-1",
            correlationId:
              "correlation-objective-rejected-1",
            repositoryPath:
              process.cwd(),
            grantedAuthority: {},
          }),
        ).rejects.toThrow(
          "Workflow governance rejected execution: Workflow execution requires granted authority.",
        );
      },
    );

    it(
      "rejects unsupported objective types before runtime execution",
      async () => {
        const runtime =
          createForgeRuntime();

        const executor =
          new EngineeringObjectiveExecutor({
            runtime,
          });

        await expect(
          executor.execute({
            objectiveType:
              "unsupported-objective",
            objective:
              "Unsupported objective.",
            workflowId:
              "workflow-unsupported-1",
            correlationId:
              "correlation-unsupported-1",
          }),
        ).rejects.toThrow(
          "Unsupported engineering objective: unsupported-objective",
        );

        expect(
          runtime.contextStore
            .getCurrent()
            .payload
            .contributionHistory
            .length,
        ).toBe(0);
      },
    );
  },
);
