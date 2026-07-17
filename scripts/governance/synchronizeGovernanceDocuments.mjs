import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

function atomicWrite(
  filePath,
  content,
) {
  const temporaryPath =
    `${filePath}.tmp`;

  fs.writeFileSync(
    temporaryPath,
    content,
    "utf8",
  );

  fs.renameSync(
    temporaryPath,
    filePath,
  );
}

function captureOriginalDocuments({
  targetDirectory,
  renderedDocuments,
}) {
  const originals = new Map();

  for (
    const documentName
    of Object.keys(
      renderedDocuments,
    )
  ) {
    const filePath = path.join(
      targetDirectory,
      documentName,
    );

    originals.set(
      filePath,
      fs.readFileSync(
        filePath,
        "utf8",
      ),
    );
  }

  return originals;
}

function writeRenderedDocuments({
  targetDirectory,
  renderedDocuments,
}) {
  for (
    const [
      documentName,
      content,
    ]
    of Object.entries(
      renderedDocuments,
    )
  ) {
    atomicWrite(
      path.join(
        targetDirectory,
        documentName,
      ),
      content,
    );
  }
}

function restoreOriginalDocuments(
  originals,
) {
  for (
    const [
      filePath,
      originalContent,
    ]
    of originals
  ) {
    atomicWrite(
      filePath,
      originalContent,
    );
  }
}

function runNodeScript({
  repositoryRoot,
  relativePath,
  args = [],
}) {
  const result = spawnSync(
    process.execPath,
    [
      path.join(
        repositoryRoot,
        relativePath,
      ),
      ...args,
    ],
    {
      cwd: repositoryRoot,
      stdio: "inherit",
    },
  );

  if (result.status !== 0) {
    throw new Error(
      `Validation failed: ${relativePath}`,
    );
  }
}

export function synchronizeGovernanceDocuments({
  repositoryRoot,
  targetDirectory,
  renderedDocuments,
  createValidationSteps,
  successMessage,
  rollbackMessage,
}) {
  const originals =
    captureOriginalDocuments({
      targetDirectory,
      renderedDocuments,
    });

  try {
    writeRenderedDocuments({
      targetDirectory,
      renderedDocuments,
    });

    const validationSteps =
      createValidationSteps();

    for (
      const validationStep
      of validationSteps
    ) {
      runNodeScript({
        repositoryRoot,
        relativePath:
          validationStep.relativePath,
        args:
          validationStep.args ?? [],
      });
    }

    console.log(
      successMessage,
    );
  } catch (error) {
    console.error(
      rollbackMessage,
    );

    restoreOriginalDocuments(
      originals,
    );

    throw error;
  }
}
