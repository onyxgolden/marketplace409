import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkflowRecoveryRecommendation,
} from "../index.js";

function createFailure(
  failureType,
  overrides = {},
) {
  return Object.freeze({
    workflowId:
      "workflow-recovery",
    correlationId:
      "correlation-recovery",
    failureType,
    capability:
      "repository.inspect",
    managerIdentity:
      "repository-intelligence-manager",
    reason:
      "Execution failed.",
    ...overrides,
  });
}

describe(
  "WorkflowRecoveryRecommendation",
  () => {
    it(
      "recommends authority recovery for governance rejection",
      () => {
        const recommendations =
          new WorkflowRecoveryRecommendation()
            .recommend([
              createFailure(
                "governance-rejection",
                {
                  capability: null,
                  managerIdentity: null,
                },
              ),
            ]);

        expect(
          recommendations[0],
        ).toEqual({
          workflowId:
            "workflow-recovery",
          correlationId:
            "correlation-recovery",
          failureType:
            "governance-rejection",
          capability: null,
          managerIdentity: null,
          action:
            "request-authority",
          priority:
            "high",
          reason:
            "Workflow execution requires an approved authority decision.",
        });
      },
    );

    it(
      "maps known failures to deterministic recovery actions",
      () => {
        const recommendations =
          new WorkflowRecoveryRecommendation()
            .recommend([
              createFailure(
                "validation-failure",
              ),
              createFailure(
                "evidence-failure",
              ),
              createFailure(
                "lifecycle-interruption",
              ),
              createFailure(
                "repository-unavailable",
              ),
              createFailure(
                "manager-execution-failure",
              ),
            ]);

        expect(
          recommendations.map(
            (recommendation) =>
              recommendation.action,
          ),
        ).toEqual([
          "rerun-validation",
          "reproduce-evidence",
          "resume-or-rebuild-workflow",
          "reinspect-repository",
          "retry-capability",
        ]);
      },
    );

    it(
      "falls back to manual review for unknown failures",
      () => {
        const recommendations =
          new WorkflowRecoveryRecommendation()
            .recommend([
              createFailure(
                "unknown-failure",
              ),
            ]);

        expect(
          recommendations[0],
        ).toMatchObject({
          action:
            "manual-review",
          priority:
            "medium",
        });
      },
    );

    it(
      "returns immutable recommendations",
      () => {
        const recommendations =
          new WorkflowRecoveryRecommendation()
            .recommend([
              createFailure(
                "validation-failure",
              ),
            ]);

        expect(
          Object.isFrozen(
            recommendations,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            recommendations[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "returns an empty collection for no failures",
      () => {
        expect(
          new WorkflowRecoveryRecommendation()
            .recommend([]),
        ).toEqual([]);
      },
    );

    it(
      "rejects unsupported sources",
      () => {
        expect(
          () =>
            new WorkflowRecoveryRecommendation()
              .recommend({}),
        ).toThrow(
          "WorkflowRecoveryRecommendation requires a failure array.",
        );
      },
    );
  },
);
