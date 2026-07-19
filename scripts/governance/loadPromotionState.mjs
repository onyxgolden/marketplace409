import fs from "node:fs";
import path from "node:path";

export const PROMOTION_AUTHORITY_STATES =
  Object.freeze([
    "human",
    "shadow-only",
    "eligible-for-review",
    "hybrid-control",
    "agent-controlled",
    "suspended",
  ]);

const defaultStatePath =
  "governance/state/promotion-state.json";

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

function assertNullableString(
  value,
  label,
) {
  if (
    value !== null &&
    (
      typeof value !== "string" ||
      value.trim().length === 0
    )
  ) {
    throw new TypeError(
      `${label} must be null or a non-empty string`,
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

function assertSupportedAuthorityState(
  value,
  label,
) {
  assertNonEmptyString(
    value,
    label,
  );

  if (
    !PROMOTION_AUTHORITY_STATES.includes(
      value,
    )
  ) {
    throw new Error(
      `${label} is unsupported: ${value}`,
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
      "Promotion state must remain inside the repository",
    );
  }

  return {
    absolutePath,
    relativePath,
  };
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

function validatePromotionDocument(
  document,
  documentName,
) {
  const location =
    `state.documents.${documentName}`;

  assertPlainObject(
    document,
    location,
  );

  assertSupportedAuthorityState(
    document.state,
    `${location}.state`,
  );

  assertNonNegativeInteger(
    document.successfulTrials,
    `${location}.successfulTrials`,
  );

  assertPlainObject(
    document.sections,
    `${location}.sections`,
  );

  const normalizedSections = {};

  for (
    const [
      sectionName,
      authorityState,
    ]
    of Object.entries(
      document.sections,
    )
  ) {
    assertNonEmptyString(
      sectionName,
      `${location}.sections section name`,
    );

    assertSupportedAuthorityState(
      authorityState,
      `${location}.sections.${sectionName}`,
    );

    normalizedSections[
      sectionName
    ] = authorityState;
  }

  return {
    state:
      document.state,

    successfulTrials:
      document.successfulTrials,

    sections:
      normalizedSections,
  };
}

export function validatePromotionState(
  state,
) {
  assertPlainObject(
    state,
    "state",
  );

  assertNonEmptyString(
    state.version,
    "state.version",
  );

  assertNullableString(
    state.lastUpdated,
    "state.lastUpdated",
  );

  assertNonEmptyString(
    state.updatedBy,
    "state.updatedBy",
  );

  assertSupportedAuthorityState(
    state.defaultAuthority,
    "state.defaultAuthority",
  );

  if (
    state.defaultAuthority !== "human"
  ) {
    throw new Error(
      "state.defaultAuthority must remain human",
    );
  }

  assertNonNegativeInteger(
    state.trialCount,
    "state.trialCount",
  );

  assertPlainObject(
    state.documents,
    "state.documents",
  );

  const documentEntries =
    Object.entries(
      state.documents,
    );

  if (
    documentEntries.length === 0
  ) {
    throw new Error(
      "state.documents must contain at least one promotion document",
    );
  }

  const normalizedDocuments = {};

  for (
    const [
      documentName,
      document,
    ]
    of documentEntries
  ) {
    assertNonEmptyString(
      documentName,
      "state.documents document name",
    );

    normalizedDocuments[
      documentName
    ] = validatePromotionDocument(
      document,
      documentName,
    );
  }

  assertStringArray(
    state.rules,
    "state.rules",
  );

  return deepFreeze({
    version:
      state.version,

    lastUpdated:
      state.lastUpdated,

    updatedBy:
      state.updatedBy,

    defaultAuthority:
      state.defaultAuthority,

    trialCount:
      state.trialCount,

    documents:
      normalizedDocuments,

    rules: [
      ...state.rules,
    ],
  });
}

export function loadPromotionState(
  suppliedPath = defaultStatePath,
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
      `Promotion state does not exist: ${relativePath}`,
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
      `Promotion state could not be read: ${relativePath}: ${error.message}`,
    );
  }

  let state;

  try {
    state =
      JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Promotion state is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }

  return validatePromotionState(
    state,
  );
}
