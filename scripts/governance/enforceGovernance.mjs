import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  validateGovernanceArchitecture,
} from "./validateGovernanceArchitecture.mjs";
import {
  validateObjectivePolicy,
} from "./validateObjectivePolicy.mjs";
import {
  validateValidationEvidence,
} from "./validateValidationEvidence.mjs";
import {
  validateGovernanceState,
} from "./validateGovernanceState.mjs";
import {
  loadGovernanceState,
} from "./loadGovernanceState.mjs";

export const GOVERNANCE_ENFORCEMENT_VERSION =
  "1.0";

export const GOVERNANCE_VALIDATION_ORDER =
  Object.freeze([
    "governanceArchitecture",
    "objectivePolicy",
    "validationEvidence",
    "governanceState",
  ]);

const defaultPaths = Object.freeze({
  governanceState:
    "governance/state/current-governance-state.json",

  objectivePolicy:
    "governance/policies/objective-policy.json",

  capabilitiesPolicy:
    "governance/policies/capabilities.json",

  promotionState:
    "governance/state/promotion-state.json",

  editableSectionsPolicy:
    "governance/policies/editable-sections.json",
});

const defaultValidators = Object.freeze({
  governanceArchitecture:
    validateGovernanceArchitecture,

  objectivePolicy:
    validateObjectivePolicy,

  validationEvidence:
    validateValidationEvidence,

  governanceState:
    validateGovernanceState,
});

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

function normalizeRepositoryRoot(
  repositoryRoot,
) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  return path.resolve(
    repositoryRoot,
  );
}

function normalizeRepositoryPath(
  repositoryRoot,
  suppliedPath,
  label,
) {
  assertNonEmptyString(
    suppliedPath,
    label,
  );

  const absolutePath =
    path.resolve(
      repositoryRoot,
      suppliedPath,
    );

  const relativePath =
    path.relative(
      repositoryRoot,
      absolutePath,
    );

  if (
    relativePath === ".." ||
    relativePath.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(
      relativePath,
    )
  ) {
    throw new Error(
      `${label} must remain inside the repository`,
    );
  }

  return {
    absolutePath,
    relativePath:
      relativePath || ".",
  };
}

function readJson(
  repositoryRoot,
  suppliedPath,
  label,
) {
  const resolved =
    normalizeRepositoryPath(
      repositoryRoot,
      suppliedPath,
      `${label} path`,
    );

  if (
    !fs.existsSync(
      resolved.absolutePath,
    )
  ) {
    throw new Error(
      `${label} does not exist: ${resolved.relativePath}`,
    );
  }

  let content;

  try {
    content =
      fs.readFileSync(
        resolved.absolutePath,
        "utf8",
      );
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${resolved.relativePath}: ${error.message}`,
    );
  }

  try {
    return {
      value:
        JSON.parse(
          content,
        ),

      relativePath:
        resolved.relativePath,
    };
  } catch (error) {
    throw new Error(
      `${label} is not valid JSON: ${resolved.relativePath}: ${error.message}`,
    );
  }
}

function validateValidators(
  validators,
) {
  assertPlainObject(
    validators,
    "validators",
  );

  for (
    const validatorName
    of GOVERNANCE_VALIDATION_ORDER
  ) {
    if (
      typeof validators[
        validatorName
      ] !== "function"
    ) {
      throw new TypeError(
        `validators.${validatorName} must be a function`,
      );
    }
  }
}

function normalizePaths(
  paths,
) {
  assertPlainObject(
    paths,
    "paths",
  );

  const normalized = {
    ...defaultPaths,
    ...paths,
  };

  for (
    const [
      pathName,
      suppliedPath,
    ]
    of Object.entries(
      normalized,
    )
  ) {
    assertNonEmptyString(
      suppliedPath,
      `paths.${pathName}`,
    );
  }

  return normalized;
}

function deepFreeze(
  value,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(
      value,
    )
  ) {
    return value;
  }

  Object.freeze(
    value,
  );

  for (
    const nestedValue
    of Object.values(
      value,
    )
  ) {
    deepFreeze(
      nestedValue,
    );
  }

  return value;
}

export function enforceGovernance({
  repositoryRoot =
    process.cwd(),

  validationEvidencePath,

  paths = {},

  validators =
    defaultValidators,
} = {}) {
  const normalizedRepositoryRoot =
    normalizeRepositoryRoot(
      repositoryRoot,
    );

  assertNonEmptyString(
    validationEvidencePath,
    "validationEvidencePath",
  );

  validateValidators(
    validators,
  );

  const normalizedPaths =
    normalizePaths(
      paths,
    );

  const architectureResult =
    validators
      .governanceArchitecture({
        repositoryRoot:
          normalizedRepositoryRoot,
      });

  const objectivePolicy =
    readJson(
      normalizedRepositoryRoot,
      normalizedPaths
        .objectivePolicy,
      "Objective policy",
    );

  const capabilitiesPolicy =
    readJson(
      normalizedRepositoryRoot,
      normalizedPaths
        .capabilitiesPolicy,
      "Capabilities policy",
    );

  const objectivePolicyResult =
    validators
      .objectivePolicy(
        objectivePolicy.value,
        capabilitiesPolicy.value,
      );

  const validationEvidence =
    readJson(
      normalizedRepositoryRoot,
      validationEvidencePath,
      "Validation evidence",
    );

  const validationEvidenceResult =
    validators
      .validationEvidence(
        validationEvidence.value,
      );

  const governanceStateResolved =
    normalizeRepositoryPath(
      normalizedRepositoryRoot,
      normalizedPaths
        .governanceState,
      "Governance state path",
    );

  const governanceState =
    loadGovernanceState(
      governanceStateResolved
        .relativePath,
      {
        repositoryRoot:
          normalizedRepositoryRoot,
      },
    );

  const promotionState =
    readJson(
      normalizedRepositoryRoot,
      normalizedPaths
        .promotionState,
      "Promotion state",
    );

  const editableSectionsPolicy =
    readJson(
      normalizedRepositoryRoot,
      normalizedPaths
        .editableSectionsPolicy,
      "Editable-sections policy",
    );

  const sessionSnapshot =
    governanceState.session
      ?.latestSnapshot === null
      ? null
      : readJson(
          normalizedRepositoryRoot,
          governanceState.session
            ?.latestSnapshot,
          "Referenced session snapshot",
        ).value;

  const governanceStateResult =
    validators
      .governanceState(
        governanceState,
        {
          promotionState:
            promotionState.value,

          capabilitiesPolicy:
            capabilitiesPolicy.value,

          editableSectionsPolicy:
            editableSectionsPolicy.value,

          sessionSnapshot,
        },
      );

  return deepFreeze({
    version:
      GOVERNANCE_ENFORCEMENT_VERSION,

    valid:
      true,

    repositoryRoot:
      normalizedRepositoryRoot,

    validationEvidencePath:
      validationEvidence.relativePath,

    governanceStatePath:
      governanceStateResolved
        .relativePath,

    validationOrder: [
      ...GOVERNANCE_VALIDATION_ORDER,
    ],

    results: {
      governanceArchitecture:
        architectureResult,

      objectivePolicy:
        objectivePolicyResult,

      validationEvidence:
        validationEvidenceResult,

      governanceState:
        governanceStateResult,
    },
  });
}

function isDirectExecution() {
  const suppliedScriptPath =
    process.argv[1];

  if (!suppliedScriptPath) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      path.resolve(
        suppliedScriptPath,
      ),
    ).href
  );
}

if (isDirectExecution()) {
  const validationEvidencePath =
    process.argv[2];

  const governanceStatePath =
    process.argv[3];

  try {
    if (!validationEvidencePath) {
      throw new Error(
        "Usage: node scripts/governance/enforceGovernance.mjs <validation-evidence-path> [governance-state-path]",
      );
    }

    const result =
      enforceGovernance({
        validationEvidencePath,

        paths:
          governanceStatePath
            ? {
                governanceState:
                  governanceStatePath,
              }
            : {},
      });

    console.log(
      "GOVERNANCE ENFORCEMENT PASSED",
    );

    console.log(
      `Version: ${result.version}`,
    );

    console.log(
      `Validation evidence: ${result.validationEvidencePath}`,
    );

    console.log(
      `Governance state: ${result.governanceStatePath}`,
    );

    console.log(
      `Validation order: ${result.validationOrder.join(" -> ")}`,
    );
  } catch (error) {
    console.error(
      `GOVERNANCE ENFORCEMENT FAILED: ${error.message}`,
    );

    process.exitCode = 1;
  }
}
