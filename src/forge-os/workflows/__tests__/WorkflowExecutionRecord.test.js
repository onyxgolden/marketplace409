import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowExecutionRecord,
} from "../index.js";

describe(
  "WorkflowExecutionRecord",
  () => {
    it(
      "creates an immutable execution record",
      () => {
        const record =
          new WorkflowExecutionRecord({
            executionId:
              "execution-1",
            workflowId:
              "workflow-1",
            correlationId:
              "correlation-1",
            objective:
              "Inspect repository",
            completionStatus:
              "completed",
            completedSteps: [
              "create-plan",
              "inspect-repository",
            ],
            outcomeContractIds: [
              "outcome-1",
              "outcome-2",
            ],
            startedAt:
              "2026-08-04T04:00:00.000Z",
            completedAt:
              "2026-08-04T04:01:00.000Z",
          });

        expect(
          Object.isFrozen(record),
        ).toBe(true);

        expect(
          Object.isFrozen(
            record.completedSteps,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            record.outcomeContractIds,
          ),
        ).toBe(true);
      },
    );

    it(
      "requires an execution identity",
      () => {
        expect(
          () =>
            new WorkflowExecutionRecord({
              workflowId:
                "workflow-1",
              correlationId:
                "correlation-1",
              completionStatus:
                "completed",
              completedSteps: [],
              outcomeContractIds: [],
            }),
        ).toThrow(
          "WorkflowExecutionRecord requires an executionId.",
        );
      },
    );
  },
);
