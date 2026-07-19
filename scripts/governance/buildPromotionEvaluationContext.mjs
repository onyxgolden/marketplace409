import path from "node:path";

import {
  loadPromotionPolicy,
} from "./loadPromotionPolicy.mjs";

import {
  loadPromotionState,
} from "./loadPromotionState.mjs";

import {
  loadGovernanceState,
} from "./loadGovernanceState.mjs";

const defaultPromotionPolicyPath =
  "governance/policies/promotion-policy.json";

const defaultPromotionStatePath =
  "governance/state/promotion-state.json";

const defaultGovernanceStatePath =
  "governance/state/current-governance-state.json";

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

function assertFunction(
  value,
  label,
) {
  if (
    typeof value !== "function"
  ) {
    throw new TypeError(
      `${label} must be a function`,
    );
  }
}

function deepFreeze(
  value,
) {
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
    deepFreeze(
      nestedValue,
    );
  }

  return value;
}

function normalizeRepositoryEvidence(
  repositoryEvidence,
  governanceState,
) {
  const suppliedEvidence =
    repositoryEvidence ??
    governanceState.repository;

  assertPlainObject(
    suppliedEvidence,
    "repositoryEvidence",
  );

  if (
    typeof suppliedEvidence
      .workingTreeClean !== "boolean"
  ) {
    throw new TypeError(
      "repositoryEvidence.workingTreeClean must be a boolean",
    );
  }

  if (
    typeof suppliedEvidence
      .headMatchesOriginMain !== "boolean"
  ) {
    throw new TypeError(
      "repositoryEvidence.headMatchesOriginMain must be a boolean",
    );
  }

  return {
    workingTreeClean:
      suppliedEvidence
        .workingTreeClean,

    headMatchesOriginMain:
      suppliedEvidence
        .headMatchesOriginMain,
  };
}

function normalizeValidationEntry(
  entry,
  location,
) {
  assertPlainObject(
    entry,
    location,
  );

  assertNonEmptyString(
    entry.status,
    `${location}.status`,
  );

  return {
    ...entry,
  };
}

function normalizeValidationEvidence(
  validationEvidence,
  governanceState,
) {
  const suppliedEvidence =
    validationEvidence ??
    governanceState.validation;

  assertPlainObject(
    suppliedEvidence,
    "validationEvidence",
  );

  return {
    focusedTests:
      normalizeValidationEntry(
        suppliedEvidence.focusedTests,
        "validationEvidence.focusedTests",
      ),

    fullTests:
      normalizeValidationEntry(
        suppliedEvidence.fullTests,
        "validationEvidence.fullTests",
      ),

    productionBuild:
      normalizeValidationEntry(
        suppliedEvidence.productionBuild,
        "validationEvidence.productionBuild",
      ),
  };
}

function normalizeEvaluationEvidence(
  evaluationEvidence,
) {
  if (
    evaluationEvidence === undefined
  ) {
    return undefined;
  }

  assertPlainObject(
    evaluationEvidence,
    "evaluationEvidence",
  );

  return {
    ...evaluationEvidence,

    trialTypes:
      Array.isArray(
        evaluationEvidence.trialTypes,
      )
        ? [
            ...evaluationEvidence
              .trialTypes,
          ]
        : evaluationEvidence
            .trialTypes,

    failures:
      evaluationEvidence.failures &&
      typeof evaluationEvidence
        .failures === "object" &&
      !Array.isArray(
        evaluationEvidence.failures,
      )
        ? {
            ...evaluationEvidence
              .failures,
          }
        : evaluationEvidence
            .failures,
  };
}

export function buildPromotionEvaluationContext({
  repositoryRoot =
    process.cwd(),

  promotionPolicyPath =
    defaultPromotionPolicyPath,

  promotionStatePath =
    defaultPromotionStatePath,

  governanceStatePath =
    defaultGovernanceStatePath,

  repositoryEvidence,

  validationEvidence,

  evaluationEvidence,

  loadPromotionPolicyFn =
    loadPromotionPolicy,

  loadPromotionStateFn =
    loadPromotionState,

  loadGovernanceStateFn =
    loadGovernanceState,
} = {}) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  assertNonEmptyString(
    promotionPolicyPath,
    "promotionPolicyPath",
  );

  assertNonEmptyString(
    promotionStatePath,
    "promotionStatePath",
  );

  assertNonEmptyString(
    governanceStatePath,
    "governanceStatePath",
  );

  assertFunction(
    loadPromotionPolicyFn,
    "loadPromotionPolicyFn",
  );

  assertFunction(
    loadPromotionStateFn,
    "loadPromotionStateFn",
  );

  assertFunction(
    loadGovernanceStateFn,
    "loadGovernanceStateFn",
  );

  const normalizedRepositoryRoot =
    path.resolve(
      repositoryRoot,
    );

  const promotionPolicy =
    loadPromotionPolicyFn(
      promotionPolicyPath,
      {
        repositoryRoot:
          normalizedRepositoryRoot,
      },
    );

  const promotionState =
    loadPromotionStateFn(
      promotionStatePath,
      {
        repositoryRoot:
          normalizedRepositoryRoot,
      },
    );

  const governanceState =
    loadGovernanceStateFn(
      governanceStatePath,
      {
        repositoryRoot:
          normalizedRepositoryRoot,
      },
    );

  assertPlainObject(
    promotionPolicy,
    "promotionPolicy",
  );

  assertPlainObject(
    promotionState,
    "promotionState",
  );

  assertPlainObject(
    governanceState,
    "governanceState",
  );

  const context = {
    promotionPolicy,

    promotionState,

    governanceState,

    repositoryEvidence:
      normalizeRepositoryEvidence(
        repositoryEvidence,
        governanceState,
      ),

    validationEvidence:
      normalizeValidationEvidence(
        validationEvidence,
        governanceState,
      ),
  };

  const normalizedEvaluationEvidence =
    normalizeEvaluationEvidence(
      evaluationEvidence,
    );

  if (
    normalizedEvaluationEvidence !==
    undefined
  ) {
    context.evaluationEvidence =
      normalizedEvaluationEvidence;
  }

  return deepFreeze(
    context,
  );
}
