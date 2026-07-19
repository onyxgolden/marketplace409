import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  expect,
} from "vitest";

import {
  AUTHORITATIVE_DOCUMENTS,
} from "../../loadAuthoritativeDelegations.mjs";

export const governanceModePath =
  "governance/config/governance-mode.json";

export const delegationsPath =
  "governance/config/authoritative-delegations.json";

export const supportedModes =
  Object.freeze([
    "locked",
    "shadow",
    "hybrid",
    "authoritative",
  ]);

const temporaryRepositories =
  new Set();

export function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-authoritative-synchronization-",
      ),
    );

  temporaryRepositories.add(
    repositoryRoot,
  );

  return repositoryRoot;
}

export function removeTemporaryRepositories() {
  for (
    const repositoryRoot
    of temporaryRepositories
  ) {
    fs.rmSync(
      repositoryRoot,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryRepositories.clear();
}

export function writeFile(
  repositoryRoot,
  relativePath,
  content,
) {
  const absolutePath =
    path.join(
      repositoryRoot,
      relativePath,
    );

  fs.mkdirSync(
    path.dirname(absolutePath),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    absolutePath,
    content,
    "utf8",
  );
}

export function writeJson(
  repositoryRoot,
  relativePath,
  value,
) {
  writeFile(
    repositoryRoot,
    relativePath,
    `${JSON.stringify(value, null, 2)}\n`,
  );
}

export function createGovernanceModeConfiguration(
  mode,
) {
  return {
    version: "1.0",
    mode,
    allowedModes: [
      ...supportedModes,
    ],
  };
}

export function createDelegatedSection({
  sectionId = "repository_state",
  sourceSectionId = sectionId,
  sourceDocumentName =
    AUTHORITATIVE_DOCUMENTS[0]
      .sourceDocumentName,
  authorityState =
    "hybrid-control",
  ownerApproved = true,
} = {}) {
  return {
    sectionId,
    sourceSectionId,
    sourceDocumentName,
    authorityState,
    ownerApproved,
  };
}

export function createDelegationConfiguration({
  documentSections = {},
} = {}) {
  return {
    version: "1.0",
    description:
      "Temporary authoritative synchronization fixture.",
    defaultAuthority: "human",
    delegationScope: "section",
    automaticPromotion: false,
    documents:
      AUTHORITATIVE_DOCUMENTS.map(
        (document) => ({
          documentName:
            document.documentName,
          relativePath:
            document.relativePath,
          sourceDocumentName:
            document.sourceDocumentName,
          delegatedSections:
            documentSections[
              document.documentName
            ] ?? [],
        }),
      ),
    rules: [
      "Authority remains deny-by-default.",
      "Active delegations require owner approval.",
      "Automatic promotion is prohibited.",
    ],
  };
}

export function createSyncDocument(
  sections,
  {
    title = "Fixture Document",
  } = {},
) {
  const renderedSections =
    Object.entries(sections)
      .map(
        ([sectionId, content]) =>
          [
            `<!-- FORGE:SYNC:${sectionId}:START -->`,
            "",
            content,
            "",
            `<!-- FORGE:SYNC:${sectionId}:END -->`,
          ].join("\n"),
      )
      .join("\n\n");

  return [
    `# ${title}`,
    "",
    renderedSections,
    "",
  ].join("\n");
}

export function createDefaultSections(
  prefix,
) {
  return {
    repository_state:
      `${prefix} repository state`,
    active_phase:
      `${prefix} active phase`,
    current_objective:
      `${prefix} current objective`,
  };
}

export function writeDocumentFixtures(
  repositoryRoot,
  {
    targetSectionsByDocument = {},
    sourceSectionsByDocument = {},
  } = {},
) {
  for (
    const document
    of AUTHORITATIVE_DOCUMENTS
  ) {
    const targetSections =
      targetSectionsByDocument[
        document.documentName
      ] ??
      createDefaultSections(
        "authoritative",
      );

    const sourceSections =
      sourceSectionsByDocument[
        document.documentName
      ] ??
      createDefaultSections(
        "shadow",
      );

    writeFile(
      repositoryRoot,
      document.relativePath,
      createSyncDocument(
        targetSections,
        {
          title:
            document.documentName,
        },
      ),
    );

    writeFile(
      repositoryRoot,
      path.posix.join(
        "docs/architecture/synchronized",
        document.sourceDocumentName,
      ),
      createSyncDocument(
        sourceSections,
        {
          title:
            document.sourceDocumentName,
        },
      ),
    );
  }
}

export function createFixture({
  mode = "hybrid",
  documentSections = {},
  targetSectionsByDocument = {},
  sourceSectionsByDocument = {},
  governanceModeConfiguration,
  delegationConfiguration,
} = {}) {
  const repositoryRoot =
    createTemporaryRepository();

  writeJson(
    repositoryRoot,
    governanceModePath,
    governanceModeConfiguration ??
      createGovernanceModeConfiguration(
        mode,
      ),
  );

  writeJson(
    repositoryRoot,
    delegationsPath,
    delegationConfiguration ??
      createDelegationConfiguration({
        documentSections,
      }),
  );

  writeDocumentFixtures(
    repositoryRoot,
    {
      targetSectionsByDocument,
      sourceSectionsByDocument,
    },
  );

  return repositoryRoot;
}

export function captureRepositoryFiles(
  repositoryRoot,
) {
  const captured =
    new Map();

  function visit(directory) {
    for (
      const directoryEntry
      of fs.readdirSync(
        directory,
        {
          withFileTypes: true,
        },
      )
    ) {
      const absolutePath =
        path.join(
          directory,
          directoryEntry.name,
        );

      if (
        directoryEntry.isDirectory()
      ) {
        visit(
          absolutePath,
        );

        continue;
      }

      const relativePath =
        path.relative(
          repositoryRoot,
          absolutePath,
        );

      captured.set(
        relativePath,
        fs.readFileSync(
          absolutePath,
        ),
      );
    }
  }

  visit(
    repositoryRoot,
  );

  return captured;
}

export function expectCapturedFilesEqual(
  before,
  after,
) {
  expect(
    [...after.keys()].sort(),
  ).toEqual(
    [...before.keys()].sort(),
  );

  for (
    const [
      relativePath,
      originalContent,
    ]
    of before
  ) {
    expect(
      after.get(
        relativePath,
      ),
    ).toEqual(
      originalContent,
    );
  }
}

export function expectDeeplyFrozen(
  value,
) {
  if (
    typeof value !== "object" ||
    value === null
  ) {
    return;
  }

  expect(
    Object.isFrozen(
      value,
    ),
  ).toBe(true);

  for (
    const nestedValue
    of Object.values(
      value,
    )
  ) {
    expectDeeplyFrozen(
      nestedValue,
    );
  }
}
