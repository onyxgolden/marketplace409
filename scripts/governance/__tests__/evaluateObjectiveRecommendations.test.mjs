import {
  describe,
  expect,
  test,
} from "vitest";

import {
  evaluateObjectiveRecommendations,
} from "../evaluateObjectiveRecommendations.mjs";

function createGovernanceState({
  reviewRequired = true,
} = {}) {
  return {
    state: {
      activePhase: {
        identifier:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "15.2",
        title:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "Objective Recommendation Engine",
        status: "incomplete",
      },
      currentObjective:
        reviewRequired
          ? "REVIEW_REQUIRED"
          : "Implement objective recommendations",
      nextSession: {
        objective:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "Continue Phase 15.2",
        startingInspection:
          reviewRequired
            ? "REVIEW_REQUIRED"
            : "Inspect objective evidence",
      },
    },
  };
}

function createRepositoryEvidence({
  workingTreeClean = true,
  headMatchesOriginMain = true,
} = {}) {
  return {
    workingTreeClean,
    headMatchesOriginMain,
  };
}

function createValidationEvidence(
  status = "passed",
) {
  return {
    focusedTests: {
      status,
    },
    fullTests: {
      status,
    },
    productionBuild: {
      status,
    },
  };
}

function createArchitecturalProgress({
  completedPhaseIdentifiers = [
    "15.1",
  ],
} = {}) {
  return {
    completedPhaseIdentifiers,
  };
}

function createRoadmapPosition({
  nextPhaseIdentifier = "15.2",
} = {}) {
  return {
    nextPhaseIdentifier,
  };
}

function createCapabilitiesPolicy({
  selectNextObjective = false,
} = {}) {
  return {
    version: "1.0",
    capabilities: {
      selectNextObjective,
    },
  };
}

function createCandidates() {
  return [
    {
      phaseIdentifier: "15.2",
      title:
        "Deterministic Objective Recommendation Engine",
      objective:
        "Generate advisory next-objective recommendations from deterministic repository and governance evidence.",
      prerequisites: [
        "15.1",
      ],
    },
    {
      phaseIdentifier: "16.0",
      title:
        "Future Governance Capability",
      objective:
        "Perform a later governance capability.",
      prerequisites: [
        "15.2",
      ],
    },
  ];
}

function evaluate(overrides = {}) {
  return evaluateObjectiveRecommendations({
    governanceState:
      createGovernanceState(),
    repositoryEvidence:
      createRepositoryEvidence(),
    validationEvidence:
      createValidationEvidence(),
    architecturalProgress:
      createArchitecturalProgress(),
    roadmapPosition:
      createRoadmapPosition(),
    capabilitiesPolicy:
      createCapabilitiesPolicy(),
    candidateObjectives:
      createCandidates(),
    ...overrides,
  });
}

describe(
  "evaluateObjectiveRecommendations",
  () => {
    test(
      "blocks recommendations when repository or validation evidence is incomplete",
      () => {
        const result = evaluate({
          repositoryEvidence:
            createRepositoryEvidence({
              workingTreeClean: false,
              headMatchesOriginMain:
                false,
            }),
          validationEvidence:
            createValidationEvidence(
              "not-run",
            ),
        });

        expect(
          result.summary
            .recommendationCount,
        ).toBe(0);

        const phase152 =
          result.candidates.find(
            (candidate) =>
              candidate
                .phaseIdentifier ===
              "15.2",
          );

        expect(
          phase152.reasons.map(
            (reason) =>
              reason.code,
          ),
        ).toEqual(
          expect.arrayContaining([
            "working-tree-not-clean",
            "head-does-not-match-origin-main",
            "validation-not-passed",
          ]),
        );
      },
    );

    test(
      "recommends only the roadmap-aligned candidate with completed prerequisites",
      () => {
        const result = evaluate();

        expect(
          result.summary,
        ).toEqual({
          candidateCount: 2,
          recommendationCount: 1,
          blockedCandidateCount: 1,
        });

        expect(
          result.recommendations,
        ).toEqual([
          {
            phaseIdentifier: "15.2",
            title:
              "Deterministic Objective Recommendation Engine",
            objective:
              "Generate advisory next-objective recommendations from deterministic repository and governance evidence.",
            confidence: "high",
            requiresOwnerApproval: true,
          },
        ]);

        expect(
          result.selectedObjective,
        ).toBeNull();

        expect(
          result.authorityBoundary,
        ).toBe(
          "Recommendations do not select or commit objectives. Human approval remains required.",
        );
      },
    );

    test(
      "blocks recommendations when the selection capability boundary is not preserved",
      () => {
        const result = evaluate({
          capabilitiesPolicy:
            createCapabilitiesPolicy({
              selectNextObjective: true,
            }),
        });

        expect(
          result.summary
            .recommendationCount,
        ).toBe(0);

        expect(
          result.candidates[0]
            .reasons,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code:
                "objective-selection-boundary-invalid",
            }),
          ]),
        );
      },
    );

    test(
      "blocks candidates whose architectural prerequisites are incomplete",
      () => {
        const result = evaluate({
          architecturalProgress:
            createArchitecturalProgress({
              completedPhaseIdentifiers:
                [],
            }),
        });

        const phase152 =
          result.candidates.find(
            (candidate) =>
              candidate
                .phaseIdentifier ===
              "15.2",
          );

        expect(
          phase152.recommended,
        ).toBe(false);

        expect(
          phase152.reasons,
        ).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              code:
                "architectural-prerequisites-incomplete",
              missingPrerequisites: [
                "15.1",
              ],
            }),
          ]),
        );
      },
    );

    test(
      "does not mutate any evaluator input",
      () => {
        const inputs = {
          governanceState:
            createGovernanceState(),
          repositoryEvidence:
            createRepositoryEvidence(),
          validationEvidence:
            createValidationEvidence(),
          architecturalProgress:
            createArchitecturalProgress(),
          roadmapPosition:
            createRoadmapPosition(),
          capabilitiesPolicy:
            createCapabilitiesPolicy(),
          candidateObjectives:
            createCandidates(),
        };

        const before =
          JSON.stringify(inputs);

        evaluateObjectiveRecommendations(
          inputs,
        );

        expect(
          JSON.stringify(inputs),
        ).toBe(before);
      },
    );
  },
);
