import fs from "node:fs";
import path from "node:path";

import {
  listSyncSections,
  replaceSyncSectionContent,
} from "./replaceSyncSection.mjs";

const EXECUTABLE_AUTHORITY_STATES_BY_MODE =
  Object.freeze({
    locked: Object.freeze([]),
    shadow: Object.freeze([]),
    hybrid: Object.freeze([
      "hybrid-control",
      "agent-controlled",
    ]),
    authoritative: Object.freeze([
      "agent-controlled",
    ]),
  });

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

function isPathOutsideRoot(
  rootPath,
  candidatePath,
) {
  const relativePath =
    path.relative(
      rootPath,
      candidatePath,
    );

  return (
    relativePath === ".." ||
    relativePath.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(relativePath)
  );
}

function normalizeRepositoryFilePath(
  repositoryRoot,
  suppliedPath,
  label,
) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  assertNonEmptyString(
    suppliedPath,
    label,
  );

  const normalizedRepositoryRoot =
    path.resolve(
      repositoryRoot,
    );

  const absolutePath =
    path.resolve(
      normalizedRepositoryRoot,
      suppliedPath,
    );

  if (
    isPathOutsideRoot(
      normalizedRepositoryRoot,
      absolutePath,
    )
  ) {
    throw new Error(
      `${label} must remain inside the repository`,
    );
  }

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    throw new Error(
      `${label} does not exist: ${suppliedPath}`,
    );
  }

  const realRepositoryRoot =
    fs.realpathSync(
      normalizedRepositoryRoot,
    );

  const realFilePath =
    fs.realpathSync(
      absolutePath,
    );

  if (
    isPathOutsideRoot(
      realRepositoryRoot,
      realFilePath,
    )
  ) {
    throw new Error(
      `${label} resolves outside the repository`,
    );
  }

  const realParentDirectory =
    fs.realpathSync(
      path.dirname(
        absolutePath,
      ),
    );

  if (
    isPathOutsideRoot(
      realRepositoryRoot,
      realParentDirectory,
    )
  ) {
    throw new Error(
      `${label} parent directory resolves outside the repository`,
    );
  }

  return {
    absolutePath,
    relativePath:
      path.relative(
        normalizedRepositoryRoot,
        absolutePath,
      )
        .split(path.sep)
        .join("/"),
  };
}

function escapeRegExp(value) {
  return value.replace(
    /[.*+?^${}()|[\]\\]/g,
    "\\$&",
  );
}

function getSyncSectionContent(
  documentContent,
  sectionId,
  documentLabel,
) {
  const availableSections =
    listSyncSections(
      documentContent,
    );

  if (
    !availableSections.includes(
      sectionId,
    )
  ) {
    throw new Error(
      `${documentLabel} is missing required SYNC section: ${sectionId}`,
    );
  }

  const escapedSectionId =
    escapeRegExp(
      sectionId,
    );

  const sectionPattern =
    new RegExp(
      `<!-- FORGE:SYNC:${escapedSectionId}:START -->([\\s\\S]*?)<!-- FORGE:SYNC:${escapedSectionId}:END -->`,
      "m",
    );

  const match =
    sectionPattern.exec(
      documentContent,
    );

  if (!match) {
    throw new Error(
      `${documentLabel} could not read SYNC section: ${sectionId}`,
    );
  }

  return match[1].trim();
}

function readRequiredFile(
  absolutePath,
  relativePath,
) {
  try {
    return fs.readFileSync(
      absolutePath,
      "utf8",
    );
  } catch (error) {
    throw new Error(
      `Authoritative governance document could not be read: ${relativePath}: ${error.message}`,
    );
  }
}

function validatePlanOperation(
  operation,
  index,
  mode,
) {
  const location =
    `plan.operations[${index}]`;

  assertPlainObject(
    operation,
    location,
  );

  assertNonEmptyString(
    operation.documentName,
    `${location}.documentName`,
  );

  assertNonEmptyString(
    operation.targetRelativePath,
    `${location}.targetRelativePath`,
  );

  assertNonEmptyString(
    operation.sourceDocumentName,
    `${location}.sourceDocumentName`,
  );

  assertNonEmptyString(
    operation.sourceRelativePath,
    `${location}.sourceRelativePath`,
  );

  assertNonEmptyString(
    operation.sectionId,
    `${location}.sectionId`,
  );

  assertNonEmptyString(
    operation.sourceSectionId,
    `${location}.sourceSectionId`,
  );

  assertNonEmptyString(
    operation.authorityState,
    `${location}.authorityState`,
  );

  assertBoolean(
    operation.ownerApproved,
    `${location}.ownerApproved`,
  );

  assertBoolean(
    operation.contentChanged,
    `${location}.contentChanged`,
  );

  if (
    typeof operation.currentContent !==
    "string"
  ) {
    throw new TypeError(
      `${location}.currentContent must be a string`,
    );
  }

  if (
    typeof operation.replacementContent !==
    "string"
  ) {
    throw new TypeError(
      `${location}.replacementContent must be a string`,
    );
  }

  if (
    operation.ownerApproved !== true
  ) {
    throw new Error(
      `${location} requires explicit owner approval`,
    );
  }

  const permittedAuthorityStates =
    EXECUTABLE_AUTHORITY_STATES_BY_MODE[
      mode
    ];

  if (!permittedAuthorityStates) {
    throw new Error(
      `Unsupported governance mode: ${mode}`,
    );
  }

  if (
    !permittedAuthorityStates.includes(
      operation.authorityState,
    )
  ) {
    throw new Error(
      `${location} authority state "${operation.authorityState}" is not executable in governance mode "${mode}"`,
    );
  }
}

function validatePlan(plan) {
  assertPlainObject(
    plan,
    "plan",
  );

  assertNonEmptyString(
    plan.mode,
    "plan.mode",
  );

  if (
    !Object.hasOwn(
      EXECUTABLE_AUTHORITY_STATES_BY_MODE,
      plan.mode,
    )
  ) {
    throw new Error(
      `Unsupported governance mode: ${plan.mode}`,
    );
  }

  if (
    !Array.isArray(
      plan.operations,
    )
  ) {
    throw new TypeError(
      "plan.operations must be an array",
    );
  }

  if (
    !Array.isArray(
      plan.skippedSections,
    )
  ) {
    throw new TypeError(
      "plan.skippedSections must be an array",
    );
  }

  if (
    typeof plan.operationCount ===
      "number" &&
    plan.operationCount !==
      plan.operations.length
  ) {
    throw new Error(
      "plan.operationCount does not match plan.operations length",
    );
  }

  const delegatedSections =
    new Set();

  plan.operations.forEach(
    (
      operation,
      index,
    ) => {
      validatePlanOperation(
        operation,
        index,
        plan.mode,
      );

      const identifier =
        [
          operation.targetRelativePath,
          operation.sectionId,
        ].join("#");

      if (
        delegatedSections.has(
          identifier,
        )
      ) {
        throw new Error(
          `Plan contains duplicate authoritative operation: ${identifier}`,
        );
      }

      delegatedSections.add(
        identifier,
      );
    },
  );
}

function createDocumentExecutions(
  {
    repositoryRoot,
    plan,
  },
) {
  const documentsByPath =
    new Map();

  for (
    let operationIndex = 0;
    operationIndex <
      plan.operations.length;
    operationIndex += 1
  ) {
    const operation =
      plan.operations[
        operationIndex
      ];

    let documentExecution =
      documentsByPath.get(
        operation.targetRelativePath,
      );

    if (!documentExecution) {
      const normalizedPath =
        normalizeRepositoryFilePath(
          repositoryRoot,
          operation.targetRelativePath,
          "Authoritative governance document",
        );

      const originalContent =
        readRequiredFile(
          normalizedPath.absolutePath,
          normalizedPath.relativePath,
        );

      documentExecution = {
        documentName:
          operation.documentName,
        targetRelativePath:
          normalizedPath.relativePath,
        absolutePath:
          normalizedPath.absolutePath,
        originalContent,
        updatedContent:
          originalContent,
        operations: [],
      };

      documentsByPath.set(
        operation.targetRelativePath,
        documentExecution,
      );
    }

    if (
      documentExecution.documentName !==
      operation.documentName
    ) {
      throw new Error(
        `Plan maps multiple document names to ${operation.targetRelativePath}`,
      );
    }

    const observedCurrentContent =
      getSyncSectionContent(
        documentExecution.updatedContent,
        operation.sectionId,
        `Authoritative governance document ${documentExecution.targetRelativePath}`,
      );

    if (
      observedCurrentContent !==
      operation.currentContent
    ) {
      throw new Error(
        `Authoritative synchronization plan is stale for ${documentExecution.targetRelativePath}#${operation.sectionId}`,
      );
    }

    if (
      operation.contentChanged
    ) {
      documentExecution.updatedContent =
        replaceSyncSectionContent(
          documentExecution.updatedContent,
          operation.sectionId,
          operation.replacementContent,
        );
    }

    const verifiedContent =
      getSyncSectionContent(
        documentExecution.updatedContent,
        operation.sectionId,
        `Prepared authoritative governance document ${documentExecution.targetRelativePath}`,
      );

    if (
      verifiedContent !==
      operation.replacementContent.trim()
    ) {
      throw new Error(
        `Prepared authoritative synchronization verification failed for ${documentExecution.targetRelativePath}#${operation.sectionId}`,
      );
    }

    documentExecution.operations.push({
      operationIndex,
      sectionId:
        operation.sectionId,
      sourceSectionId:
        operation.sourceSectionId,
      authorityState:
        operation.authorityState,
      contentChanged:
        operation.contentChanged,
      status:
        operation.contentChanged
          ? "updated"
          : "already-synchronized",
    });
  }

  return [
    ...documentsByPath.values(),
  ];
}

function removeTemporaryFile(
  temporaryPath,
) {
  if (
    fs.existsSync(
      temporaryPath,
    )
  ) {
    fs.unlinkSync(
      temporaryPath,
    );
  }
}

function atomicWrite(
  absolutePath,
  content,
) {
  const temporaryPath =
    `${absolutePath}.tmp`;

  removeTemporaryFile(
    temporaryPath,
  );

  try {
    fs.writeFileSync(
      temporaryPath,
      content,
      "utf8",
    );

    fs.renameSync(
      temporaryPath,
      absolutePath,
    );
  } finally {
    removeTemporaryFile(
      temporaryPath,
    );
  }
}

function verifyWrittenDocument(
  documentExecution,
) {
  const writtenContent =
    readRequiredFile(
      documentExecution.absolutePath,
      documentExecution
        .targetRelativePath,
    );

  if (
    writtenContent !==
    documentExecution.updatedContent
  ) {
    throw new Error(
      `Written authoritative document does not match prepared content: ${documentExecution.targetRelativePath}`,
    );
  }

  for (
    const operation
    of documentExecution.operations
  ) {
    const expectedContent =
      getSyncSectionContent(
        documentExecution.updatedContent,
        operation.sectionId,
        `Prepared authoritative governance document ${documentExecution.targetRelativePath}`,
      );

    const observedContent =
      getSyncSectionContent(
        writtenContent,
        operation.sectionId,
        `Written authoritative governance document ${documentExecution.targetRelativePath}`,
      );

    if (
      observedContent !==
      expectedContent
    ) {
      throw new Error(
        `Written authoritative synchronization verification failed for ${documentExecution.targetRelativePath}#${operation.sectionId}`,
      );
    }
  }
}

function restoreOriginalDocuments(
  documents,
) {
  const rollbackFailures = [];

  for (
    const documentExecution
    of documents
  ) {
    try {
      atomicWrite(
        documentExecution.absolutePath,
        documentExecution
          .originalContent,
      );
    } catch (error) {
      rollbackFailures.push(
        `${documentExecution.targetRelativePath}: ${error.message}`,
      );
    }
  }

  if (
    rollbackFailures.length > 0
  ) {
    throw new Error(
      `Authoritative synchronization rollback failed: ${rollbackFailures.join("; ")}`,
    );
  }
}

function createExecutionSummary(
  {
    plan,
    documents,
  },
) {
  const changedDocuments =
    documents.filter(
      (document) =>
        document.updatedContent !==
        document.originalContent,
    );

  const executedOperations =
    documents.flatMap(
      (document) =>
        document.operations.map(
          (operation) => ({
            documentName:
              document.documentName,
            targetRelativePath:
              document.targetRelativePath,
            sectionId:
              operation.sectionId,
            sourceSectionId:
              operation.sourceSectionId,
            authorityState:
              operation.authorityState,
            contentChanged:
              operation.contentChanged,
            status:
              operation.status,
          }),
        ),
    );

  return deepFreeze({
    mode:
      plan.mode,
    status:
      changedDocuments.length > 0
        ? "synchronized"
        : "no-op",
    configurationVersion:
      plan.configurationVersion,
    defaultAuthority:
      plan.defaultAuthority,
    delegationScope:
      plan.delegationScope,
    automaticPromotion:
      plan.automaticPromotion,
    operationCount:
      executedOperations.length,
    updateCount:
      executedOperations.filter(
        (operation) =>
          operation.contentChanged,
      ).length,
    synchronizedCount:
      executedOperations.filter(
        (operation) =>
          !operation.contentChanged,
      ).length,
    skippedCount:
      plan.skippedSections.length,
    documentCount:
      documents.length,
    updatedDocumentCount:
      changedDocuments.length,
    verificationPassed: true,
    rollbackPerformed: false,
    documents:
      documents.map(
        (document) => ({
          documentName:
            document.documentName,
          targetRelativePath:
            document.targetRelativePath,
          operationCount:
            document.operations.length,
          updateCount:
            document.operations.filter(
              (operation) =>
                operation.contentChanged,
            ).length,
          contentChanged:
            document.updatedContent !==
            document.originalContent,
        }),
      ),
    operations:
      executedOperations,
    skippedSections:
      plan.skippedSections.map(
        (section) => ({
          ...section,
        }),
      ),
  });
}

export function executeAuthoritativeSynchronizationPlan(
  {
    repositoryRoot =
      process.cwd(),
    plan,
  } = {},
) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  validatePlan(
    plan,
  );

  const normalizedRepositoryRoot =
    path.resolve(
      repositoryRoot,
    );

  const documents =
    createDocumentExecutions({
      repositoryRoot:
        normalizedRepositoryRoot,
      plan,
    });

  const changedDocuments =
    documents.filter(
      (document) =>
        document.updatedContent !==
        document.originalContent,
    );

  if (
    changedDocuments.length === 0
  ) {
    return createExecutionSummary({
      plan,
      documents,
    });
  }

  try {
    for (
      const documentExecution
      of changedDocuments
    ) {
      atomicWrite(
        documentExecution.absolutePath,
        documentExecution.updatedContent,
      );
    }

    for (
      const documentExecution
      of changedDocuments
    ) {
      verifyWrittenDocument(
        documentExecution,
      );
    }
  } catch (error) {
    try {
      restoreOriginalDocuments(
        changedDocuments,
      );
    } catch (rollbackError) {
      throw new Error(
        `${error.message}; ${rollbackError.message}`,
      );
    }

    throw error;
  }

  return createExecutionSummary({
    plan,
    documents,
  });
}
