import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultRepositoryRoot =
  process.cwd();

export const GOVERNANCE_ARCHITECTURE_VERSION =
  "1.0";

export const REQUIRED_GOVERNANCE_DOCUMENTS =
  Object.freeze([
    "docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md",
    "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
    "docs/architecture/FORGE_GOVERNANCE_TRACEABILITY.md",
    "docs/architecture/FORGE_ROADMAP.md",
    "docs/architecture/FORGE_SESSION.md",
    "docs/architecture/FORGE_STATUS.md",
  ]);

export const REQUIRED_GOVERNANCE_DIRECTORIES =
  Object.freeze([
    "docs/architecture",
    "docs/architecture/synchronized",
    "governance",
    "governance/config",
    "governance/policies",
    "governance/snapshots",
    "governance/state",
    "governance/validation",
    "scripts/governance",
    "scripts/governance/__tests__",
  ]);

function assertNonEmptyString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function assertStringArray(
  value,
  location,
) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${location} must be an array`,
    );
  }

  value.forEach(
    (item, index) => {
      assertNonEmptyString(
        item,
        `${location}[${index}]`,
      );
    },
  );
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

function resolveRepositoryPath(
  repositoryRoot,
  suppliedPath,
) {
  assertNonEmptyString(
    suppliedPath,
    "suppliedPath",
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
      `Governance architecture path must remain inside the repository: ${suppliedPath}`,
    );
  }

  return {
    absolutePath,
    relativePath:
      relativePath || ".",
  };
}

function validateRequiredFile(
  repositoryRoot,
  relativePath,
) {
  const resolved =
    resolveRepositoryPath(
      repositoryRoot,
      relativePath,
    );

  if (
    !fs.existsSync(
      resolved.absolutePath,
    )
  ) {
    throw new Error(
      `Required governance document does not exist: ${resolved.relativePath}`,
    );
  }

  const fileStatus =
    fs.statSync(
      resolved.absolutePath,
    );

  if (!fileStatus.isFile()) {
    throw new Error(
      `Required governance document is not a file: ${resolved.relativePath}`,
    );
  }

  return resolved.relativePath;
}

function validateRequiredDirectory(
  repositoryRoot,
  relativePath,
) {
  const resolved =
    resolveRepositoryPath(
      repositoryRoot,
      relativePath,
    );

  if (
    !fs.existsSync(
      resolved.absolutePath,
    )
  ) {
    throw new Error(
      `Required governance directory does not exist: ${resolved.relativePath}`,
    );
  }

  const fileStatus =
    fs.statSync(
      resolved.absolutePath,
    );

  if (!fileStatus.isDirectory()) {
    throw new Error(
      `Required governance directory is not a directory: ${resolved.relativePath}`,
    );
  }

  return resolved.relativePath;
}

function freezeArray(
  values,
) {
  return Object.freeze([
    ...values,
  ]);
}

export function validateGovernanceArchitecture({
  repositoryRoot =
    defaultRepositoryRoot,

  requiredDocuments =
    REQUIRED_GOVERNANCE_DOCUMENTS,

  requiredDirectories =
    REQUIRED_GOVERNANCE_DIRECTORIES,
} = {}) {
  const normalizedRepositoryRoot =
    normalizeRepositoryRoot(
      repositoryRoot,
    );

  assertStringArray(
    requiredDocuments,
    "requiredDocuments",
  );

  assertStringArray(
    requiredDirectories,
    "requiredDirectories",
  );

  const documents =
    [...requiredDocuments]
      .sort()
      .map(
        (relativePath) =>
          validateRequiredFile(
            normalizedRepositoryRoot,
            relativePath,
          ),
      );

  const directories =
    [...requiredDirectories]
      .sort()
      .map(
        (relativePath) =>
          validateRequiredDirectory(
            normalizedRepositoryRoot,
            relativePath,
          ),
      );

  const checkedPaths =
    [
      ...documents,
      ...directories,
    ].sort();

  return Object.freeze({
    version:
      GOVERNANCE_ARCHITECTURE_VERSION,

    valid:
      true,

    repositoryRoot:
      normalizedRepositoryRoot,

    documents:
      freezeArray(
        documents,
      ),

    directories:
      freezeArray(
        directories,
      ),

    checkedPaths:
      freezeArray(
        checkedPaths,
      ),
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
  try {
    const result =
      validateGovernanceArchitecture();

    console.log(
      `PASS: Governance architecture validation passed. Checked ${result.documents.length} documents and ${result.directories.length} directories.`,
    );
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );

    process.exitCode = 1;
  }
}
