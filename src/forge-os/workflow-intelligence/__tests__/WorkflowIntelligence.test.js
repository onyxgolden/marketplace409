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
  WorkflowIntelligence,
} from "../index.js";

function createOutcome({
  capability,
  completionStatus,
  failureClassification,
  durationMilliseconds = 0,
}) {
  return Object.freeze({
    payload: Object.freeze({
      capabilityInvoked:
        capability,
      managerIdentity:
        `${capability}.manager`,
      completionStatus,
      failureClassification,
      validationRequirements:
        Object.freeze([]),
      producedEvidence:
        Object.freeze([]),
      timingInformation:
        Object.freeze({
          durationMilliseconds,
        }),
    }),
  });
}

describe(
  "WorkflowIntelligence",
  () => {
    it(
      "produces a complete immutable intelligence report",
      () => {
        const executionRegistry =
          new WorkflowExecutionRegistry();

        executionRegistry.register(
          new WorkflowExecutionRecord({
            executionId:
              "execution-intelligence-1",
            workflowId:
              "workflow-intelligence-1",
            correlationId:
              "correlation-intelligence-1",
            objective:
              "Analyze workflow performance.",
            completionStatus:
              "failed",
            completedSteps: [
              "create-plan",
            ],
            outcomeContractIds: [
              "outcome-planning",
              "outcome-repository",
            ],
            startedAt:
              "2026-08-04T04:00:00.000Z",
            completedAt:
              "2026-08-04T04:00:10.000Z",
          }),
        );

        const workflowResults = [
          Object.freeze({
            workflowId:
              "workflow-intelligence-1",
            correlationId:
              "correlation-intelligence-1",
            completionStatus:
              "failed",
            governanceDecision:
              Object.freeze({
                decision:
                  "approved",
              }),
            outcomes:
              Object.freeze([
                createOutcome({
                  capability:
                    "planning.create",
                  completionStatus:
                    "completed",
                  durationMilliseconds:
                    2,
                }),
                createOutcome({
                  capability:
                    "repository.inspect",
                  completionStatus:
                    "failed",
                  failureClassification:
                    "repository-unavailable",
                  durationMilliseconds:
                    8,
                }),
              ]),
          }),
        ];

        const report =
          new WorkflowIntelligence()
            .analyze({
              executionHistory:
                executionRegistry,
              workflowResults,
            });

        expect(
          report.statistics
            .totalExecutions,
        ).toBe(1);

        expect(
          report.capabilityMetrics,
        ).toHaveLength(2);

        expect(
          report.failures[0]
            .failureType,
        ).toBe(
          "repository-unavailable",
        );

        expect(
          report.recommendations[0]
            .action,
        ).toBe(
          "reinspect-repository",
        );

        expect(
          Object.isFrozen(report),
        ).toBe(true);
      },
    );

    it(
      "returns empty analysis for empty history and results",
      () => {
        const report =
          new WorkflowIntelligence()
            .analyze({
              executionHistory: [],
              workflowResults: [],
            });

        expect(
          report.statistics
            .totalExecutions,
        ).toBe(0);

        expect(
          report.capabilityMetrics,
        ).toEqual([]);

        expect(
          report.failures,
        ).toEqual([]);

        expect(
          report.recommendations,
        ).toEqual([]);
      },
    );

    it(
      "requires execution history",
      () => {
        expect(
          () =>
            new WorkflowIntelligence()
              .analyze({
                workflowResults: [],
              }),
        ).toThrow(
          "WorkflowIntelligence requires executionHistory.",
        );
      },
    );

    it(
      "requires workflow results",
      () => {
        expect(
          () =>
            new WorkflowIntelligence()
              .analyze({
                executionHistory: [],
              }),
        ).toThrow(
          "WorkflowIntelligence requires workflowResults.",
        );
      },
    );
  },
);
