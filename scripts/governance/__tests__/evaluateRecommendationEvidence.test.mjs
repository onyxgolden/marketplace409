import {
  describe,
  expect,
  test,
} from "vitest";

import {
  includesReviewRequired,
  validationPassed,
} from "../evaluateRecommendationEvidence.mjs";

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

describe(
  "evaluateRecommendationEvidence",
  () => {
    test(
      "finds REVIEW_REQUIRED recursively",
      () => {
        expect(
          includesReviewRequired({
            activePhase: {
              identifier:
                "REVIEW_REQUIRED",
            },
          }),
        ).toBe(true);

        expect(
          includesReviewRequired({
            activePhase: {
              identifier: "15.4",
            },
          }),
        ).toBe(false);
      },
    );

    test(
      "accepts canonical passing validation statuses",
      () => {
        for (
          const status
          of [
            "pass",
            "passed",
            "passing",
          ]
        ) {
          expect(
            validationPassed(
              createValidationEvidence(
                status,
              ),
            ),
          ).toBe(true);
        }
      },
    );

    test(
      "rejects incomplete validation evidence",
      () => {
        expect(
          validationPassed(
            createValidationEvidence(
              "not-run",
            ),
          ),
        ).toBe(false);
      },
    );

    test(
      "supports evaluator-specific accepted statuses",
      () => {
        expect(
          validationPassed(
            createValidationEvidence(
              "passing",
            ),
            {
              location:
                "governanceState.validation",
              acceptedStatuses: [
                "pass",
                "passed",
              ],
            },
          ),
        ).toBe(false);

        expect(
          validationPassed(
            createValidationEvidence(
              "passed",
            ),
            {
              location:
                "governanceState.validation",
              acceptedStatuses: [
                "pass",
                "passed",
              ],
            },
          ),
        ).toBe(true);
      },
    );

    test(
      "rejects malformed validation entries",
      () => {
        expect(
          () =>
            validationPassed({
              focusedTests: null,
              fullTests: {
                status: "passed",
              },
              productionBuild: {
                status: "passed",
              },
            }),
        ).toThrow(
          "validationEvidence entry 0 must be an object",
        );
      },
    );
  },
);
