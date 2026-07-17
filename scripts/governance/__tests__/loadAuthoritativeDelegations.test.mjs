import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  AUTHORITATIVE_DOCUMENTS,
  loadAuthoritativeDelegations,
  validateAuthoritativeDelegations,
} from "../loadAuthoritativeDelegations.mjs";

const temporaryDirectories =
  new Set();

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-authoritative-delegations-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  fs.mkdirSync(
    path.join(
      repositoryRoot,
      "governance",
      "config",
    ),
    {
      recursive: true,
    },
  );

  return repositoryRoot;
}

function createDocumentConfiguration(
  authoritativeDocument,
  overrides = {},
) {
  return {
    documentName:
      authoritativeDocument.documentName,
    relativePath:
      authoritativeDocument.relativePath,
    sourceDocumentName:
      authoritativeDocument.sourceDocumentName,
    delegatedSections: [],
    ...overrides,
  };
}

function createValidConfiguration(
  overrides = {},
) {
  return {
    version: "1.0",
    description:
      "Test authoritative delegation configuration.",
    defaultAuthority:
      "human",
    delegationScope:
      "section",
    automaticPromotion:
      false,
    documents:
      AUTHORITATIVE_DOCUMENTS.map(
        (document) =>
          createDocumentConfiguration(
            document,
          ),
      ),
    rules: [
      "Authority remains human by default.",
    ],
    ...overrides,
  };
}

function writeConfiguration(
  repositoryRoot,
  configuration,
) {
  const configurationPath =
    path.join(
      repositoryRoot,
      "governance",
      "config",
      "authoritative-delegations.json",
    );

  fs.writeFileSync(
    configurationPath,
    `${JSON.stringify(
      configuration,
      null,
      2,
    )}\n`,
    "utf8",
  );

  return configurationPath;
}

afterEach(() => {
  for (
    const temporaryDirectory
    of temporaryDirectories
  ) {
    fs.rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryDirectories.clear();
});

describe(
  "validateAuthoritativeDelegations",
  () => {
    test(
      "accepts a deny-by-default configuration with no delegated sections",
      () => {
        const configuration =
          validateAuthoritativeDelegations(
            createValidConfiguration(),
          );

        expect(
          configuration.defaultAuthority,
        ).toBe("human");

        expect(
          configuration.documents.every(
            (document) =>
              document
                .delegatedSections
                .length === 0,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            configuration,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            configuration.documents,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            configuration.documents[0],
          ),
        ).toBe(true);
      },
    );

    test(
      "accepts an explicitly owner-approved section delegation",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents[1]
          .delegatedSections.push({
            sectionId:
              "repository_state",
            sourceSectionId:
              "repository_state",
            sourceDocumentName:
              "FORGE_SYNC_STATUS.md",
            authorityState:
              "hybrid-control",
            ownerApproved:
              true,
          });

        const validated =
          validateAuthoritativeDelegations(
            configuration,
          );

        expect(
          validated.documents[1]
            .delegatedSections,
        ).toEqual([
          {
            sectionId:
              "repository_state",
            sourceSectionId:
              "repository_state",
            sourceDocumentName:
              "FORGE_SYNC_STATUS.md",
            authorityState:
              "hybrid-control",
            ownerApproved:
              true,
          },
        ]);
      },
    );

    test(
      "rejects automatic promotion",
      () => {
        expect(() =>
          validateAuthoritativeDelegations(
            createValidConfiguration({
              automaticPromotion:
                true,
            }),
          ),
        ).toThrow(
          "configuration.automaticPromotion must remain false",
        );
      },
    );

    test(
      "rejects missing authoritative documents",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents.pop();

        expect(() =>
          validateAuthoritativeDelegations(
            configuration,
          ),
        ).toThrow(
          "configuration.documents must contain every supported authoritative document exactly once",
        );
      },
    );

    test(
      "rejects duplicate authoritative documents",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents[3] = {
          ...configuration.documents[2],
        };

        expect(() =>
          validateAuthoritativeDelegations(
            configuration,
          ),
        ).toThrow(
          "configuration.documents may not contain duplicate authoritative documents",
        );
      },
    );

    test(
      "rejects duplicate delegated section identifiers",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents[1]
          .delegatedSections = [
            {
              sectionId:
                "repository_state",
              sourceSectionId:
                "repository_state",
              sourceDocumentName:
                "FORGE_SYNC_STATUS.md",
              authorityState:
                "hybrid-control",
              ownerApproved:
                true,
            },
            {
              sectionId:
                "repository_state",
              sourceSectionId:
                "repository_state_duplicate",
              sourceDocumentName:
                "FORGE_SYNC_STATUS.md",
              authorityState:
                "hybrid-control",
              ownerApproved:
                true,
            },
          ];

        expect(() =>
          validateAuthoritativeDelegations(
            configuration,
          ),
        ).toThrow(
          "Duplicate delegated section identifier in FORGE_STATUS.md: repository_state",
        );
      },
    );

    test(
      "rejects an active delegation without owner approval",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents[1]
          .delegatedSections.push({
            sectionId:
              "repository_state",
            sourceSectionId:
              "repository_state",
            sourceDocumentName:
              "FORGE_SYNC_STATUS.md",
            authorityState:
              "hybrid-control",
            ownerApproved:
              false,
          });

        expect(() =>
          validateAuthoritativeDelegations(
            configuration,
          ),
        ).toThrow(
          "requires explicit owner approval",
        );
      },
    );

    test(
      "rejects a mismatched shadow source document",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents[1]
          .delegatedSections.push({
            sectionId:
              "repository_state",
            sourceSectionId:
              "repository_state",
            sourceDocumentName:
              "FORGE_SYNC_SESSION.md",
            authorityState:
              "hybrid-control",
            ownerApproved:
              true,
          });

        expect(() =>
          validateAuthoritativeDelegations(
            configuration,
          ),
        ).toThrow(
          "sourceDocumentName must equal FORGE_SYNC_STATUS.md",
        );
      },
    );

    test(
      "rejects delegation of a section declared immutable",
      () => {
        const configuration =
          createValidConfiguration();

        configuration.documents[1]
          .delegatedSections.push({
            sectionId:
              "repository_truth_rules",
            sourceSectionId:
              "repository_truth_rules",
            sourceDocumentName:
              "FORGE_SYNC_STATUS.md",
            authorityState:
              "agent-controlled",
            ownerApproved:
              true,
            immutable:
              true,
          });

        expect(() =>
          validateAuthoritativeDelegations(
            configuration,
          ),
        ).toThrow(
          "may not delegate an immutable section",
        );
      },
    );
  },
);

describe(
  "loadAuthoritativeDelegations",
  () => {
    test(
      "loads and validates repository configuration",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        writeConfiguration(
          repositoryRoot,
          createValidConfiguration(),
        );

        const configuration =
          loadAuthoritativeDelegations(
            undefined,
            {
              repositoryRoot,
            },
          );

        expect(
          configuration.documents,
        ).toHaveLength(
          AUTHORITATIVE_DOCUMENTS.length,
        );
      },
    );

    test(
      "rejects missing configuration",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadAuthoritativeDelegations(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Authoritative delegation configuration does not exist",
        );
      },
    );

    test(
      "rejects invalid JSON",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const configurationPath =
          path.join(
            repositoryRoot,
            "governance",
            "config",
            "authoritative-delegations.json",
          );

        fs.writeFileSync(
          configurationPath,
          "{ invalid json",
          "utf8",
        );

        expect(() =>
          loadAuthoritativeDelegations(
            undefined,
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Authoritative delegation configuration is not valid JSON",
        );
      },
    );

    test(
      "rejects paths outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          loadAuthoritativeDelegations(
            "../authoritative-delegations.json",
            {
              repositoryRoot,
            },
          ),
        ).toThrow(
          "Authoritative delegation configuration must remain inside the repository",
        );
      },
    );
  },
);
