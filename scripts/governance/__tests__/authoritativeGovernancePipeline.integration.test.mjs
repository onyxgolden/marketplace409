import fs from "node:fs";
import path from "node:path";

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
  synchronizeAuthoritativeGovernance,
} from "../synchronizeAuthoritativeGovernance.mjs";

import {
  createDelegatedSection,
  createFixture,
  delegationsPath,
  expectDeeplyFrozen,
  governanceModePath,
  removeTemporaryRepositories,
} from "./fixtures/authoritativeSynchronizationFixture.mjs";

function readRepositoryFile(
  repositoryRoot,
  relativePath,
) {
  return fs.readFileSync(
    path.join(
      repositoryRoot,
      relativePath,
    ),
    "utf8",
  );
}

function readSyncSection(
  documentContent,
  sectionId,
) {
  const escapedSectionId =
    sectionId.replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
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
      `Missing SYNC section: ${sectionId}`,
    );
  }

  return match[1].trim();
}

afterEach(() => {
  removeTemporaryRepositories();
});

describe(
  "authoritative governance pipeline integration",
  () => {
    test(
      "plans, executes, verifies, and reports an authoritative section update using the real implementations",
      () => {
        const authoritativeDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode:
              "authoritative",
            documentSections: {
              [authoritativeDocument.documentName]: [
                createDelegatedSection({
                  sectionId:
                    "repository_state",
                  sourceSectionId:
                    "repository_state",
                  sourceDocumentName:
                    authoritativeDocument
                      .sourceDocumentName,
                  authorityState:
                    "agent-controlled",
                  ownerApproved:
                    true,
                }),
              ],
            },
          });

        const authoritativeBefore =
          readRepositoryFile(
            repositoryRoot,
            authoritativeDocument
              .relativePath,
          );

        expect(
          readSyncSection(
            authoritativeBefore,
            "repository_state",
          ),
        ).toBe(
          "authoritative repository state",
        );

        const result =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        const authoritativeAfter =
          readRepositoryFile(
            repositoryRoot,
            authoritativeDocument
              .relativePath,
          );

        expect(
          readSyncSection(
            authoritativeAfter,
            "repository_state",
          ),
        ).toBe(
          "shadow repository state",
        );

        expect(result).toMatchObject({
          mode:
            "authoritative",
          status:
            "synchronized",
          configurationVersion:
            "1.0",
          defaultAuthority:
            "human",
          delegationScope:
            "section",
          automaticPromotion:
            false,
          operationCount:
            1,
          updateCount:
            1,
          synchronizedCount:
            0,
          skippedCount:
            0,
          documentCount:
            1,
          updatedDocumentCount:
            1,
          verificationPassed:
            true,
          rollbackPerformed:
            false,
        });

        expect(result.documents).toEqual([
          {
            documentName:
              authoritativeDocument
                .documentName,
            targetRelativePath:
              authoritativeDocument
                .relativePath,
            operationCount:
              1,
            updateCount:
              1,
            contentChanged:
              true,
          },
        ]);

        expect(result.operations).toEqual([
          {
            documentName:
              authoritativeDocument
                .documentName,
            targetRelativePath:
              authoritativeDocument
                .relativePath,
            sectionId:
              "repository_state",
            sourceSectionId:
              "repository_state",
            authorityState:
              "agent-controlled",
            contentChanged:
              true,
            status:
              "updated",
          },
        ]);

        expectDeeplyFrozen(
          result,
        );
      },
    );

    test(
      "returns a verified no-op when the real pipeline runs again after synchronization",
      () => {
        const authoritativeDocument =
          AUTHORITATIVE_DOCUMENTS[0];

        const repositoryRoot =
          createFixture({
            mode:
              "authoritative",
            documentSections: {
              [authoritativeDocument.documentName]: [
                createDelegatedSection({
                  sectionId:
                    "repository_state",
                  sourceSectionId:
                    "repository_state",
                  sourceDocumentName:
                    authoritativeDocument
                      .sourceDocumentName,
                  authorityState:
                    "agent-controlled",
                  ownerApproved:
                    true,
                }),
              ],
            },
          });

        const firstResult =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        const authoritativeAfterFirstRun =
          readRepositoryFile(
            repositoryRoot,
            authoritativeDocument
              .relativePath,
          );

        const secondResult =
          synchronizeAuthoritativeGovernance({
            repositoryRoot,
            governanceModePath,
            delegationsPath,
          });

        const authoritativeAfterSecondRun =
          readRepositoryFile(
            repositoryRoot,
            authoritativeDocument
              .relativePath,
          );

        expect(firstResult).toMatchObject({
          status:
            "synchronized",
          operationCount:
            1,
          updateCount:
            1,
          synchronizedCount:
            0,
          updatedDocumentCount:
            1,
          verificationPassed:
            true,
          rollbackPerformed:
            false,
        });

        expect(secondResult).toMatchObject({
          mode:
            "authoritative",
          status:
            "no-op",
          operationCount:
            1,
          updateCount:
            0,
          synchronizedCount:
            1,
          skippedCount:
            0,
          documentCount:
            1,
          updatedDocumentCount:
            0,
          verificationPassed:
            true,
          rollbackPerformed:
            false,
        });

        expect(secondResult.operations).toEqual([
          {
            documentName:
              authoritativeDocument
                .documentName,
            targetRelativePath:
              authoritativeDocument
                .relativePath,
            sectionId:
              "repository_state",
            sourceSectionId:
              "repository_state",
            authorityState:
              "agent-controlled",
            contentChanged:
              false,
            status:
              "already-synchronized",
          },
        ]);

        expect(
          authoritativeAfterSecondRun,
        ).toBe(
          authoritativeAfterFirstRun,
        );

        expectDeeplyFrozen(
          secondResult,
        );
      },
    );
  },
);
