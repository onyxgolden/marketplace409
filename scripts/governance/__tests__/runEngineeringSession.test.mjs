import path from "node:path";

import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  ENGINEERING_SESSION_ORDER,
  ENGINEERING_SESSION_VERSION,
  runEngineeringSession,
} from "../runEngineeringSession.mjs";

function createDependencies({
  executionOrder = [],
} = {}) {
  const repositoryResult = {
    branch:
      "main",

    head:
      "aaaaaaaa",

    originMain:
      "aaaaaaaa",

    headMatchesOriginMain:
      true,

    workingTreeClean:
      false,

    modifiedFiles: [
      "example.txt",
    ],

    gitStatus: [
      " M example.txt",
    ],
  };

  const governanceResult = {
    mode:
      "shadow",

    status:
      "completed",

    snapshotPath:
      "governance/snapshots/forge-session-20260811-153000123.json",
  };

  const promotionResult = {
    eligible:
      false,

    recommendations: [],
  };

  const evolutionReadinessResult = {
    status:
      "review-required",

    eligible:
      false,

    requiresHumanApproval:
      true,

    reasons: [],
  };

  const evolutionDecisionResult = {
    decision:
      "EVOLUTION_BLOCKED",

    eligible:
      false,

    requiresHumanApproval:
      true,

    blockers: [],

    requiredActions: [],
  };

  const evolutionReviewContextResult = {
    status:
      "review-ready",
  };

  const conversationResult = {
    schemaVersion:
      "1.0",

    bootstrapPrompt:
      "FORGE bootstrap",
  };

  return {
    results: {
      repositoryResult,
      governanceResult,
      promotionResult,
      evolutionReadinessResult,
      evolutionDecisionResult,
      evolutionReviewContextResult,
      conversationResult,
    },

    inspectRepositoryFn:
      vi.fn(
        () => {
          executionOrder.push(
            "repositoryInspection",
          );

          return repositoryResult;
        },
      ),

    runGovernancePipelineFn:
      vi.fn(
        () => {
          executionOrder.push(
            "governancePipeline",
          );

          return governanceResult;
        },
      ),

    buildPromotionEvaluationContextFn:
      vi.fn(
        ({
          repositoryEvidence,
          evaluationEvidence,
        }) => ({
          promotionPolicy: {
            version: "1.0",
          },

          promotionState: {},

          governanceState: {},

          repositoryEvidence,

          validationEvidence: {},

          evaluationEvidence,
        }),
      ),

    evaluatePromotionEligibilityFn:
      vi.fn(
        () => {
          executionOrder.push(
            "promotionEvaluation",
          );

          return promotionResult;
        },
      ),

    evaluateGovernanceEvolutionReadinessFn:
      vi.fn(
        () => {
          executionOrder.push(
            "evolutionReadiness",
          );

          return evolutionReadinessResult;
        },
      ),

    evaluateGovernanceEvolutionDecisionFn:
      vi.fn(
        () => {
          executionOrder.push(
            "evolutionDecision",
          );

          return evolutionDecisionResult;
        },
      ),

    buildEvolutionReviewContextFn:
      vi.fn(
        () => {
          executionOrder.push(
            "evolutionReviewContext",
          );

          return evolutionReviewContextResult;
        },
      ),

    runConversationPreparationFn:
      vi.fn(
        () => {
          executionOrder.push(
            "conversationPreparation",
          );

          return conversationResult;
        },
      ),
  };
}

describe(
  "runEngineeringSession",
  () => {
    test(
      "executes the canonical engineering stages in deterministic order, with exactly one governance/evidence-collecting stage",
      () => {
        const executionOrder = [];

        const dependencies =
          createDependencies({
            executionOrder,
          });

        const result =
          runEngineeringSession({
            repositoryRoot:
              "/tmp/forge-repository",

            governancePipelineOptions: {
              mode:
                "shadow",

              validationEvidencePath:
                "governance/validation/evidence.json",
            },

            promotionEvaluationEvidence: {
              promotionPolicy: {},
              promotionState: {},
              governanceState: {},
              repositoryEvidence: {},
              validationEvidence: {},
            },

            conversationPreparationOptions: {
              conversationStateOptions: {
                repositoryRoot:
                  "/tmp/forge-repository",
              },
            },

            inspectRepositoryFn:
              dependencies
                .inspectRepositoryFn,

            runGovernancePipelineFn:
              dependencies
                .runGovernancePipelineFn,

            buildPromotionEvaluationContextFn:
              dependencies
                .buildPromotionEvaluationContextFn,

            evaluatePromotionEligibilityFn:
              dependencies
                .evaluatePromotionEligibilityFn,

            evaluateGovernanceEvolutionReadinessFn:
              dependencies
                .evaluateGovernanceEvolutionReadinessFn,

            evaluateGovernanceEvolutionDecisionFn:
              dependencies
                .evaluateGovernanceEvolutionDecisionFn,

            buildEvolutionReviewContextFn:
              dependencies
                .buildEvolutionReviewContextFn,

            runConversationPreparationFn:
              dependencies
                .runConversationPreparationFn,
          });

        expect(
          executionOrder,
        ).toEqual(
          ENGINEERING_SESSION_ORDER,
        );

        expect(ENGINEERING_SESSION_ORDER).not.toContain(
          "sessionEvidence",
        );

        expect(
          dependencies.runGovernancePipelineFn,
        ).toHaveBeenCalledTimes(1);

        expect(
          result.executionOrder,
        ).toEqual(
          ENGINEERING_SESSION_ORDER,
        );

        expect(
          result.version,
        ).toBe(
          ENGINEERING_SESSION_VERSION,
        );

        expect(
          result.status,
        ).toBe(
          "completed",
        );

        expect(
          result.repository,
        ).toBe(
          dependencies.results
            .repositoryResult,
        );

        expect(
          result.governance,
        ).toBe(
          dependencies.results
            .governanceResult,
        );

        expect(
          result.evidence,
        ).toEqual({
          status: "completed",
          snapshotPath:
            "governance/snapshots/forge-session-20260811-153000123.json",
        });

        expect(
          result.promotion,
        ).toBe(
          dependencies.results
            .promotionResult,
        );

        expect(
          result.evolutionReadiness,
        ).toBe(
          dependencies.results
            .evolutionReadinessResult,
        );

        expect(
          result.evolutionReviewContext,
        ).toBe(
          dependencies.results
            .evolutionReviewContextResult,
        );

        expect(
          result.conversation,
        ).toBe(
          dependencies.results
            .conversationResult,
        );
      },
    );

    test(
      "passes normalized repository and stage options to dependencies, deriving evidence from governance's own result",
      () => {
        const dependencies =
          createDependencies();

        const repositoryRoot =
          "./temporary-repository";

        const governancePipelineOptions = {
          mode:
            "hybrid",

          validationEvidencePath:
            "governance/validation/evidence.json",
        };

        const promotionEvaluationOptions = {
          promotionPolicy: {
            version:
              "1.0",
          },

          promotionState: {},
          governanceState: {},
          repositoryEvidence: {},
          validationEvidence: {},
        };

        const conversationPreparationOptions = {
          conversationStateOptions: {
            currentObjective:
              "Phase 15.13",
          },
        };

        runEngineeringSession({
          repositoryRoot,
          governancePipelineOptions,
          promotionEvaluationOptions,
          conversationPreparationOptions,

          inspectRepositoryFn:
            dependencies
              .inspectRepositoryFn,

          runGovernancePipelineFn:
            dependencies
              .runGovernancePipelineFn,

          buildPromotionEvaluationContextFn:
            dependencies
              .buildPromotionEvaluationContextFn,

          evaluatePromotionEligibilityFn:
            dependencies
              .evaluatePromotionEligibilityFn,

          evaluateGovernanceEvolutionReadinessFn:
            dependencies
              .evaluateGovernanceEvolutionReadinessFn,

          evaluateGovernanceEvolutionDecisionFn:
            dependencies
              .evaluateGovernanceEvolutionDecisionFn,

          buildEvolutionReviewContextFn:
            dependencies
              .buildEvolutionReviewContextFn,

          runConversationPreparationFn:
            dependencies
              .runConversationPreparationFn,
        });

        const normalizedRepositoryRoot =
          path.resolve(
            repositoryRoot,
          );

        expect(
          dependencies
            .inspectRepositoryFn,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            normalizedRepositoryRoot,
        });

        expect(
          dependencies
            .runGovernancePipelineFn,
        ).toHaveBeenCalledWith({
          ...governancePipelineOptions,
          reviewedMetadataPath: null,
        });

        expect(
          dependencies
            .buildPromotionEvaluationContextFn,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            normalizedRepositoryRoot,

          repositoryEvidence:
            dependencies.results
              .repositoryResult,

          evaluationEvidence:
            undefined,
        });

        expect(
          dependencies
            .evaluatePromotionEligibilityFn,
        ).toHaveBeenCalledWith({
          promotionPolicy: {
            version:
              "1.0",
          },

          promotionState: {},

          governanceState: {},

          repositoryEvidence:
            dependencies.results
              .repositoryResult,

          validationEvidence: {},

          evaluationEvidence:
            undefined,
        });

        expect(
          dependencies
            .buildEvolutionReviewContextFn,
        ).toHaveBeenCalledWith({
          repositoryEvidence:
            dependencies.results
              .repositoryResult,

          governanceState:
            dependencies.results
              .governanceResult,

          validationEvidence: {
            status: "completed",
            snapshotPath:
              "governance/snapshots/forge-session-20260811-153000123.json",
          },

          promotionEvaluation:
            dependencies.results
              .promotionResult,

          evolutionReadiness:
            dependencies.results
              .evolutionReadinessResult,

          evolutionDecision:
            dependencies.results
              .evolutionDecisionResult,
        });

        expect(
          dependencies
            .runConversationPreparationFn,
        ).toHaveBeenCalledWith({
          ...conversationPreparationOptions,

          engineeringState: {
            repository:
              dependencies.results
                .repositoryResult,

            evolutionReadiness:
              dependencies.results
                .evolutionReadinessResult,

            evolutionReviewContext:
              dependencies.results
                .evolutionReviewContextResult,
          },
        });
      },
    );

    test(
      "automatically assembles and evaluates promotion context when evaluation evidence is absent",
      () => {
        const executionOrder = [];

        const dependencies =
          createDependencies({
            executionOrder,
          });

        const result =
          runEngineeringSession({
            repositoryRoot:
              "/tmp/forge-repository",

            inspectRepositoryFn:
              dependencies
                .inspectRepositoryFn,

            runGovernancePipelineFn:
              dependencies
                .runGovernancePipelineFn,

            buildPromotionEvaluationContextFn:
              dependencies
                .buildPromotionEvaluationContextFn,

            evaluatePromotionEligibilityFn:
              dependencies
                .evaluatePromotionEligibilityFn,

            evaluateGovernanceEvolutionReadinessFn:
              dependencies
                .evaluateGovernanceEvolutionReadinessFn,

            evaluateGovernanceEvolutionDecisionFn:
              dependencies
                .evaluateGovernanceEvolutionDecisionFn,

            buildEvolutionReviewContextFn:
              dependencies
                .buildEvolutionReviewContextFn,

            runConversationPreparationFn:
              dependencies
                .runConversationPreparationFn,
          });

        expect(
          dependencies
            .buildPromotionEvaluationContextFn,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            "/tmp/forge-repository",

          repositoryEvidence:
            dependencies.results
              .repositoryResult,

          evaluationEvidence:
            undefined,
        });

        expect(
          dependencies
            .evaluatePromotionEligibilityFn,
        ).toHaveBeenCalled();

        expect(
          executionOrder,
        ).toEqual(
          ENGINEERING_SESSION_ORDER,
        );

        expect(
          result.promotion,
        ).toBe(
          dependencies.results
            .promotionResult,
        );

      },
    );

    test(
      "propagates failures and stops all later stages",
      () => {
        const executionOrder = [];

        const dependencies =
          createDependencies({
            executionOrder,
          });

        const governanceFailure =
          new Error(
            "Governance pipeline failed.",
          );

        dependencies
          .runGovernancePipelineFn
          .mockImplementation(
            () => {
              executionOrder.push(
                "governancePipeline",
              );

              throw governanceFailure;
            },
          );

        expect(
          () =>
            runEngineeringSession({
              repositoryRoot:
                "/tmp/forge-repository",

              inspectRepositoryFn:
                dependencies
                  .inspectRepositoryFn,

              runGovernancePipelineFn:
                dependencies
                  .runGovernancePipelineFn,

              buildPromotionEvaluationContextFn:
                dependencies
                  .buildPromotionEvaluationContextFn,

              evaluatePromotionEligibilityFn:
                dependencies
                  .evaluatePromotionEligibilityFn,

              runConversationPreparationFn:
                dependencies
                  .runConversationPreparationFn,
            }),
        ).toThrow(
          governanceFailure,
        );

        expect(
          executionOrder,
        ).toEqual([
          "repositoryInspection",
          "governancePipeline",
        ]);

        expect(
          dependencies
            .evaluatePromotionEligibilityFn,
        ).not.toHaveBeenCalled();

        expect(
          dependencies
            .runConversationPreparationFn,
        ).not.toHaveBeenCalled();
      },
    );

    test(
      "deeply freezes the engineering session result, including the derived evidence",
      () => {
        const dependencies =
          createDependencies();

        const result =
          runEngineeringSession({
            repositoryRoot:
              "/tmp/forge-repository",

            inspectRepositoryFn:
              dependencies
                .inspectRepositoryFn,

            runGovernancePipelineFn:
              dependencies
                .runGovernancePipelineFn,

            buildPromotionEvaluationContextFn:
              dependencies
                .buildPromotionEvaluationContextFn,

            evaluatePromotionEligibilityFn:
              dependencies
                .evaluatePromotionEligibilityFn,

            evaluateGovernanceEvolutionReadinessFn:
              dependencies
                .evaluateGovernanceEvolutionReadinessFn,

            buildEvolutionReviewContextFn:
              dependencies
                .buildEvolutionReviewContextFn,

            runConversationPreparationFn:
              dependencies
                .runConversationPreparationFn,
          });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.executionOrder,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.repository,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.repository
              .modifiedFiles,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.governance,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.evidence,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.promotion,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.conversation,
          ),
        ).toBe(true);
      },
    );

    test(
      "derives a non-completed evidence status without throwing when governance yields no result (e.g. locked mode)",
      () => {
        const dependencies =
          createDependencies();

        dependencies.runGovernancePipelineFn =
          vi.fn(() => undefined);

        const result =
          runEngineeringSession({
            repositoryRoot:
              "/tmp/forge-repository",

            inspectRepositoryFn:
              dependencies
                .inspectRepositoryFn,

            runGovernancePipelineFn:
              dependencies
                .runGovernancePipelineFn,

            buildPromotionEvaluationContextFn:
              dependencies
                .buildPromotionEvaluationContextFn,

            evaluatePromotionEligibilityFn:
              dependencies
                .evaluatePromotionEligibilityFn,

            evaluateGovernanceEvolutionReadinessFn:
              dependencies
                .evaluateGovernanceEvolutionReadinessFn,

            evaluateGovernanceEvolutionDecisionFn:
              dependencies
                .evaluateGovernanceEvolutionDecisionFn,

            buildEvolutionReviewContextFn:
              dependencies
                .buildEvolutionReviewContextFn,

            runConversationPreparationFn:
              dependencies
                .runConversationPreparationFn,
          });

        expect(result.evidence).toEqual({
          status: "not-completed",
          snapshotPath: null,
        });
      },
    );

    test.each([
      [
        "inspectRepositoryFn",
        "inspectRepositoryFn",
      ],
      [
        "runGovernancePipelineFn",
        "runGovernancePipelineFn",
      ],
      [
        "evaluatePromotionEligibilityFn",
        "evaluatePromotionEligibilityFn",
      ],
      [
        "runConversationPreparationFn",
        "runConversationPreparationFn",
      ],
    ])(
      "rejects an invalid %s dependency",
      (
        dependencyName,
        expectedLabel,
      ) => {
        const dependencies =
          createDependencies();

        dependencies[
          dependencyName
        ] = null;

        expect(
          () =>
            runEngineeringSession({
              repositoryRoot:
                "/tmp/forge-repository",

              inspectRepositoryFn:
                dependencies
                  .inspectRepositoryFn,

              runGovernancePipelineFn:
                dependencies
                  .runGovernancePipelineFn,

              buildPromotionEvaluationContextFn:
                dependencies
                  .buildPromotionEvaluationContextFn,

              evaluatePromotionEligibilityFn:
                dependencies
                  .evaluatePromotionEligibilityFn,

              runConversationPreparationFn:
                dependencies
                  .runConversationPreparationFn,
            }),
        ).toThrow(
          `${expectedLabel} must be a function`,
        );
      },
    );
  },
);

describe("runEngineeringSession reviewedMetadataPath threading", () => {
  test("passes a supplied reviewedMetadataPath through to runGovernancePipelineFn, not to a second collector", () => {
    const runGovernancePipelineFn = vi.fn(() => ({
      status: "completed",
      snapshotPath: "governance/snapshots/forge-session-20260811-153000123.json",
    }));

    const inspectRepositoryFn = vi.fn(() => ({
      repositoryRoot: "/tmp/repo",
      branch: "main",
      head: "a".repeat(40),
      originMain: "a".repeat(40),
      headMatchesOriginMain: true,
      workingTreeClean: true,
      modifiedFiles: [],
      gitStatus: [],
    }));

    const buildPromotionEvaluationContextFn = vi.fn(() => ({}));
    const evaluatePromotionEligibilityFn = vi.fn(() => ({}));
    const evaluateGovernanceEvolutionReadinessFn = vi.fn(() => ({}));
    const evaluateGovernanceEvolutionDecisionFn = vi.fn(() => ({}));
    const buildEvolutionReviewContextFn = vi.fn(() => ({}));
    const runConversationPreparationFn = vi.fn(() => ({}));

    runEngineeringSession({
      repositoryRoot: "/tmp/repo",
      reviewedMetadataPath: "/tmp/reviewed-metadata.json",
      inspectRepositoryFn,
      runGovernancePipelineFn,
      buildPromotionEvaluationContextFn,
      evaluatePromotionEligibilityFn,
      evaluateGovernanceEvolutionReadinessFn,
      evaluateGovernanceEvolutionDecisionFn,
      buildEvolutionReviewContextFn,
      runConversationPreparationFn,
    });

    expect(runGovernancePipelineFn).toHaveBeenCalledWith({
      reviewedMetadataPath: "/tmp/reviewed-metadata.json",
    });

    expect(runGovernancePipelineFn).toHaveBeenCalledTimes(1);
  });

  test("defaults reviewedMetadataPath to null when not supplied", () => {
    const runGovernancePipelineFn = vi.fn(() => ({
      status: "completed",
      snapshotPath: null,
    }));

    const inspectRepositoryFn = vi.fn(() => ({
      repositoryRoot: "/tmp/repo",
      branch: "main",
      head: "a".repeat(40),
      originMain: "a".repeat(40),
      headMatchesOriginMain: true,
      workingTreeClean: true,
      modifiedFiles: [],
      gitStatus: [],
    }));

    const buildPromotionEvaluationContextFn = vi.fn(() => ({}));
    const evaluatePromotionEligibilityFn = vi.fn(() => ({}));
    const evaluateGovernanceEvolutionReadinessFn = vi.fn(() => ({}));
    const evaluateGovernanceEvolutionDecisionFn = vi.fn(() => ({}));
    const buildEvolutionReviewContextFn = vi.fn(() => ({}));
    const runConversationPreparationFn = vi.fn(() => ({}));

    runEngineeringSession({
      repositoryRoot: "/tmp/repo",
      inspectRepositoryFn,
      runGovernancePipelineFn,
      buildPromotionEvaluationContextFn,
      evaluatePromotionEligibilityFn,
      evaluateGovernanceEvolutionReadinessFn,
      evaluateGovernanceEvolutionDecisionFn,
      buildEvolutionReviewContextFn,
      runConversationPreparationFn,
    });

    expect(runGovernancePipelineFn).toHaveBeenCalledWith({
      reviewedMetadataPath: null,
    });
  });
});
