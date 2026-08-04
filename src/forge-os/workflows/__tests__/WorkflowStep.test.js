import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowStep,
} from "../index.js";

describe(
  "WorkflowStep",
  () => {
    it(
      "creates a capability step",
      () => {
        const step =
          new WorkflowStep({
            stepId: "create-plan",
            capability:
              "planning.create",
          });

        expect(
          step.stepType,
        ).toBe("capability");

        expect(
          step.capability,
        ).toBe(
          "planning.create",
        );
      },
    );

    it(
      "creates a child workflow step",
      () => {
        const step =
          new WorkflowStep({
            stepId:
              "run-child",
            workflowId:
              "child-workflow",
          });

        expect(
          step.stepType,
        ).toBe("workflow");

        expect(
          step.workflowId,
        ).toBe(
          "child-workflow",
        );
      },
    );

    it(
      "rejects ambiguous step targets",
      () => {
        expect(
          () =>
            new WorkflowStep({
              stepId:
                "ambiguous",
              capability:
                "planning.create",
              workflowId:
                "child-workflow",
            }),
        ).toThrow(
          "WorkflowStep requires exactly one capability or workflowId.",
        );

        expect(
          () =>
            new WorkflowStep({
              stepId:
                "missing-target",
            }),
        ).toThrow(
          "WorkflowStep requires exactly one capability or workflowId.",
        );
      },
    );
  },
);
