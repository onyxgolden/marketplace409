import {
  afterEach,
  describe,
  expect,
  test,
} from "vitest";

import {
  AUTHORITATIVE_DOCUMENTS,
} from "../loadAuthoritativeDelegations.mjs";

import {
  planAuthoritativeSynchronization,
} from "../planAuthoritativeSynchronization.mjs";

import {
  captureRepositoryFiles,
  createDelegatedSection,
  createDelegationConfiguration,
  createFixture,
  delegationsPath,
  expectCapturedFilesEqual,
  expectDeeplyFrozen,
  governanceModePath,
  removeTemporaryRepositories,
  supportedModes,
} from "./fixtures/authoritativeSynchronizationFixture.mjs";

function plan(repositoryRoot) {
  return planAuthoritativeSynchronization({
    repositoryRoot,
    governanceModePath,
    delegationsPath,
  });
}

afterEach(() => {
  removeTemporaryRepositories();
});

describe(
  "planAuthoritativeSynchronization",
  () => {
    test(
      "returns a deny-by-default plan when no sections are delegated",
      () => {
        const repositoryRoot =
          createFixture({
            mode: "hybrid",
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          mode: "hybrid",
          status:
            "hybrid-planning",
          defaultAuthority:
            "human",
          delegationScope:
            "section",
          automaticPromotion:
            false,
          hasAuthorizedOperations:
            false,
          hasRequiredUpdates:
            false,
          operationCount: 0,
          updateCount: 0,
          synchronizedCount: 0,
          skippedCount: 0,
        });

        expect(
          result.operations,
        ).toEqual([]);

        expect(
          result.skippedSections,
        ).toEqual([]);

        expect(
          result.documents,
        ).toHaveLength(
          AUTHORITATIVE_DOCUMENTS.length,
        );
      },
    );

    test(
      "locked mode plans no authoritative operations",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "locked",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection(),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          mode: "locked",
          status: "locked",
          operationCount: 0,
          skippedCount: 1,
        });

        expect(
          result.skippedSections[0]
            .reason,
        ).toBe(
          "governance-mode-prohibits-authoritative-planning",
        );
      },
    );

    test(
      "shadow mode does not expand configured authority",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "shadow",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection(),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          mode: "shadow",
          status: "shadow-only",
          hasAuthorizedOperations:
            false,
          operationCount: 0,
          skippedCount: 1,
        });
      },
    );

    test(
      "hybrid mode plans an owner-approved hybrid-control delegation",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    authorityState:
                      "hybrid-control",
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          mode: "hybrid",
          hasAuthorizedOperations:
            true,
          hasRequiredUpdates:
            true,
          operationCount: 1,
          updateCount: 1,
          synchronizedCount: 0,
          skippedCount: 0,
        });

        expect(
          result.operations[0],
        ).toMatchObject({
          documentName:
            firstDocument.documentName,
          targetRelativePath:
            firstDocument.relativePath,
          sourceDocumentName:
            firstDocument
              .sourceDocumentName,
          sourceRelativePath:
            `docs/architecture/synchronized/${firstDocument.sourceDocumentName}`,
          sectionId:
            "repository_state",
          sourceSectionId:
            "repository_state",
          authorityState:
            "hybrid-control",
          ownerApproved: true,
          currentContent:
            "authoritative repository state",
          replacementContent:
            "shadow repository state",
          contentChanged: true,
        });
      },
    );

    test(
      "hybrid mode permits an owner-approved agent-controlled delegation",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    authorityState:
                      "agent-controlled",
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(
          result.operations,
        ).toHaveLength(1);

        expect(
          result.operations[0]
            .authorityState,
        ).toBe(
          "agent-controlled",
        );
      },
    );

    test(
      "authoritative mode plans an owner-approved agent-controlled delegation",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode:
              "authoritative",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    authorityState:
                      "agent-controlled",
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          mode:
            "authoritative",
          status:
            "authoritative-planning",
          operationCount: 1,
          updateCount: 1,
        });
      },
    );

    test(
      "authoritative mode rejects hybrid-control authority",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode:
              "authoritative",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    authorityState:
                      "hybrid-control",
                  }),
                ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          'with authority state "hybrid-control" is not permitted in governance mode "authoritative"',
        );
      },
    );

    test(
      "suspended delegations are skipped",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    authorityState:
                      "suspended",
                    ownerApproved:
                      false,
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          operationCount: 0,
          skippedCount: 1,
        });

        expect(
          result.skippedSections[0],
        ).toMatchObject({
          sectionId:
            "repository_state",
          authorityState:
            "suspended",
          ownerApproved: false,
          reason:
            "delegation-suspended",
        });
      },
    );

    test(
      "identifies a section that is already synchronized",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const matchingSections = {
          repository_state:
            "matching repository state",
          active_phase:
            "matching active phase",
          current_objective:
            "matching objective",
        };

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection(),
                ],
            },
            targetSectionsByDocument: {
              [firstDocument.documentName]:
                matchingSections,
            },
            sourceSectionsByDocument: {
              [firstDocument.documentName]:
                matchingSections,
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          operationCount: 1,
          updateCount: 0,
          synchronizedCount: 1,
          hasRequiredUpdates:
            false,
        });

        expect(
          result.operations[0],
        ).toMatchObject({
          currentContent:
            "matching repository state",
          replacementContent:
            "matching repository state",
          contentChanged: false,
        });
      },
    );

    test(
      "identifies differing source and target section content",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection(),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(result).toMatchObject({
          operationCount: 1,
          updateCount: 1,
          synchronizedCount: 0,
          hasRequiredUpdates:
            true,
        });

        expect(
          result.operations[0]
            .contentChanged,
        ).toBe(true);
      },
    );

    test(
      "fails when an active target section marker is missing",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    sectionId:
                      "missing_target",
                    sourceSectionId:
                      "repository_state",
                  }),
                ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          `Authoritative governance document ${firstDocument.relativePath} is missing required SYNC section: missing_target`,
        );
      },
    );

    test(
      "fails when an active source section marker is missing",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    sourceSectionId:
                      "missing_source",
                  }),
                ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          `Shadow governance document docs/architecture/synchronized/${firstDocument.sourceDocumentName} is missing required SYNC section: missing_source`,
        );
      },
    );

    test(
      "rejects a mismatched configured source document",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const configuration =
          createDelegationConfiguration();

        configuration.documents[0]
          .sourceDocumentName =
          AUTHORITATIVE_DOCUMENTS[1]
            .sourceDocumentName;

        const repositoryRoot =
          createFixture({
            delegationConfiguration:
              configuration,
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          `configuration.documents[0].sourceDocumentName must equal ${firstDocument.sourceDocumentName}`,
        );
      },
    );

    test(
      "rejects a delegated section that names another source document",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    sourceDocumentName:
                      AUTHORITATIVE_DOCUMENTS[1]
                        .sourceDocumentName,
                  }),
                ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          `configuration.documents[0].delegatedSections[0].sourceDocumentName must equal ${firstDocument.sourceDocumentName}`,
        );
      },
    );

    test(
      "rejects an unsupported authority state through the delegation loader",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    authorityState:
                      "unrestricted",
                  }),
                ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          "configuration.documents[0].delegatedSections[0].authorityState is unsupported: unrestricted",
        );
      },
    );

    test(
      "rejects an active delegation without owner approval",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    ownerApproved:
                      false,
                  }),
                ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          "configuration.documents[0].delegatedSections[0] requires explicit owner approval",
        );
      },
    );

    test(
      "preserves supported document ordering",
      () => {
        const secondDocument =
          AUTHORITATIVE_DOCUMENTS[1];

        const fourthDocument =
          AUTHORITATIVE_DOCUMENTS[3];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [secondDocument.documentName]:
                [
                  createDelegatedSection({
                    sourceDocumentName:
                      secondDocument
                        .sourceDocumentName,
                  }),
                ],
              [fourthDocument.documentName]:
                [
                  createDelegatedSection({
                    sourceDocumentName:
                      fourthDocument
                        .sourceDocumentName,
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(
          result.documents.map(
            (document) =>
              document.documentName,
          ),
        ).toEqual(
          AUTHORITATIVE_DOCUMENTS.map(
            (document) =>
              document.documentName,
          ),
        );

        expect(
          result.operations.map(
            (operation) =>
              operation.documentName,
          ),
        ).toEqual([
          secondDocument.documentName,
          fourthDocument.documentName,
        ]);
      },
    );

    test(
      "preserves delegated section ordering within a document",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    sectionId:
                      "current_objective",
                    sourceSectionId:
                      "current_objective",
                  }),
                  createDelegatedSection({
                    sectionId:
                      "repository_state",
                    sourceSectionId:
                      "repository_state",
                  }),
                  createDelegatedSection({
                    sectionId:
                      "active_phase",
                    sourceSectionId:
                      "active_phase",
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(
          result.operations.map(
            (operation) =>
              operation.sectionId,
          ),
        ).toEqual([
          "current_objective",
          "repository_state",
          "active_phase",
        ]);
      },
    );

    test(
      "does not modify any input file or create temporary files",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection(),
                ],
            },
          });

        const before =
          captureRepositoryFiles(
            repositoryRoot,
          );

        plan(repositoryRoot);

        const after =
          captureRepositoryFiles(
            repositoryRoot,
          );

        expectCapturedFilesEqual(
          before,
          after,
        );

        expect(
          [...after.keys()].some(
            (relativePath) =>
              relativePath.endsWith(
                ".tmp",
              ),
          ),
        ).toBe(false);
      },
    );

    test(
      "returns deeply immutable plan data",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection(),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expectDeeplyFrozen(
          result,
        );

        expect(
          () => {
            result.operations.push(
              {},
            );
          },
        ).toThrow();

        expect(
          () => {
            result.operations[0]
              .contentChanged =
              false;
          },
        ).toThrow();
      },
    );

    test(
      "rejects governance mode configuration paths outside the repository",
      () => {
        const repositoryRoot =
          createFixture();

        expect(
          () =>
            planAuthoritativeSynchronization({
              repositoryRoot,
              governanceModePath:
                "../outside-governance-mode.json",
              delegationsPath,
            }),
        ).toThrow(
          "Governance mode configuration must remain inside the repository",
        );
      },
    );

    test(
      "rejects delegation configuration paths outside the repository",
      () => {
        const repositoryRoot =
          createFixture();

        expect(
          () =>
            planAuthoritativeSynchronization({
              repositoryRoot,
              governanceModePath,
              delegationsPath:
                "../outside-delegations.json",
            }),
        ).toThrow(
          "Authoritative delegation configuration must remain inside the repository",
        );
      },
    );

    test(
      "rejects unsupported governance modes through the governance mode loader",
      () => {
        const repositoryRoot =
          createFixture({
            governanceModeConfiguration: {
              version: "1.0",
              mode: "unrestricted",
              allowedModes: [
                ...supportedModes,
              ],
            },
          });

        expect(
          () => plan(repositoryRoot),
        ).toThrow(
          "Unsupported governance mode: unrestricted",
        );
      },
    );

    test(
      "does not include undelegated sections in operations",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    sectionId:
                      "active_phase",
                    sourceSectionId:
                      "active_phase",
                  }),
                ],
            },
          });

        const result =
          plan(repositoryRoot);

        expect(
          result.operations,
        ).toHaveLength(1);

        expect(
          result.operations[0]
            .sectionId,
        ).toBe(
          "active_phase",
        );

        expect(
          result.operations.some(
            (operation) =>
              operation.sectionId ===
              "repository_state",
          ),
        ).toBe(false);

        expect(
          result.operations.some(
            (operation) =>
              operation.sectionId ===
              "current_objective",
          ),
        ).toBe(false);
      },
    );

    test(
      "returns the same deterministic plan for identical inputs",
      () => {
        const firstDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode: "hybrid",
            documentSections: {
              [firstDocument.documentName]:
                [
                  createDelegatedSection({
                    sectionId:
                      "active_phase",
                    sourceSectionId:
                      "active_phase",
                  }),
                  createDelegatedSection(),
                ],
            },
          });

        const firstResult =
          plan(repositoryRoot);

        const secondResult =
          plan(repositoryRoot);

        expect(
          secondResult,
        ).toEqual(
          firstResult,
        );

        expect(
          JSON.stringify(
            secondResult,
          ),
        ).toBe(
          JSON.stringify(
            firstResult,
          ),
        );
      },
    );
  },
);
