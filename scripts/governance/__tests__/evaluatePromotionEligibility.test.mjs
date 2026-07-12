import {
  describe,
  expect,
  test,
} from "vitest";

import {
  evaluatePromotionEligibility,
} from "../evaluatePromotionEligibility.mjs";

const requiredTrialTypes = [
  "completed implementation session",
  "documentation-only or corrective session",
  "incomplete or failed-validation session",
];

function createPolicy() {
  return {
    version: "1.0",
    minimumSuccessfulTrials: 3,
    promotionScope: "section",
    requirements: {
      protectedContentMutations: 0,
      inventedCompletionClaims: 0,
      unsupportedArchitecturalClaims: 0,
      authoritativeDocumentMutations: 0,
      criticalFactualErrors: 0,
      incompleteWorkMarkedComplete: 0,
      successfulTrialSessions: 3,
      explicitOwnerApproval: true,
    },
    requiredTrialTypes,
  };
}

function createPromotionState({
  trialCount = 0,
  successfulTrials = 0,
  sections = {
    repository_state: "shadow-only",
    protected_rules: "human",
  },
} = {}) {
  return {
    version: "1.0",
    trialCount,
    documents: {
      "FORGE_SYNC_STATUS.md": {
        state: "shadow-only",
        successfulTrials,
        sections,
      },
    },
  };
}

function createGovernanceState({
  complete = false,
  validationStatus = "not-run",
  reviewRequired = true,
} = {}) {
  return {
    state: {
      activePhase: {
        identifier:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "15.1",
        title:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "Promotion Evaluation",
        status:
          complete
            ? "complete"
            : "incomplete",
      },
      currentObjective:
        reviewRequired
          ? "REVIEW_REQUIRED"
          : "Evaluate promotion eligibility",
      nextSession: {
        objective:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "Continue evaluation",
        startingInspection:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "Inspect evaluation evidence",
      },
    },
    validation: {
      focusedTests: {
        status: validationStatus,
      },
      fullTests: {
        status: validationStatus,
      },
      productionBuild: {
        status: validationStatus,
      },
    },
    completion: {
      workComplete: complete,
      supportedByEvidence: complete,
    },
  };
}

function createSuccessfulEvidence() {
  return {
    trialTypes: [
      ...requiredTrialTypes,
    ],
    failures: {
      protectedContentMutations: 0,
      inventedCompletionClaims: 0,
      unsupportedArchitecturalClaims: 0,
      authoritativeDocumentMutations: 0,
      criticalFactualErrors: 0,
      incompleteWorkMarkedComplete: 0,
    },
  };
}

describe(
  "evaluatePromotionEligibility",
  () => {
    test(
      "blocks promotion when recorded evidence is incomplete",
      () => {
        const result =
          evaluatePromotionEligibility({
            promotionPolicy:
              createPolicy(),
            promotionState:
              createPromotionState(),
            governanceState:
              createGovernanceState(),
          });

        expect(
          result.summary
            .eligibleSectionCount,
        ).toBe(0);

        const repositoryState =
          result.documents[0]
            .sections.find(
              (section) =>
                section.sectionName ===
                "repository_state",
            );

        expect(
          repositoryState
            .eligibleForReview,
        ).toBe(false);

        expect(
          repositoryState.reasons.map(
            (reason) =>
              reason.code,
          ),
        ).toEqual(
          expect.arrayContaining([
            "insufficient-recorded-trials",
            "insufficient-successful-trials",
            "completion-evidence-incomplete",
            "human-review-required",
            "validation-not-passed",
            "required-trial-types-missing",
          ]),
        );
      },
    );

    test(
      "recommends only eligible shadow sections",
      () => {
        const result =
          evaluatePromotionEligibility({
            promotionPolicy:
              createPolicy(),
            promotionState:
              createPromotionState({
                trialCount: 3,
                successfulTrials: 3,
              }),
            governanceState:
              createGovernanceState({
                complete: true,
                validationStatus:
                  "passed",
                reviewRequired: false,
              }),
            evaluationEvidence:
              createSuccessfulEvidence(),
          });

        expect(
          result.summary
            .eligibleSectionCount,
        ).toBe(1);

        expect(
          result.recommendations,
        ).toEqual([
          {
            documentName:
              "FORGE_SYNC_STATUS.md",
            sectionName:
              "repository_state",
            recommendedState:
              "eligible-for-review",
            requiresOwnerApproval:
              true,
          },
        ]);

        const protectedRules =
          result.documents[0]
            .sections.find(
              (section) =>
                section.sectionName ===
                "protected_rules",
            );

        expect(
          protectedRules
            .eligibleForReview,
        ).toBe(false);

        expect(
          protectedRules.reasons,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code:
                "human-controlled-section",
            }),
          ]),
        );
      },
    );

    test(
      "blocks eligibility when a failure threshold is exceeded",
      () => {
        const evidence =
          createSuccessfulEvidence();

        evidence.failures
          .protectedContentMutations = 1;

        const result =
          evaluatePromotionEligibility({
            promotionPolicy:
              createPolicy(),
            promotionState:
              createPromotionState({
                trialCount: 3,
                successfulTrials: 3,
              }),
            governanceState:
              createGovernanceState({
                complete: true,
                validationStatus:
                  "passed",
                reviewRequired: false,
              }),
            evaluationEvidence:
              evidence,
          });

        const repositoryState =
          result.documents[0]
            .sections.find(
              (section) =>
                section.sectionName ===
                "repository_state",
            );

        expect(
          repositoryState
            .eligibleForReview,
        ).toBe(false);

        expect(
          repositoryState.reasons,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code:
                "failure-threshold-exceeded",
              requirement:
                "protectedContentMutations",
              actual: 1,
            }),
          ]),
        );
      },
    );

    test(
      "does not mutate policy, state, governance, or evidence inputs",
      () => {
        const promotionPolicy =
          createPolicy();

        const promotionState =
          createPromotionState({
            trialCount: 3,
            successfulTrials: 3,
          });

        const governanceState =
          createGovernanceState({
            complete: true,
            validationStatus:
              "passed",
            reviewRequired: false,
          });

        const evaluationEvidence =
          createSuccessfulEvidence();

        const before =
          JSON.stringify({
            promotionPolicy,
            promotionState,
            governanceState,
            evaluationEvidence,
          });

        evaluatePromotionEligibility({
          promotionPolicy,
          promotionState,
          governanceState,
          evaluationEvidence,
        });

        expect(
          JSON.stringify({
            promotionPolicy,
            promotionState,
            governanceState,
            evaluationEvidence,
          }),
        ).toBe(before);
      },
    );
  },
);
