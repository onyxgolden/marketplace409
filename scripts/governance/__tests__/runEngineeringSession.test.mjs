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
  };

  const evidenceResult = {
    status:
      "completed",

    stdout:
      "Evidence collected.",

    stderr:
      "",
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
      evidenceResult,
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

    collectSessionEvidenceFn:
      vi.fn(
        () => {
          executionOrder.push(
            "sessionEvidence",
          );

          return evidenceResult;
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
      "executes the canonical engineering stages in deterministic order",
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

            collectSessionEvidenceFn:
              dependencies
                .collectSessionEvidenceFn,

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
        ).toBe(
          dependencies.results
            .evidenceResult,
        );

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
      "passes normalized repository and stage options to dependencies",
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

          collectSessionEvidenceFn:
            dependencies
              .collectSessionEvidenceFn,

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
        ).toHaveBeenCalledWith(
          governancePipelineOptions,
        );

        expect(
          dependencies
            .collectSessionEvidenceFn,
        ).toHaveBeenCalledWith({
          repositoryRoot:
            normalizedRepositoryRoot,
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

      validationEvidence:
        dependencies.results
          .evidenceResult,

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

            collectSessionEvidenceFn:
              dependencies
                .collectSessionEvidenceFn,

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

              collectSessionEvidenceFn:
                dependencies
                  .collectSessionEvidenceFn,

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
            .collectSessionEvidenceFn,
        ).not.toHaveBeenCalled();

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
      "deeply freezes the engineering session result",
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

            collectSessionEvidenceFn:
              dependencies
                .collectSessionEvidenceFn,

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
        "collectSessionEvidenceFn",
        "collectSessionEvidenceFn",
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

              collectSessionEvidenceFn:
                dependencies
                  .collectSessionEvidenceFn,

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
  test("passes a supplied reviewedMetadataPath through to collectSessionEvidenceFn", () => {
    const collectSessionEvidenceFn = vi.fn(() => ({
      status: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
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

    const runGovernancePipelineFn = vi.fn(() => ({}));
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
      collectSessionEvidenceFn,
      buildPromotionEvaluationContextFn,
      evaluatePromotionEligibilityFn,
      evaluateGovernanceEvolutionReadinessFn,
      evaluateGovernanceEvolutionDecisionFn,
      buildEvolutionReviewContextFn,
      runConversationPreparationFn,
    });

    expect(collectSessionEvidenceFn).toHaveBeenCalledWith({
      repositoryRoot: "/tmp/repo",
      reviewedMetadataPath: "/tmp/reviewed-metadata.json",
    });
  });

  test("defaults reviewedMetadataPath to null when not supplied", () => {
    const collectSessionEvidenceFn = vi.fn(() => ({
      status: "completed",
      exitCode: 0,
      stdout: "",
      stderr: "",
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

    const runGovernancePipelineFn = vi.fn(() => ({}));
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
      collectSessionEvidenceFn,
      buildPromotionEvaluationContextFn,
      evaluatePromotionEligibilityFn,
      evaluateGovernanceEvolutionReadinessFn,
      evaluateGovernanceEvolutionDecisionFn,
      buildEvolutionReviewContextFn,
      runConversationPreparationFn,
    });

    expect(collectSessionEvidenceFn).toHaveBeenCalledWith({
      repositoryRoot: "/tmp/repo",
      reviewedMetadataPath: null,
    });
  });
});
