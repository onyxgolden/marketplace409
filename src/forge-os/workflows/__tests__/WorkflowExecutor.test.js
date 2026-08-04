import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createForgeRuntime,
} from "../../runtime/index.js";

import {
  createRepositoryInspectionWorkflow,
  EngineeringWorkflow,
  WorkflowExecutionRegistry,
  WorkflowExecutor,
} from "../index.js";

describe(
  "WorkflowExecutor",
  () => {
    it(
      "executes planning and repository inspection through the governed runtime",
      async () => {
        const runtime =
          createForgeRuntime();

        const executionRegistry =
          new WorkflowExecutionRegistry();

        const timestamps = [
          "2026-08-04T04:00:00.000Z",
          "2026-08-04T04:01:00.000Z",
        ];

        const executor =
          new WorkflowExecutor({
            runtime,
            executionRegistry,
            clock: () =>
              timestamps.shift(),
          });

        const workflow =
          createRepositoryInspectionWorkflow({
            workflowId:
              "workflow-repository-inspection-1",
            correlationId:
              "correlation-repository-inspection-1",
            repositoryPath:
              process.cwd(),
            grantedAuthority: {
              executeWorkflow: true,
            },
          });

        const result =
          await executor.execute(
            workflow,
          );

        expect(
          result.completionStatus,
        ).toBe("completed");

        expect(
          result.completedSteps,
        ).toEqual([
          "create-plan",
          "inspect-repository",
        ]);

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
          result.governanceDecision
            .decision,
        ).toBe("approved");

        expect(
          result.executionRecord
            .completionStatus,
        ).toBe("completed");

        expect(
          result.executionRecord
            .outcomeContractIds,
        ).toEqual([
          "forge.outcome.manager.planning",
          "forge.outcome.manager.repository-inspection",
        ]);

        expect(
          executionRegistry.get(
            result.executionRecord
              .executionId,
          ),
        ).toBe(
          result.executionRecord,
        );

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
      "preserves workflow and correlation identity across every runtime outcome",
      async () => {
        const runtime =
          createForgeRuntime();

        const executor =
          new WorkflowExecutor({
            runtime,
            clock: () =>
              "2026-08-04T04:00:00.000Z",
          });

        const workflow =
          createRepositoryInspectionWorkflow({
            workflowId:
              "workflow-lineage-1",
            correlationId:
              "correlation-lineage-1",
            repositoryPath:
              process.cwd(),
            grantedAuthority: {
              executeWorkflow: true,
            },
          });

        const result =
          await executor.execute(
            workflow,
          );

        for (
          const outcome
          of result.outcomes
        ) {
          expect(
            outcome.provenance
              .workflowId,
          ).toBe(
            "workflow-lineage-1",
          );

          expect(
            outcome.provenance
              .correlationId,
          ).toBe(
            "correlation-lineage-1",
          );
        }
      },
    );

    it(
      "rejects execution when workflow governance denies authority",
      async () => {
        const runtime =
          createForgeRuntime();

        const executor =
          new WorkflowExecutor({
            runtime,
          });

        const workflow =
          createRepositoryInspectionWorkflow({
            workflowId:
              "workflow-rejected-1",
            correlationId:
              "correlation-rejected-1",
            repositoryPath:
              process.cwd(),
            grantedAuthority: {},
          });

        await expect(
          executor.execute(workflow),
        ).rejects.toThrow(
          "Workflow governance rejected execution: Workflow execution requires granted authority.",
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

    it(
      "rejects workflows with duplicate step identities",
      () => {
        expect(
          () =>
            new EngineeringWorkflow({
              workflowId:
                "workflow-invalid",
              correlationId:
                "correlation-invalid",
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
          "EngineeringWorkflow stepIds must be unique.",
        );
      },
    );
  },
);
