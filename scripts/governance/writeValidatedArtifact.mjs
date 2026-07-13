import fs from "node:fs";
import path from "node:path";

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

function normalizeRepositoryPath(
  repositoryRoot,
  suppliedPath,
  location,
) {
  assertNonEmptyString(
    suppliedPath,
    location,
  );

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
    relativePath.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error(
      `${location} must remain inside the repository`,
    );
  }

  return {
    absolutePath,
    relativePath,
  };
}

function removeFileIfPresent(
  filePath,
) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

export function writeValidatedArtifact({
  repositoryRoot = process.cwd(),
  destinationPath,
  content,
  validateCandidate,
}) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  assertNonEmptyString(
    destinationPath,
    "destinationPath",
  );

  if (
    typeof content !== "string"
  ) {
    throw new TypeError(
      "content must be a string",
    );
  }

  if (
    typeof validateCandidate !==
      "function"
  ) {
    throw new TypeError(
      "validateCandidate must be a function",
    );
  }

  const normalizedDestination =
    normalizeRepositoryPath(
      repositoryRoot,
      destinationPath,
      "destinationPath",
    );

  const destinationDirectory =
    path.dirname(
      normalizedDestination
        .absolutePath,
    );

  const candidatePath =
    `${normalizedDestination.absolutePath}.tmp`;

  const candidateRelativePath =
    path.relative(
      repositoryRoot,
      candidatePath,
    );

  if (
    fs.existsSync(
      normalizedDestination
        .absolutePath,
    )
  ) {
    throw new Error(
      `Artifact already exists: ${normalizedDestination.relativePath}`,
    );
  }

  if (
    fs.existsSync(
      candidatePath,
    )
  ) {
    throw new Error(
      `Artifact candidate already exists: ${candidateRelativePath}`,
    );
  }

  fs.mkdirSync(
    destinationDirectory,
    {
      recursive: true,
    },
  );

  try {
    fs.writeFileSync(
      candidatePath,
      content,
      {
        encoding: "utf8",
        flag: "wx",
      },
    );

    validateCandidate(
      candidateRelativePath,
    );

    if (
      fs.existsSync(
        normalizedDestination
          .absolutePath,
      )
    ) {
      throw new Error(
        `Artifact appeared before promotion: ${normalizedDestination.relativePath}`,
      );
    }

    fs.renameSync(
      candidatePath,
      normalizedDestination
        .absolutePath,
    );
  } catch (error) {
    removeFileIfPresent(
      candidatePath,
    );

    throw error;
  }

  return (
    normalizedDestination
      .relativePath
  );
}
