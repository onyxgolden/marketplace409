import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowExecutionRecord,
  WorkflowExecutionRegistry,
} from "../../workflows/index.js";

import {
  WorkflowExecutionStatistics,
} from "../index.js";

function createRecord({
  executionId,
  completionStatus,
  completedSteps,
  outcomeContractIds,
  startedAt,
  completedAt,
}) {
  return new WorkflowExecutionRecord({
    executionId,
    workflowId:
      "workflow-statistics",
    correlationId:
      `${executionId}.correlation`,
    objective:
      "Analyze workflow execution.",
    completionStatus,
    completedSteps,
    outcomeContractIds,
    startedAt,
    completedAt,
  });
}

describe(
  "WorkflowExecutionStatistics",
  () => {
    it(
      "calculates deterministic execution statistics",
      () => {
        const registry =
          new WorkflowExecutionRegistry();

        registry.register(
          createRecord({
            executionId:
              "execution-1",
            completionStatus:
              "completed",
            completedSteps: [
              "plan",
              "inspect",
            ],
            outcomeContractIds: [
              "outcome-1",
              "outcome-2",
            ],
            startedAt:
              "2026-08-04T04:00:00.000Z",
            completedAt:
              "2026-08-04T04:00:10.000Z",
          }),
        );

        registry.register(
          createRecord({
            executionId:
              "execution-2",
            completionStatus:
              "failed",
            completedSteps: [
              "plan",
            ],
            outcomeContractIds: [
              "outcome-3",
            ],
            startedAt:
              "2026-08-04T04:01:00.000Z",
            completedAt:
              "2026-08-04T04:01:20.000Z",
          }),
        );

        registry.register(
          createRecord({
            executionId:
              "execution-3",
            completionStatus:
              "interrupted",
            completedSteps: [],
            outcomeContractIds: [],
            startedAt:
              "2026-08-04T04:02:00.000Z",
            completedAt:
              "2026-08-04T04:02:00.000Z",
          }),
        );

        const statistics =
          new WorkflowExecutionStatistics()
            .analyze(registry);

        expect(statistics).toEqual({
          totalExecutions: 3,
          successfulExecutions: 1,
          failedExecutions: 1,
          interruptedExecutions: 1,
          completionRate: 1 / 3,
          failureRate: 1 / 3,
          totalCompletedSteps: 3,
          averageCompletedSteps: 1,
          totalOutcomeContracts: 3,
          averageOutcomeContracts: 1,
          totalDurationMilliseconds:
            30000,
          averageDurationMilliseconds:
            10000,
        });

        expect(
          Object.isFrozen(
            statistics,
          ),
        ).toBe(true);
      },
    );

    it(
      "returns zero-valued statistics for empty history",
      () => {
        const statistics =
          new WorkflowExecutionStatistics()
            .analyze([]);

        expect(statistics).toEqual({
          totalExecutions: 0,
          successfulExecutions: 0,
          failedExecutions: 0,
          interruptedExecutions: 0,
          completionRate: 0,
          failureRate: 0,
          totalCompletedSteps: 0,
          averageCompletedSteps: 0,
          totalOutcomeContracts: 0,
          averageOutcomeContracts: 0,
          totalDurationMilliseconds: 0,
          averageDurationMilliseconds: 0,
        });
      },
    );

    it(
      "accepts execution record arrays",
      () => {
        const record =
          createRecord({
            executionId:
              "execution-array-1",
            completionStatus:
              "completed",
            completedSteps: [
              "plan",
            ],
            outcomeContractIds: [
              "outcome-1",
            ],
            startedAt:
              "2026-08-04T04:00:00.000Z",
            completedAt:
              "2026-08-04T04:00:05.000Z",
          });

        const statistics =
          new WorkflowExecutionStatistics()
            .analyze([
              record,
            ]);

        expect(
          statistics
            .totalExecutions,
        ).toBe(1);

        expect(
          statistics
            .averageDurationMilliseconds,
        ).toBe(5000);
      },
    );

    it(
      "rejects unsupported history sources",
      () => {
        expect(
          () =>
            new WorkflowExecutionStatistics()
              .analyze({}),
        ).toThrow(
          "WorkflowExecutionStatistics requires execution records or a registry.",
        );
      },
    );
  },
);
