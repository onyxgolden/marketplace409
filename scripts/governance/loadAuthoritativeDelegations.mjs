import fs from "node:fs";
import path from "node:path";

export const AUTHORITATIVE_DOCUMENTS =
  Object.freeze([
    Object.freeze({
      documentName:
        "FORGE_ENGINEERING_CONTROL_CENTER.md",
      relativePath:
        "docs/architecture/FORGE_ENGINEERING_CONTROL_CENTER.md",
      sourceDocumentName:
        "FORGE_SYNC_CONTROL_CENTER.md",
    }),
    Object.freeze({
      documentName:
        "FORGE_STATUS.md",
      relativePath:
        "docs/architecture/FORGE_STATUS.md",
      sourceDocumentName:
        "FORGE_SYNC_STATUS.md",
    }),
    Object.freeze({
      documentName:
        "FORGE_SESSION.md",
      relativePath:
        "docs/architecture/FORGE_SESSION.md",
      sourceDocumentName:
        "FORGE_SYNC_SESSION.md",
    }),
    Object.freeze({
      documentName:
        "FORGE_ROADMAP.md",
      relativePath:
        "docs/architecture/FORGE_ROADMAP.md",
      sourceDocumentName:
        "FORGE_SYNC_ROADMAP.md",
    }),
  ]);

export const AUTHORITATIVE_AUTHORITY_STATES =
  Object.freeze([
    "hybrid-control",
    "agent-controlled",
    "suspended",
  ]);

const defaultConfigurationPath =
  "governance/config/authoritative-delegations.json";

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
      "Authoritative delegation configuration must remain inside the repository",
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

function validateDelegatedSection(
  section,
  location,
  expectedSourceDocumentName,
) {
  assertPlainObject(
    section,
    location,
  );

  assertNonEmptyString(
    section.sectionId,
    `${location}.sectionId`,
  );

  assertNonEmptyString(
    section.sourceSectionId,
    `${location}.sourceSectionId`,
  );

  assertNonEmptyString(
    section.sourceDocumentName,
    `${location}.sourceDocumentName`,
  );

  if (
    section.sourceDocumentName !==
    expectedSourceDocumentName
  ) {
    throw new Error(
      `${location}.sourceDocumentName must equal ${expectedSourceDocumentName}`,
    );
  }

  assertNonEmptyString(
    section.authorityState,
    `${location}.authorityState`,
  );

  if (
    !AUTHORITATIVE_AUTHORITY_STATES.includes(
      section.authorityState,
    )
  ) {
    throw new Error(
      `${location}.authorityState is unsupported: ${section.authorityState}`,
    );
  }

  assertBoolean(
    section.ownerApproved,
    `${location}.ownerApproved`,
  );

  if (
    section.authorityState !==
      "suspended" &&
    section.ownerApproved !== true
  ) {
    throw new Error(
      `${location} requires explicit owner approval`,
    );
  }

  if (
    Object.hasOwn(
      section,
      "immutable",
    )
  ) {
    assertBoolean(
      section.immutable,
      `${location}.immutable`,
    );

    if (section.immutable) {
      throw new Error(
        `${location} may not delegate an immutable section`,
      );
    }
  }

  return {
    sectionId:
      section.sectionId,
    sourceSectionId:
      section.sourceSectionId,
    sourceDocumentName:
      section.sourceDocumentName,
    authorityState:
      section.authorityState,
    ownerApproved:
      section.ownerApproved,
  };
}

function validateDocumentDelegation(
  document,
  index,
  expectedDocument,
) {
  const location =
    `configuration.documents[${index}]`;

  assertPlainObject(
    document,
    location,
  );

  assertNonEmptyString(
    document.documentName,
    `${location}.documentName`,
  );

  if (
    document.documentName !==
    expectedDocument.documentName
  ) {
    throw new Error(
      `${location}.documentName must equal ${expectedDocument.documentName}`,
    );
  }

  assertNonEmptyString(
    document.relativePath,
    `${location}.relativePath`,
  );

  if (
    document.relativePath !==
    expectedDocument.relativePath
  ) {
    throw new Error(
      `${location}.relativePath must equal ${expectedDocument.relativePath}`,
    );
  }

  assertNonEmptyString(
    document.sourceDocumentName,
    `${location}.sourceDocumentName`,
  );

  if (
    document.sourceDocumentName !==
    expectedDocument.sourceDocumentName
  ) {
    throw new Error(
      `${location}.sourceDocumentName must equal ${expectedDocument.sourceDocumentName}`,
    );
  }

  if (
    !Array.isArray(
      document.delegatedSections,
    )
  ) {
    throw new TypeError(
      `${location}.delegatedSections must be an array`,
    );
  }

  const sectionIdentifiers =
    new Set();

  const delegatedSections =
    document.delegatedSections.map(
      (section, sectionIndex) => {
        const sectionLocation =
          `${location}.delegatedSections[${sectionIndex}]`;

        const validatedSection =
          validateDelegatedSection(
            section,
            sectionLocation,
            expectedDocument
              .sourceDocumentName,
          );

        if (
          sectionIdentifiers.has(
            validatedSection.sectionId,
          )
        ) {
          throw new Error(
            `Duplicate delegated section identifier in ${document.documentName}: ${validatedSection.sectionId}`,
          );
        }

        sectionIdentifiers.add(
          validatedSection.sectionId,
        );

        return validatedSection;
      },
    );

  return {
    documentName:
      document.documentName,
    relativePath:
      document.relativePath,
    sourceDocumentName:
      document.sourceDocumentName,
    delegatedSections,
  };
}

export function validateAuthoritativeDelegations(
  configuration,
) {
  assertPlainObject(
    configuration,
    "Authoritative delegation configuration",
  );

  if (configuration.version !== "1.0") {
    throw new Error(
      "Authoritative delegation configuration version must be 1.0",
    );
  }

  assertNonEmptyString(
    configuration.description,
    "configuration.description",
  );

  if (
    configuration.defaultAuthority !==
    "human"
  ) {
    throw new Error(
      "configuration.defaultAuthority must equal human",
    );
  }

  if (
    configuration.delegationScope !==
    "section"
  ) {
    throw new Error(
      "configuration.delegationScope must equal section",
    );
  }

  if (
    configuration.automaticPromotion !==
    false
  ) {
    throw new Error(
      "configuration.automaticPromotion must remain false",
    );
  }

  if (
    !Array.isArray(
      configuration.documents,
    )
  ) {
    throw new TypeError(
      "configuration.documents must be an array",
    );
  }

  if (
    configuration.documents.length !==
    AUTHORITATIVE_DOCUMENTS.length
  ) {
    throw new Error(
      "configuration.documents must contain every supported authoritative document exactly once",
    );
  }

  const documentNames =
    new Set(
      configuration.documents.map(
        (document) =>
          document?.documentName,
      ),
    );

  if (
    documentNames.size !==
    AUTHORITATIVE_DOCUMENTS.length
  ) {
    throw new Error(
      "configuration.documents may not contain duplicate authoritative documents",
    );
  }

  const documents =
    AUTHORITATIVE_DOCUMENTS.map(
      (
        expectedDocument,
        index,
      ) =>
        validateDocumentDelegation(
          configuration.documents[index],
          index,
          expectedDocument,
        ),
    );

  assertStringArray(
    configuration.rules,
    "configuration.rules",
  );

  return deepFreeze({
    version:
      configuration.version,
    description:
      configuration.description,
    defaultAuthority:
      configuration.defaultAuthority,
    delegationScope:
      configuration.delegationScope,
    automaticPromotion:
      configuration.automaticPromotion,
    documents,
    rules: [
      ...configuration.rules,
    ],
  });
}

export function loadAuthoritativeDelegations(
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
      `Authoritative delegation configuration does not exist: ${relativePath}`,
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
      `Authoritative delegation configuration could not be read: ${relativePath}: ${error.message}`,
    );
  }

  let configuration;

  try {
    configuration =
      JSON.parse(content);
  } catch (error) {
    throw new Error(
      `Authoritative delegation configuration is not valid JSON: ${relativePath}: ${error.message}`,
    );
  }

  return validateAuthoritativeDelegations(
    configuration,
  );
}
