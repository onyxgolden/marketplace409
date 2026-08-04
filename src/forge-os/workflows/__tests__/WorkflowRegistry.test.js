import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowDefinition,
  WorkflowRegistry,
} from "../index.js";

function createDefinition(
  workflowId =
    "workflow-registry-1",
) {
  return new WorkflowDefinition({
    workflowId,
    correlationId:
      `${workflowId}.correlation`,
    objective:
      "Validate workflow registration",
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
}

describe(
  "WorkflowRegistry",
  () => {
    it(
      "registers and resolves workflow definitions",
      () => {
        const registry =
          new WorkflowRegistry();

        const definition =
          createDefinition();

        expect(
          registry.register(
            definition,
          ),
        ).toBe(definition);

        expect(
          registry.get(
            definition.workflowId,
          ),
        ).toBe(definition);

        expect(
          registry.has(
            definition.workflowId,
          ),
        ).toBe(true);

        expect(
          registry.list(),
        ).toEqual([
          definition,
        ]);
      },
    );

    it(
      "rejects duplicate workflow identities",
      () => {
        const registry =
          new WorkflowRegistry();

        registry.register(
          createDefinition(),
        );

        expect(
          () =>
            registry.register(
              createDefinition(),
            ),
        ).toThrow(
          "Workflow already registered: workflow-registry-1",
        );
      },
    );

    it(
      "rejects non-workflow definitions",
      () => {
        const registry =
          new WorkflowRegistry();

        expect(
          () =>
            registry.register({
              workflowId:
                "invalid-workflow",
            }),
        ).toThrow(
          "WorkflowRegistry requires a WorkflowDefinition.",
        );
      },
    );
  },
);
