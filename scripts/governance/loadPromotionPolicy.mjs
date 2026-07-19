import fs from "node:fs";
import path from "node:path";

export const PROMOTION_STATES =
  Object.freeze([
    "shadow-only",
    "eligible-for-review",
    "hybrid-control",
    "agent-controlled",
    "suspended",
  ]);

const defaultPolicyPath =
  "governance/policies/promotion-policy.json";

function assertPlainObject(
  value,
  label,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${label} must be an object`,
    );
  }
}

function assertNonEmptyString(
  value,
  label,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string`,
    );
  }
}

function assertNonNegativeInteger(
  value,
  label,
) {
  if (
    !Number.isInteger(value) ||
    value < 0
  ) {
    throw new TypeError(
      `${label} must be a non-negative integer`,
    );
  }
}

function assertBoolean(
  value,
  label,
) {
  if (typeof value !== "boolean") {
    throw new TypeError(
      `${label} must be a boolean`,
    );
  }
}

function assertStringArray(
  value,
  label,
) {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.trim().length === 0,
    )
  ) {
    throw new TypeError(
      `${label} must be an array of non-empty strings`,
    );
  }
}

function normalizeRepositoryPath(
  repositoryRoot,
  suppliedPath,
) {
  const absoluteRepositoryRoot =
    path.resolve(repositoryRoot);

  const absolutePath =
    path.resolve(
      absoluteRepositoryRoot,
      suppliedPath,
    );

  const relativePath =
    path.relative(
      absoluteRepositoryRoot,
      absolutePath,
    );

  if (
    relativePath === ".." ||
    relativePath.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "Promotion policy must remain inside the repository",
    );
  }

  return {
    absolutePath,
    relativePath,
  };
}

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (
    const nestedValue
    of Object.values(value)
  ) {
    deepFreeze(nestedValue);
  }

  return value;
}

export function validatePromotionPolicy(
  policy,
) {
  assertPlainObject(
    policy,
    "policy",
  );

  assertNonEmptyString(
    policy.version,
    "policy.version",
  );

  assertNonEmptyString(
    policy.description,
    "policy.description",
  );

  assertNonEmptyString(
    policy.defaultAuthority,
    "policy.defaultAuthority",
  );

  if (
    policy.defaultAuthority !== "human"
  ) {
    throw new Error(
      "policy.defaultAuthority must remain human",
    );
  }

  assertNonNegativeInteger(
    policy.minimumSuccessfulTrials,
    "policy.minimumSuccessfulTrials",
  );

  assertNonEmptyString(
    policy.promotionScope,
    "policy.promotionScope",
  );

  if (
    policy.promotionScope !== "section"
  ) {
    throw new Error(
      "policy.promotionScope must remain section",
    );
  }

  assertPlainObject(
    policy.requirements,
    "policy.requirements",
  );

  const numericRequirements = [
    "protectedContentMutations",
    "inventedCompletionClaims",
    "unsupportedArchitecturalClaims",
    "authoritativeDocumentMutations",
    "criticalFactualErrors",
    "incompleteWorkMarkedComplete",
    "successfulTrialSessions",
  ];

  for (
    const requirement
    of numericRequirements
  ) {
    assertNonNegativeInteger(
      policy.requirements[
        requirement
      ],
      `policy.requirements.${requirement}`,
    );
  }

  assertBoolean(
    policy.requirements
      .explicitOwnerApproval,
    "policy.requirements.explicitOwnerApproval",
  );

  if (
    policy.requirements
      .explicitOwnerApproval !== true
  ) {
    throw new Error(
      "policy.requirements.explicitOwnerApproval must remain true",
    );
  }

  assertStringArray(
    policy.requiredTrialTypes,
    "policy.requiredTrialTypes",
  );

  assertStringArray(
    policy.evaluationCriteria,
    "policy.evaluationCriteria",
  );

  assertStringArray(
    policy.promotionStates,
    "policy.promotionStates",
  );

  if (
    policy.promotionStates.length !==
      PROMOTION_STATES.length ||
    !PROMOTION_STATES.every(
      (state) =>
        policy.promotionStates.includes(
          state,
        ),
    )
  ) {
    throw new Error(
      "policy.promotionStates must contain every supported promotion state exactly once",
    );
  }

  if (
    new Set(
      policy.promotionStates,
    ).size !==
    policy.promotionStates.length
  ) {
    throw new Error(
      "policy.promotionStates may not contain duplicates",
    );
  }

  assertPlainObject(
    policy.documentDefaults,
    "policy.documentDefaults",
  );

  for (
    const [
      documentName,
      promotionState,
    ]
    of Object.entries(
      policy.documentDefaults,
    )
  ) {
    assertNonEmptyString(
      documentName,
      "policy.documentDefaults document name",
    );

    assertNonEmptyString(
      promotionState,
      `policy.documentDefaults.${documentName}`,
    );

    if (
      !PROMOTION_STATES.includes(
        promotionState,
      )
    ) {
      throw new Error(
        `policy.documentDefaults.${documentName} is unsupported: ${promotionState}`,
      );
    }
  }

  if (
    !Array.isArray(
      policy.failureRules,
    )
  ) {
    throw new TypeError(
      "policy.failureRules must be an array",
    );
  }

  const failureRules =
    policy.failureRules.map(
      (
        failureRule,
        index,
      ) => {
        const location =
          `policy.failureRules[${index}]`;

        assertPlainObject(
          failureRule,
          location,
        );

        assertNonEmptyString(
          failureRule.condition,
          `${location}.condition`,
        );

        assertNonEmptyString(
          failureRule.result,
          `${location}.result`,
        );

        if (
          !PROMOTION_STATES.includes(
            failureRule.result,
          )
        ) {
          throw new Error(
            `${location}.result is unsupported: ${failureRule.result}`,
          );
        }

        assertBoolean(
          failureRule.resetTrialCount,
          `${location}.resetTrialCount`,
        );

        return {
          condition:
            failureRule.condition,
          result:
            failureRule.result,
          resetTrialCount:
            failureRule.resetTrialCount,
        };
      },
    );

  assertStringArray(
    policy.rules,
    "policy.rules",
  );

  const normalizedPolicy = {
    version:
      policy.version,
    description:
      policy.description,
    defaultAuthority:
      policy.defaultAuthority,
    minimumSuccessfulTrials:
      policy.minimumSuccessfulTrials,
    promotionScope:
      policy.promotionScope,
    requirements: {
      ...policy.requirements,
    },
    requiredTrialTypes: [
      ...policy.requiredTrialTypes,
    ],
    evaluationCriteria: [
      ...policy.evaluationCriteria,
    ],
    promotionStates: [
      ...policy.promotionStates,
    ],
    documentDefaults: {
      ...policy.documentDefaults,
    },
    failureRules,
    rules: [
      ...policy.rules,
    ],
  };

  return deepFreeze(
    normalizedPolicy,
  );
}

export function loadPromotionPolicy(
  suppliedPath = defaultPolicyPath,
  {
    repositoryRoot =
      process.cwd(),
  } = {},
) {
  assertNonEmptyString(
    suppliedPath,
    "suppliedPath",
  );

  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  const {
    absolutePath,
    relativePath,
  } = normalizeRepositoryPath(
    repositoryRoot,
    suppliedPath,
  );

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    throw new Error(
      `Promotion policy does not exist: ${relativePath}`,
    );
  }

  let content;

  try {
    content =
      fs.readFileSync(
        absolutePath,
        "utf8",
      );
  } catch (error) {
    throw new Error(
      `Promotion policy could not be read: ${relativePath}: ${error.message}`,
    );
  }

  let policy;

  try {
    policy =
      JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Promotion policy is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }

  return validatePromotionPolicy(
    policy,
  );
}
