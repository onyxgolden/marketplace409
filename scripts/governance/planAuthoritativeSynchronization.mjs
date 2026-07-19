import fs from "node:fs";
import path from "node:path";

import {
  AUTHORITATIVE_DOCUMENTS,
  loadAuthoritativeDelegations,
} from "./loadAuthoritativeDelegations.mjs";

import {
  loadGovernanceMode,
} from "./loadGovernanceMode.mjs";

import {
  listSyncSections,
} from "./replaceSyncSection.mjs";

const defaultGovernanceModePath =
  "governance/config/governance-mode.json";

const defaultDelegationsPath =
  "governance/config/authoritative-delegations.json";

const synchronizedDirectory =
  "docs/architecture/synchronized";

const ACTIVE_AUTHORITY_STATES_BY_MODE =
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

function normalizeRepositoryPath(
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
    path.resolve(repositoryRoot);

  const absolutePath =
    path.resolve(
      normalizedRepositoryRoot,
      suppliedPath,
    );

  const relativePath =
    path.relative(
      normalizedRepositoryRoot,
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
      `${label} must remain inside the repository`,
    );
  }

  return {
    absolutePath,
    relativePath:
      relativePath.split(path.sep).join("/"),
  };
}

function readRequiredDocument(
  repositoryRoot,
  relativePath,
  label,
) {
  const normalized =
    normalizeRepositoryPath(
      repositoryRoot,
      relativePath,
      label,
    );

  if (
    !fs.existsSync(
      normalized.absolutePath,
    )
  ) {
    throw new Error(
      `${label} does not exist: ${normalized.relativePath}`,
    );
  }

  let content;

  try {
    content =
      fs.readFileSync(
        normalized.absolutePath,
        "utf8",
      );
  } catch (error) {
    throw new Error(
      `${label} could not be read: ${normalized.relativePath}: ${error.message}`,
    );
  }

  return {
    ...normalized,
    content,
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
  {
    documentLabel,
  },
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
    escapeRegExp(sectionId);

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

function getSourceRelativePath(
  sourceDocumentName,
) {
  assertNonEmptyString(
    sourceDocumentName,
    "sourceDocumentName",
  );

  return path.posix.join(
    synchronizedDirectory,
    sourceDocumentName,
  );
}

function assertSupportedDocumentMapping(
  configuredDocument,
  supportedDocument,
) {
  if (
    configuredDocument.documentName !==
      supportedDocument.documentName ||
    configuredDocument.relativePath !==
      supportedDocument.relativePath ||
    configuredDocument.sourceDocumentName !==
      supportedDocument.sourceDocumentName
  ) {
    throw new Error(
      `Authoritative document mapping does not match the supported mapping for ${supportedDocument.documentName}`,
    );
  }
}

function assertAuthorityStateAllowedForMode(
  mode,
  authorityState,
  documentName,
  sectionId,
) {
  const allowedStates =
    ACTIVE_AUTHORITY_STATES_BY_MODE[
      mode
    ];

  if (!allowedStates) {
    throw new Error(
      `Unsupported governance mode: ${mode}`,
    );
  }

  if (
    !allowedStates.includes(
      authorityState,
    )
  ) {
    throw new Error(
      `Delegation ${documentName}#${sectionId} with authority state "${authorityState}" is not permitted in governance mode "${mode}"`,
    );
  }
}

function createModeStatus(mode) {
  switch (mode) {
    case "locked":
      return "locked";

    case "shadow":
      return "shadow-only";

    case "hybrid":
      return "hybrid-planning";

    case "authoritative":
      return "authoritative-planning";

    default:
      throw new Error(
        `Unsupported governance mode: ${mode}`,
      );
  }
}

function createSkippedSection(
  {
    configuredDocument,
    delegatedSection,
    sourceRelativePath,
    reason,
  },
) {
  return {
    documentName:
      configuredDocument.documentName,
    targetRelativePath:
      configuredDocument.relativePath,
    sourceDocumentName:
      configuredDocument
        .sourceDocumentName,
    sourceRelativePath,
    sectionId:
      delegatedSection.sectionId,
    sourceSectionId:
      delegatedSection.sourceSectionId,
    authorityState:
      delegatedSection.authorityState,
    ownerApproved:
      delegatedSection.ownerApproved,
    reason,
  };
}

function createOperation(
  {
    configuredDocument,
    delegatedSection,
    sourceRelativePath,
    currentContent,
    replacementContent,
  },
) {
  return {
    documentName:
      configuredDocument.documentName,
    targetRelativePath:
      configuredDocument.relativePath,
    sourceDocumentName:
      configuredDocument
        .sourceDocumentName,
    sourceRelativePath,
    sectionId:
      delegatedSection.sectionId,
    sourceSectionId:
      delegatedSection.sourceSectionId,
    authorityState:
      delegatedSection.authorityState,
    ownerApproved:
      delegatedSection.ownerApproved,
    currentContent,
    replacementContent,
    contentChanged:
      currentContent !==
      replacementContent,
  };
}

function createDocumentPlan(
  {
    configuredDocument,
    sourceRelativePath,
    targetSections,
    sourceSections,
  },
) {
  return {
    documentName:
      configuredDocument.documentName,
    targetRelativePath:
      configuredDocument.relativePath,
    sourceDocumentName:
      configuredDocument
        .sourceDocumentName,
    sourceRelativePath,
    delegatedSectionCount:
      configuredDocument
        .delegatedSections.length,
    targetSections: [
      ...targetSections,
    ],
    sourceSections: [
      ...sourceSections,
    ],
  };
}

export function planAuthoritativeSynchronization(
  {
    repositoryRoot =
      process.cwd(),
    governanceModePath =
      defaultGovernanceModePath,
    delegationsPath =
      defaultDelegationsPath,
  } = {},
) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  const normalizedRepositoryRoot =
    path.resolve(
      repositoryRoot,
    );

  const governanceMode =
    loadGovernanceMode(
      governanceModePath,
      {
        repositoryRoot:
          normalizedRepositoryRoot,
      },
    );

  const delegations =
    loadAuthoritativeDelegations(
      delegationsPath,
      {
        repositoryRoot:
          normalizedRepositoryRoot,
      },
    );

  const mode =
    governanceMode.mode;

  if (
    !Object.hasOwn(
      ACTIVE_AUTHORITY_STATES_BY_MODE,
      mode,
    )
  ) {
    throw new Error(
      `Unsupported governance mode: ${mode}`,
    );
  }

  const documents = [];
  const operations = [];
  const skippedSections = [];

  for (
    let index = 0;
    index <
      AUTHORITATIVE_DOCUMENTS.length;
    index += 1
  ) {
    const supportedDocument =
      AUTHORITATIVE_DOCUMENTS[index];

    const configuredDocument =
      delegations.documents[index];

    assertSupportedDocumentMapping(
      configuredDocument,
      supportedDocument,
    );

    const sourceRelativePath =
      getSourceRelativePath(
        configuredDocument
          .sourceDocumentName,
      );

    const targetDocument =
      readRequiredDocument(
        normalizedRepositoryRoot,
        configuredDocument.relativePath,
        "Authoritative governance document",
      );

    const sourceDocument =
      readRequiredDocument(
        normalizedRepositoryRoot,
        sourceRelativePath,
        "Shadow governance document",
      );

    const targetSections =
      listSyncSections(
        targetDocument.content,
      );

    const sourceSections =
      listSyncSections(
        sourceDocument.content,
      );

    documents.push(
      createDocumentPlan({
        configuredDocument,
        sourceRelativePath,
        targetSections,
        sourceSections,
      }),
    );

    for (
      const delegatedSection
      of configuredDocument
        .delegatedSections
    ) {
      if (
        delegatedSection
          .authorityState ===
        "suspended"
      ) {
        skippedSections.push(
          createSkippedSection({
            configuredDocument,
            delegatedSection,
            sourceRelativePath,
            reason:
              "delegation-suspended",
          }),
        );

        continue;
      }

      if (
        mode === "locked" ||
        mode === "shadow"
      ) {
        skippedSections.push(
          createSkippedSection({
            configuredDocument,
            delegatedSection,
            sourceRelativePath,
            reason:
              "governance-mode-prohibits-authoritative-planning",
          }),
        );

        continue;
      }

      assertAuthorityStateAllowedForMode(
        mode,
        delegatedSection
          .authorityState,
        configuredDocument
          .documentName,
        delegatedSection.sectionId,
      );

      const replacementContent =
        getSyncSectionContent(
          sourceDocument.content,
          delegatedSection
            .sourceSectionId,
          {
            documentLabel:
              `Shadow governance document ${sourceRelativePath}`,
          },
        );

      const currentContent =
        getSyncSectionContent(
          targetDocument.content,
          delegatedSection.sectionId,
          {
            documentLabel:
              `Authoritative governance document ${configuredDocument.relativePath}`,
          },
        );

      operations.push(
        createOperation({
          configuredDocument,
          delegatedSection,
          sourceRelativePath,
          currentContent,
          replacementContent,
        }),
      );
    }
  }

  const updateCount =
    operations.filter(
      (operation) =>
        operation.contentChanged,
    ).length;

  const synchronizedCount =
    operations.length -
    updateCount;

  return deepFreeze({
    mode,
    status:
      createModeStatus(mode),
    configurationVersion:
      delegations.version,
    defaultAuthority:
      delegations.defaultAuthority,
    delegationScope:
      delegations.delegationScope,
    automaticPromotion:
      delegations.automaticPromotion,
    hasAuthorizedOperations:
      operations.length > 0,
    hasRequiredUpdates:
      updateCount > 0,
    operationCount:
      operations.length,
    updateCount,
    synchronizedCount,
    skippedCount:
      skippedSections.length,
    documents,
    operations,
    skippedSections,
  });
}
