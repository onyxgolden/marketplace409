import {
  describe,
  expect,
  test,
} from "vitest";

import {
  buildPromotionRecommendations,
} from "../buildEvaluationSections.mjs";

function createPromotionEvaluation() {
  return {
    recommendations: [],
    authorityBoundary:
      "Recommendations do not modify authority. Only the owner may approve promotion.",
  };
}

function createObjectiveEvaluation({
  recommendations = [],
  selectedObjective = null,
} = {}) {
  return {
    recommendations,
    selectedObjective,
    authorityBoundary:
      "Recommendations do not select or commit objectives. Human approval remains required.",
  };
}

describe(
  "objective recommendation rendering",
  () => {
    test(
      "renders an advisory objective recommendation inside the existing governed section",
      () => {
        const content =
          buildPromotionRecommendations(
            createPromotionEvaluation(),
            createObjectiveEvaluation({
              recommendations: [
                {
                  phaseIdentifier:
                    "15.2",
                  title:
                    "Deterministic Objective Recommendation Engine",
                  objective:
                    "Generate advisory next-objective recommendations from deterministic evidence.",
                  confidence:
                    "high",
                  requiresOwnerApproval:
                    true,
                },
              ],
            }),
          );

        expect(content).toContain(
          "### Objective Recommendations",
        );

        expect(content).toContain(
          "Phase 15.2 — Deterministic Objective Recommendation Engine",
        );

        expect(content).toContain(
          "Confidence: `high`",
        );

        expect(content).toContain(
          "owner approval remains required",
        );

        expect(content).toContain(
          "Recommendations do not select or commit objectives.",
        );
      },
    );

    test(
      "renders the deterministic empty state when no objective recommendation exists",
      () => {
        const content =
          buildPromotionRecommendations(
            createPromotionEvaluation(),
            createObjectiveEvaluation(),
          );

        expect(content).toContain(
          "No objective recommendations have been made.",
        );
      },
    );

    test(
      "rejects any evaluation that claims an objective was selected",
      () => {
        expect(() =>
          buildPromotionRecommendations(
            createPromotionEvaluation(),
            createObjectiveEvaluation({
              selectedObjective: {
                phaseIdentifier:
                  "15.2",
              },
            }),
          ),
        ).toThrow(
          "objectiveEvaluation.selectedObjective must remain null",
        );
      },
    );
  },
);
