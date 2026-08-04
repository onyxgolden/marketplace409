import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowCapabilityMetrics,
} from "../index.js";

function createOutcome({
  capability,
  completionStatus,
  durationMilliseconds,
}) {
  return Object.freeze({
    payload: Object.freeze({
      capabilityInvoked:
        capability,
      completionStatus,
      timingInformation:
        Object.freeze({
          durationMilliseconds,
        }),
    }),
  });
}

function createResult(outcomes) {
  return Object.freeze({
    outcomes: Object.freeze([
      ...outcomes,
    ]),
  });
}

describe(
  "WorkflowCapabilityMetrics",
  () => {
    it(
      "calculates deterministic per-capability metrics",
      () => {
        const results = [
          createResult([
            createOutcome({
              capability:
                "planning.create",
              completionStatus:
                "completed",
              durationMilliseconds:
                10,
            }),
            createOutcome({
              capability:
                "repository.inspect",
              completionStatus:
                "completed",
              durationMilliseconds:
                20,
            }),
          ]),
          createResult([
            createOutcome({
              capability:
                "repository.inspect",
              completionStatus:
                "failed",
              durationMilliseconds:
                40,
            }),
          ]),
        ];

        const metrics =
          new WorkflowCapabilityMetrics()
            .analyze(results);

        expect(metrics).toEqual([
          {
            capability:
              "planning.create",
            executionCount: 1,
            successfulExecutions: 1,
            failedExecutions: 0,
            totalDurationMilliseconds: 10,
            successRate: 1,
            failureRate: 0,
            averageDurationMilliseconds: 10,
          },
          {
            capability:
              "repository.inspect",
            executionCount: 2,
            successfulExecutions: 1,
            failedExecutions: 1,
            totalDurationMilliseconds: 60,
            successRate: 0.5,
            failureRate: 0.5,
            averageDurationMilliseconds: 30,
          },
        ]);

        expect(
          Object.isFrozen(metrics),
        ).toBe(true);

        expect(
          Object.isFrozen(
            metrics[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "accepts a single workflow result",
      () => {
        const result =
          createResult([
            createOutcome({
              capability:
                "planning.create",
              completionStatus:
                "completed",
              durationMilliseconds:
                5,
            }),
          ]);

        const metrics =
          new WorkflowCapabilityMetrics()
            .analyze(result);

        expect(
          metrics[0].executionCount,
        ).toBe(1);
      },
    );

    it(
      "returns an empty collection for no outcomes",
      () => {
        const metrics =
          new WorkflowCapabilityMetrics()
            .analyze([]);

        expect(metrics).toEqual([]);
      },
    );

    it(
      "ignores outcomes without a capability identity",
      () => {
        const metrics =
          new WorkflowCapabilityMetrics()
            .analyze([
              createResult([
                {
                  payload: {
                    completionStatus:
                      "completed",
                  },
                },
              ]),
            ]);

        expect(metrics).toEqual([]);
      },
    );

    it(
      "rejects unsupported sources",
      () => {
        expect(
          () =>
            new WorkflowCapabilityMetrics()
              .analyze({}),
        ).toThrow(
          "WorkflowCapabilityMetrics requires workflow results or a result array.",
        );
      },
    );
  },
);
