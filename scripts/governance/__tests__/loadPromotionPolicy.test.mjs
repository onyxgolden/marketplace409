import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  loadPromotionPolicy,
  PROMOTION_STATES,
  validatePromotionPolicy,
} from "../loadPromotionPolicy.mjs";

const temporaryDirectories =
  new Set();

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-promotion-policy-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  fs.mkdirSync(
    path.join(
      repositoryRoot,
      "governance",
      "policies",
    ),
    {
      recursive: true,
    },
  );

  return repositoryRoot;
}

function createValidPolicy(
  overrides = {},
) {
  return {
    version: "1.0",
    description:
      "Test promotion policy.",
    defaultAuthority:
      "human",
    minimumSuccessfulTrials:
      3,
    promotionScope:
      "section",
    requirements: {
      protectedContentMutations:
        0,
      inventedCompletionClaims:
        0,
      unsupportedArchitecturalClaims:
        0,
      authoritativeDocumentMutations:
        0,
      criticalFactualErrors:
        0,
      incompleteWorkMarkedComplete:
        0,
      successfulTrialSessions:
        3,
      explicitOwnerApproval:
        true,
    },
    requiredTrialTypes: [
      "completed implementation session",
      "documentation-only or corrective session",
      "incomplete or failed-validation session",
    ],
    evaluationCriteria: [
      "factual_accuracy",
      "repository_evidence_traceability",
    ],
    promotionStates: [
      ...PROMOTION_STATES,
    ],
    documentDefaults: {
      "FORGE_SYNC_STATUS.md":
        "shadow-only",
    },
    failureRules: [
      {
        condition:
          "critical-factual-error",
        result:
          "shadow-only",
        resetTrialCount:
          true,
      },
    ],
    rules: [
      "No promotion may occur automatically.",
    ],
    ...overrides,
  };
}

function writePolicy(
  repositoryRoot,
  policy,
) {
  const policyPath =
    path.join(
      repositoryRoot,
      "governance",
      "policies",
      "promotion-policy.json",
    );

  fs.writeFileSync(
    policyPath,
    `${JSON.stringify(
      policy,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return policyPath;
}

afterEach(() => {
  for (
    const temporaryDirectory
    of temporaryDirectories
  ) {
    fs.rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryDirectories.clear();
});

describe(
  "validatePromotionPolicy",
  () => {
    test(
      "accepts and deeply freezes a valid promotion policy",
      () => {
        const policy =
          validatePromotionPolicy(
            createValidPolicy(),
          );

        expect(
          policy.version,
        ).toBe("1.0");

        expect(
          policy.minimumSuccessfulTrials,
        ).toBe(3);

        expect(
          Object.isFrozen(
            policy,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            policy.requirements,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            policy.requiredTrialTypes,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            policy.failureRules,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            policy.failureRules[0],
          ),
        ).toBe(true);
      },
    );

    test(
      "rejects a non-human default authority",
      () => {
        expect(() =>
          validatePromotionPolicy(
            createValidPolicy({
              defaultAuthority:
                "agent-controlled",
            }),
          ),
        ).toThrow(
          "policy.defaultAuthority must remain human",
        );
      },
    );

    test(
      "rejects a non-section promotion scope",
      () => {
        expect(() =>
          validatePromotionPolicy(
            createValidPolicy({
              promotionScope:
                "document",
            }),
          ),
        ).toThrow(
          "policy.promotionScope must remain section",
        );
      },
    );

    test(
      "rejects disabled explicit owner approval",
      () => {
        const policy =
          createValidPolicy();

        policy.requirements
          .explicitOwnerApproval =
          false;

        expect(() =>
          validatePromotionPolicy(
            policy,
          ),
        ).toThrow(
          "policy.requirements.explicitOwnerApproval must remain true",
        );
      },
    );

    test(
      "rejects a negative numeric requirement",
      () => {
        const policy =
          createValidPolicy();

        policy.requirements
          .criticalFactualErrors =
          -1;

        expect(() =>
          validatePromotionPolicy(
            policy,
          ),
        ).toThrow(
          "policy.requirements.criticalFactualErrors must be a non-negative integer",
        );
      },
    );

    test(
      "rejects duplicate promotion states",
      () => {
        const promotionStates = [
          ...PROMOTION_STATES,
        ];

        promotionStates[
          promotionStates.length - 1
        ] = "shadow-only";

        expect(() =>
          validatePromotionPolicy(
            createValidPolicy({
              promotionStates,
            }),
          ),
        ).toThrow(
          "policy.promotionStates must contain every supported promotion state exactly once",
        );
      },
    );

    test(
      "rejects an unsupported document default",
      () => {
        expect(() =>
          validatePromotionPolicy(
            createValidPolicy({
              documentDefaults: {
                "FORGE_SYNC_STATUS.md":
                  "unsupported-state",
              },
            }),
          ),
        ).toThrow(
          "policy.documentDefaults.FORGE_SYNC_STATUS.md is unsupported: unsupported-state",
        );
      },
    );

    test(
      "rejects an unsupported failure result",
      () => {
        expect(() =>
          validatePromotionPolicy(
            createValidPolicy({
              failureRules: [
                {
                  condition:
                    "test-failure",
                  result:
                    "unsupported-state",
                  resetTrialCount:
                    true,
                },
              ],
            }),
          ),
        ).toThrow(
          "policy.failureRules[0].result is unsupported: unsupported-state",
        );
      },
    );
  },
);

describe(
  "loadPromotionPolicy",
  () => {
    test(
      "loads and validates the repository promotion policy",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        writePolicy(
          repositoryRoot,
          createValidPolicy(),
        );

        const policy =
          loadPromotionPolicy(
            undefined,
            {
              repositoryRoot,
            },
          );

        expect(
          policy.version,
        ).toBe("1.0");

        expect(
          policy.promotionStates,
        ).toEqual(
          PROMOTION_STATES,
        );

        expect(
          Object.isFrozen(
            policy,
          ),
        ).toBe(true);
      },
    );

    test(
      "rejects a path outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadPromotionPolicy(
            "../promotion-policy.json",
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Promotion policy must remain inside the repository",
        );
      },
    );

    test(
      "reports a missing promotion policy",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadPromotionPolicy(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Promotion policy does not exist: governance/policies/promotion-policy.json",
        );
      },
    );

    test(
      "reports invalid JSON",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const policyPath =
          path.join(
            repositoryRoot,
            "governance",
            "policies",
            "promotion-policy.json",
          );

        fs.writeFileSync(
          policyPath,
          "{ invalid json",
          "utf8",
        );

        expect(() =>
          loadPromotionPolicy(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Promotion policy is not valid JSON",
        );
      },
    );

    test(
      "rejects invalid supplied paths and repository roots",
      () => {
        expect(() =>
          loadPromotionPolicy(
            "",
          ),
        ).toThrow(
          "suppliedPath must be a non-empty string",
        );

        expect(() =>
          loadPromotionPolicy(
            undefined,
            {
              repositoryRoot:
                "",
            },
          ),
        ).toThrow(
          "repositoryRoot must be a non-empty string",
        );
      },
    );
  },
);
