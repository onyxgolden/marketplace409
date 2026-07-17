import fs from "node:fs";
import path from "node:path";

export const GOVERNANCE_MODES = Object.freeze([
  "locked",
  "shadow",
  "hybrid",
  "authoritative",
]);

const defaultConfigurationPath =
  "governance/config/governance-mode.json";

function assertNonEmptyString(value, label) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string`,
    );
  }
}

function assertPlainObject(value, label) {
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

function normalizeRepositoryPath(
  repositoryRoot,
  suppliedPath,
) {
  const absolutePath = path.resolve(
    repositoryRoot,
    suppliedPath,
  );

  const relativePath = path.relative(
    repositoryRoot,
    absolutePath,
  );

  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      "Governance mode configuration must remain inside the repository",
    );
  }

  return {
    absolutePath,
    relativePath,
  };
}

function assertAllowedModes(allowedModes) {
  if (!Array.isArray(allowedModes)) {
    throw new TypeError(
      "Governance mode allowedModes must be an array",
    );
  }

  if (
    allowedModes.length !==
    GOVERNANCE_MODES.length
  ) {
    throw new Error(
      "Governance mode allowedModes must contain every supported mode exactly once",
    );
  }

  const uniqueModes =
    new Set(allowedModes);

  if (
    uniqueModes.size !==
    GOVERNANCE_MODES.length
  ) {
    throw new Error(
      "Governance mode allowedModes may not contain duplicates",
    );
  }

  for (const mode of GOVERNANCE_MODES) {
    if (!uniqueModes.has(mode)) {
      throw new Error(
        `Governance mode allowedModes is missing supported mode: ${mode}`,
      );
    }
  }

  for (const mode of uniqueModes) {
    if (!GOVERNANCE_MODES.includes(mode)) {
      throw new Error(
        `Governance mode allowedModes contains unsupported mode: ${mode}`,
      );
    }
  }
}

export function validateGovernanceModeConfiguration(
  configuration,
) {
  assertPlainObject(
    configuration,
    "Governance mode configuration",
  );

  if (configuration.version !== "1.0") {
    throw new Error(
      "Governance mode configuration version must be 1.0",
    );
  }

  assertNonEmptyString(
    configuration.mode,
    "Governance mode",
  );

  if (
    !GOVERNANCE_MODES.includes(
      configuration.mode,
    )
  ) {
    throw new Error(
      `Unsupported governance mode: ${configuration.mode}`,
    );
  }

  assertAllowedModes(
    configuration.allowedModes,
  );

  return Object.freeze({
    ...configuration,
    allowedModes: Object.freeze([
      ...configuration.allowedModes,
    ]),
  });
}

export function loadGovernanceMode(
  suppliedPath =
    defaultConfigurationPath,
  {
    repositoryRoot = process.cwd(),
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

  if (!fs.existsSync(absolutePath)) {
    throw new Error(
      `Governance mode configuration does not exist: ${relativePath}`,
    );
  }

  let content;

  try {
    content = fs.readFileSync(
      absolutePath,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `Governance mode configuration could not be read: ${relativePath}: ${error.message}`,
    );
  }

  let configuration;

  try {
    configuration = JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Governance mode configuration is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }

  return validateGovernanceModeConfiguration(
    configuration,
  );
}
