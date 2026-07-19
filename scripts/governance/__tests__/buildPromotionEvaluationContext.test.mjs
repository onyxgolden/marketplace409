import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  buildPromotionEvaluationContext,
} from "../buildPromotionEvaluationContext.mjs";

function createPromotionPolicy() {
  return {
    version: "1.0",
    minimumSuccessfulTrials: 3,
  };
}

function createPromotionState() {
  return {
    version: "1.0",
    trialCount: 0,
    documents: {
      "FORGE_SYNC_STATUS.md": {
        state: "shadow-only",
      },
    },
  };
}

function createGovernanceState() {
  return {
    repository: {
      workingTreeClean: false,
      headMatchesOriginMain: true,
    },

    validation: {
      focusedTests: {
        status: "passing",
        testFiles: 2,
        tests: 12,
      },

      fullTests: {
        status: "not-run",
      },

      productionBuild: {
        status: "passing",
      },
    },
  };
}

function createDependencies() {
  const promotionPolicy =
    createPromotionPolicy();

  const promotionState =
    createPromotionState();

  const governanceState =
    createGovernanceState();

  return {
    promotionPolicy,

    promotionState,

    governanceState,

    loadPromotionPolicyFn:
      vi.fn(() =>
        promotionPolicy,
      ),

    loadPromotionStateFn:
      vi.fn(() =>
        promotionState,
      ),

    loadGovernanceStateFn:
      vi.fn(() =>
        governanceState,
      ),
  };
}

describe(
  "buildPromotionEvaluationContext",
  () => {
    test(
      "loads and assembles the complete promotion evaluation context",
      () => {
        const dependencies =
          createDependencies();

        const context =
          buildPromotionEvaluationContext({
            repositoryRoot:
              "/tmp/forge-repository",

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          });

        expect(
          context,
        ).toEqual({
          promotionPolicy:
            dependencies
              .promotionPolicy,

          promotionState:
            dependencies
              .promotionState,

          governanceState:
            dependencies
              .governanceState,

          repositoryEvidence: {
            workingTreeClean:
              false,

            headMatchesOriginMain:
              true,
          },

          validationEvidence: {
            focusedTests: {
              status:
                "passing",

              testFiles:
                2,

              tests:
                12,
            },

            fullTests: {
              status:
                "not-run",
            },

            productionBuild: {
              status:
                "passing",
            },
          },
        });

        expect(
          dependencies
            .loadPromotionPolicyFn,
        ).toHaveBeenCalledWith(
          "governance/policies/promotion-policy.json",
          {
            repositoryRoot:
              "/tmp/forge-repository",
          },
        );

        expect(
          dependencies
            .loadPromotionStateFn,
        ).toHaveBeenCalledWith(
          "governance/state/promotion-state.json",
          {
            repositoryRoot:
              "/tmp/forge-repository",
          },
        );

        expect(
          dependencies
            .loadGovernanceStateFn,
        ).toHaveBeenCalledWith(
          "governance/state/current-governance-state.json",
          {
            repositoryRoot:
              "/tmp/forge-repository",
          },
        );
      },
    );

    test(
      "supports custom canonical file paths",
      () => {
        const dependencies =
          createDependencies();

        buildPromotionEvaluationContext({
          repositoryRoot:
            "/tmp/forge-repository",

          promotionPolicyPath:
            "custom/promotion-policy.json",

          promotionStatePath:
            "custom/promotion-state.json",

          governanceStatePath:
            "custom/governance-state.json",

          loadPromotionPolicyFn:
            dependencies
              .loadPromotionPolicyFn,

          loadPromotionStateFn:
            dependencies
              .loadPromotionStateFn,

          loadGovernanceStateFn:
            dependencies
              .loadGovernanceStateFn,
        });

        expect(
          dependencies
            .loadPromotionPolicyFn,
        ).toHaveBeenCalledWith(
          "custom/promotion-policy.json",
          {
            repositoryRoot:
              "/tmp/forge-repository",
          },
        );

        expect(
          dependencies
            .loadPromotionStateFn,
        ).toHaveBeenCalledWith(
          "custom/promotion-state.json",
          {
            repositoryRoot:
              "/tmp/forge-repository",
          },
        );

        expect(
          dependencies
            .loadGovernanceStateFn,
        ).toHaveBeenCalledWith(
          "custom/governance-state.json",
          {
            repositoryRoot:
              "/tmp/forge-repository",
          },
        );
      },
    );

    test(
      "uses explicitly supplied repository evidence",
      () => {
        const dependencies =
          createDependencies();

        const context =
          buildPromotionEvaluationContext({
            repositoryEvidence: {
              workingTreeClean:
                true,

              headMatchesOriginMain:
                false,
            },

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          });

        expect(
          context
            .repositoryEvidence,
        ).toEqual({
          workingTreeClean:
            true,

          headMatchesOriginMain:
            false,
        });
      },
    );

    test(
      "uses explicitly supplied validation evidence",
      () => {
        const dependencies =
          createDependencies();

        const context =
          buildPromotionEvaluationContext({
            validationEvidence: {
              focusedTests: {
                status:
                  "failing",
              },

              fullTests: {
                status:
                  "passing",
              },

              productionBuild: {
                status:
                  "not-run",
              },
            },

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          });

        expect(
          context
            .validationEvidence,
        ).toEqual({
          focusedTests: {
            status:
              "failing",
          },

          fullTests: {
            status:
              "passing",
          },

          productionBuild: {
            status:
              "not-run",
          },
        });
      },
    );

    test(
      "includes normalized evaluation evidence when supplied",
      () => {
        const dependencies =
          createDependencies();

        const evaluationEvidence = {
          trialType:
            "completed implementation session",

          trialTypes: [
            "completed implementation session",
            "documentation-only or corrective session",
          ],

          failures: {
            criticalFactualErrors:
              0,

            incompleteWorkMarkedComplete:
              0,
          },

          explicitOwnerApproval:
            false,
        };

        const context =
          buildPromotionEvaluationContext({
            evaluationEvidence,

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          });

        expect(
          context
            .evaluationEvidence,
        ).toEqual(
          evaluationEvidence,
        );

        expect(
          context
            .evaluationEvidence,
        ).not.toBe(
          evaluationEvidence,
        );

        expect(
          context
            .evaluationEvidence
            .trialTypes,
        ).not.toBe(
          evaluationEvidence
            .trialTypes,
        );

        expect(
          context
            .evaluationEvidence
            .failures,
        ).not.toBe(
          evaluationEvidence
            .failures,
        );
      },
    );

    test(
      "omits evaluation evidence when none is supplied",
      () => {
        const dependencies =
          createDependencies();

        const context =
          buildPromotionEvaluationContext({
            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          });

        expect(
          Object.hasOwn(
            context,
            "evaluationEvidence",
          ),
        ).toBe(false);
      },
    );

    test(
      "deeply freezes the assembled context",
      () => {
        const dependencies =
          createDependencies();

        const context =
          buildPromotionEvaluationContext({
            evaluationEvidence: {
              trialTypes: [
                "completed implementation session",
              ],

              failures: {
                criticalFactualErrors:
                  0,
              },
            },

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          });

        expect(
          Object.isFrozen(
            context,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .promotionPolicy,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .promotionState,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .governanceState,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .repositoryEvidence,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .validationEvidence,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .validationEvidence
              .focusedTests,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .evaluationEvidence,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .evaluationEvidence
              .trialTypes,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            context
              .evaluationEvidence
              .failures,
          ),
        ).toBe(true);
      },
    );

    test(
      "rejects invalid repository evidence",
      () => {
        const dependencies =
          createDependencies();

        expect(() =>
          buildPromotionEvaluationContext({
            repositoryEvidence: {
              workingTreeClean:
                "yes",

              headMatchesOriginMain:
                true,
            },

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          }),
        ).toThrow(
          "repositoryEvidence.workingTreeClean must be a boolean",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            repositoryEvidence: {
              workingTreeClean:
                true,

              headMatchesOriginMain:
                "yes",
            },

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          }),
        ).toThrow(
          "repositoryEvidence.headMatchesOriginMain must be a boolean",
        );
      },
    );

    test(
      "rejects invalid validation evidence",
      () => {
        const dependencies =
          createDependencies();

        expect(() =>
          buildPromotionEvaluationContext({
            validationEvidence: {
              focusedTests: {
                status:
                  "",
              },

              fullTests: {
                status:
                  "passing",
              },

              productionBuild: {
                status:
                  "passing",
              },
            },

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          }),
        ).toThrow(
          "validationEvidence.focusedTests.status must be a non-empty string",
        );
      },
    );

    test(
      "rejects invalid evaluation evidence",
      () => {
        const dependencies =
          createDependencies();

        expect(() =>
          buildPromotionEvaluationContext({
            evaluationEvidence:
              [],

            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          }),
        ).toThrow(
          "evaluationEvidence must be an object",
        );
      },
    );

    test(
      "rejects invalid paths, repository roots, and dependencies",
      () => {
        expect(() =>
          buildPromotionEvaluationContext({
            repositoryRoot:
              "",
          }),
        ).toThrow(
          "repositoryRoot must be a non-empty string",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            promotionPolicyPath:
              "",
          }),
        ).toThrow(
          "promotionPolicyPath must be a non-empty string",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            promotionStatePath:
              "",
          }),
        ).toThrow(
          "promotionStatePath must be a non-empty string",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            governanceStatePath:
              "",
          }),
        ).toThrow(
          "governanceStatePath must be a non-empty string",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            loadPromotionPolicyFn:
              null,
          }),
        ).toThrow(
          "loadPromotionPolicyFn must be a function",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            loadPromotionStateFn:
              null,
          }),
        ).toThrow(
          "loadPromotionStateFn must be a function",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            loadGovernanceStateFn:
              null,
          }),
        ).toThrow(
          "loadGovernanceStateFn must be a function",
        );
      },
    );

    test(
      "rejects invalid loader results",
      () => {
        const dependencies =
          createDependencies();

        expect(() =>
          buildPromotionEvaluationContext({
            loadPromotionPolicyFn:
              () => null,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          }),
        ).toThrow(
          "promotionPolicy must be an object",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              () => [],

            loadGovernanceStateFn:
              dependencies
                .loadGovernanceStateFn,
          }),
        ).toThrow(
          "promotionState must be an object",
        );

        expect(() =>
          buildPromotionEvaluationContext({
            loadPromotionPolicyFn:
              dependencies
                .loadPromotionPolicyFn,

            loadPromotionStateFn:
              dependencies
                .loadPromotionStateFn,

            loadGovernanceStateFn:
              () => null,
          }),
        ).toThrow(
          "governanceState must be an object",
        );
      },
    );
  },
);
