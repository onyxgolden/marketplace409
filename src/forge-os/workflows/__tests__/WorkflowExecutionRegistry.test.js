import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowExecutionRecord,
  WorkflowExecutionRegistry,
} from "../index.js";

function createRecord(
  executionId =
    "execution-registry-1",
  workflowId =
    "workflow-registry-1",
) {
  return new WorkflowExecutionRecord({
    executionId,
    workflowId,
    correlationId:
      `${executionId}.correlation`,
    objective:
      "Validate execution registry",
    completionStatus:
      "completed",
    completedSteps: [
      "create-plan",
    ],
    outcomeContractIds: [
      "forge.outcome.manager.planning",
    ],
    startedAt:
      "2026-08-04T04:00:00.000Z",
    completedAt:
      "2026-08-04T04:01:00.000Z",
  });
}

describe(
  "WorkflowExecutionRegistry",
  () => {
    it(
      "registers and resolves execution records",
      () => {
        const registry =
          new WorkflowExecutionRegistry();

        const record =
          createRecord();

        expect(
          registry.register(record),
        ).toBe(record);

        expect(
          registry.get(
            record.executionId,
          ),
        ).toBe(record);

        expect(
          registry.has(
            record.executionId,
          ),
        ).toBe(true);

        expect(
          registry.list(),
        ).toEqual([
          record,
        ]);
      },
    );

    it(
      "lists execution records by workflow identity",
      () => {
        const registry =
          new WorkflowExecutionRegistry();

        const first =
          createRecord(
            "execution-1",
            "workflow-shared",
          );

        const second =
          createRecord(
            "execution-2",
            "workflow-shared",
          );

        const other =
          createRecord(
            "execution-3",
            "workflow-other",
          );

        registry.register(first);
        registry.register(second);
        registry.register(other);

        expect(
          registry.listByWorkflowId(
            "workflow-shared",
          ),
        ).toEqual([
          first,
          second,
        ]);
      },
    );

    it(
      "rejects duplicate execution identities",
      () => {
        const registry =
          new WorkflowExecutionRegistry();

        registry.register(
          createRecord(),
        );

        expect(
          () =>
            registry.register(
              createRecord(),
            ),
        ).toThrow(
          "Workflow execution already registered: execution-registry-1",
        );
      },
    );
  },
);
