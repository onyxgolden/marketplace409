import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  afterEach,
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  executeAuthoritativeSynchronizationPlan,
} from "../executeAuthoritativeSynchronizationPlan.mjs";

const temporaryDirectories =
  new Set();

function createSyncSection(
  sectionId,
  content,
) {
  return [
    `<!-- FORGE:SYNC:${sectionId}:START -->`,
    "",
    content,
    "",
    `<!-- FORGE:SYNC:${sectionId}:END -->`,
  ].join("\n");
}

function createDocumentContent(
  {
    title,
    sections,
  },
) {
  return [
    `# ${title}`,
    "",
    ...sections.flatMap(
      (
        {
          sectionId,
          content,
        },
        index,
      ) => [
        createSyncSection(
          sectionId,
          content,
        ),
        index <
        sections.length - 1
          ? ""
          : null,
      ].filter(
        (value) =>
          value !== null,
      ),
    ),
    "",
  ].join("\n");
}

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-authoritative-executor-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  fs.mkdirSync(
    path.join(
      repositoryRoot,
      "docs",
      "architecture",
    ),
    {
      recursive: true,
    },
  );

  fs.mkdirSync(
    path.join(
      repositoryRoot,
      "docs",
      "architecture",
      "synchronized",
    ),
    {
      recursive: true,
    },
  );

  return repositoryRoot;
}

function writeRelativeFile(
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
    path.dirname(
      absolutePath,
    ),
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    absolutePath,
    content,
    "utf8",
  );

  return absolutePath;
}

function readRelativeFile(
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

function listTemporaryFiles(
  repositoryRoot,
) {
  const temporaryFiles = [];

  function inspectDirectory(
    directoryPath,
  ) {
    if (
      !fs.existsSync(
        directoryPath,
      )
    ) {
      return;
    }

    for (
      const entry
      of fs.readdirSync(
        directoryPath,
        {
          withFileTypes: true,
        },
      )
    ) {
      const entryPath =
        path.join(
          directoryPath,
          entry.name,
        );

      if (
        entry.isDirectory()
      ) {
        inspectDirectory(
          entryPath,
        );

        continue;
      }

      if (
        entry.name.endsWith(
          ".tmp",
        )
      ) {
        temporaryFiles.push(
          path.relative(
            repositoryRoot,
            entryPath,
          ),
        );
      }
    }
  }

  inspectDirectory(
    repositoryRoot,
  );

  return temporaryFiles.sort();
}

function createOperation(
  {
    documentName =
      "ARCHITECTURE.md",
    targetRelativePath =
      "docs/architecture/ARCHITECTURE.md",
    sourceDocumentName =
      "ARCHITECTURE.md",
    sourceRelativePath =
      "docs/architecture/synchronized/ARCHITECTURE.md",
    sectionId =
      "architecture-overview",
    sourceSectionId =
      sectionId,
    authorityState =
      "hybrid-control",
    ownerApproved = true,
    currentContent =
      "Original architecture.",
    replacementContent =
      "Updated architecture.",
    contentChanged =
      currentContent !==
      replacementContent,
  } = {},
) {
  return {
    documentName,
    targetRelativePath,
    sourceDocumentName,
    sourceRelativePath,
    sectionId,
    sourceSectionId,
    authorityState,
    ownerApproved,
    currentContent,
    replacementContent,
    contentChanged,
  };
}

function createPlan(
  {
    mode = "hybrid",
    operations = [],
    skippedSections = [],
  } = {},
) {
  const updateCount =
    operations.filter(
      (operation) =>
        operation.contentChanged,
    ).length;

  return {
    mode,
    status:
      mode === "authoritative"
        ? "authoritative-planning"
        : `${mode}-planning`,
    configurationVersion:
      "1.0",
    defaultAuthority:
      "owner-controlled",
    delegationScope:
      "section",
    automaticPromotion:
      false,
    hasAuthorizedOperations:
      operations.length > 0,
    hasRequiredUpdates:
      updateCount > 0,
    operationCount:
      operations.length,
    updateCount,
    synchronizedCount:
      operations.length -
      updateCount,
    skippedCount:
      skippedSections.length,
    documents: [],
    operations,
    skippedSections,
  };
}

function createSingleDocumentFixture(
  {
    sectionId =
      "architecture-overview",
    currentContent =
      "Original architecture.",
    replacementContent =
      "Updated architecture.",
    mode = "hybrid",
    authorityState =
      "hybrid-control",
  } = {},
) {
  const repositoryRoot =
    createTemporaryRepository();

  const targetRelativePath =
    "docs/architecture/ARCHITECTURE.md";

  const sourceRelativePath =
    "docs/architecture/synchronized/ARCHITECTURE.md";

  const originalDocument =
    createDocumentContent({
      title:
        "Architecture",
      sections: [
        {
          sectionId,
          content:
            currentContent,
        },
      ],
    });

  writeRelativeFile(
    repositoryRoot,
    targetRelativePath,
    originalDocument,
  );

  writeRelativeFile(
    repositoryRoot,
    sourceRelativePath,
    createDocumentContent({
      title:
        "Synchronized Architecture",
      sections: [
        {
          sectionId,
          content:
            replacementContent,
        },
      ],
    }),
  );

  const operation =
    createOperation({
      targetRelativePath,
      sourceRelativePath,
      sectionId,
      sourceSectionId:
        sectionId,
      authorityState,
      currentContent,
      replacementContent,
    });

  const plan =
    createPlan({
      mode,
      operations: [
        operation,
      ],
    });

  return {
    repositoryRoot,
    targetRelativePath,
    sourceRelativePath,
    originalDocument,
    operation,
    plan,
  };
}

afterEach(() => {
  vi.restoreAllMocks();

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
  "executeAuthoritativeSynchronizationPlan",
  () => {
    test(
      "applies an authorized hybrid synchronization operation",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          plan,
        } =
          createSingleDocumentFixture();

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan,
          });

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toContain(
          "Updated architecture.",
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).not.toContain(
          "Original architecture.",
        );

        expect(result).toMatchObject({
          mode:
            "hybrid",
          status:
            "synchronized",
          operationCount:
            1,
          updateCount:
            1,
          synchronizedCount:
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

        expect(
          result.operations,
        ).toEqual([
          {
            documentName:
              "ARCHITECTURE.md",
            targetRelativePath:
              "docs/architecture/ARCHITECTURE.md",
            sectionId:
              "architecture-overview",
            sourceSectionId:
              "architecture-overview",
            authorityState:
              "hybrid-control",
            contentChanged:
              true,
            status:
              "updated",
          },
        ]);

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "applies an agent-controlled operation in authoritative mode",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          plan,
        } =
          createSingleDocumentFixture({
            mode:
              "authoritative",
            authorityState:
              "agent-controlled",
          });

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan,
          });

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toContain(
          "Updated architecture.",
        );

        expect(
          result.mode,
        ).toBe(
          "authoritative",
        );

        expect(
          result.status,
        ).toBe(
          "synchronized",
        );
      },
    );

    test(
      "returns a no-op result for an empty hybrid plan",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                mode:
                  "hybrid",
              }),
          });

        expect(result).toMatchObject({
          mode:
            "hybrid",
          status:
            "no-op",
          operationCount:
            0,
          updateCount:
            0,
          synchronizedCount:
            0,
          skippedCount:
            0,
          documentCount:
            0,
          updatedDocumentCount:
            0,
          verificationPassed:
            true,
          rollbackPerformed:
            false,
          documents: [],
          operations: [],
          skippedSections: [],
        });

        expect(
          fs.readdirSync(
            repositoryRoot,
          ),
        ).toEqual([
          "docs",
        ]);
      },
    );

    test(
      "returns a no-op result when delegated content is already synchronized",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
        } =
          createSingleDocumentFixture({
            currentContent:
              "Already synchronized.",
            replacementContent:
              "Already synchronized.",
          });

        const plan =
          createPlan({
            mode:
              "hybrid",
            operations: [
              createOperation({
                currentContent:
                  "Already synchronized.",
                replacementContent:
                  "Already synchronized.",
                contentChanged:
                  false,
              }),
            ],
          });

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan,
          });

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );

        expect(result).toMatchObject({
          status:
            "no-op",
          operationCount:
            1,
          updateCount:
            0,
          synchronizedCount:
            1,
          documentCount:
            1,
          updatedDocumentCount:
            0,
        });

        expect(
          result.operations[0],
        ).toMatchObject({
          contentChanged:
            false,
          status:
            "already-synchronized",
        });

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "applies multiple section replacements with one prepared document",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const targetRelativePath =
          "docs/architecture/ARCHITECTURE.md";

        writeRelativeFile(
          repositoryRoot,
          targetRelativePath,
          createDocumentContent({
            title:
              "Architecture",
            sections: [
              {
                sectionId:
                  "overview",
                content:
                  "Original overview.",
              },
              {
                sectionId:
                  "boundaries",
                content:
                  "Original boundaries.",
              },
            ],
          }),
        );

        const operations = [
          createOperation({
            targetRelativePath,
            sectionId:
              "overview",
            sourceSectionId:
              "overview",
            currentContent:
              "Original overview.",
            replacementContent:
              "Updated overview.",
          }),
          createOperation({
            targetRelativePath,
            sectionId:
              "boundaries",
            sourceSectionId:
              "boundaries",
            currentContent:
              "Original boundaries.",
            replacementContent:
              "Updated boundaries.",
          }),
        ];

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations,
              }),
          });

        const writtenDocument =
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          );

        expect(
          writtenDocument,
        ).toContain(
          "Updated overview.",
        );

        expect(
          writtenDocument,
        ).toContain(
          "Updated boundaries.",
        );

        expect(
          writtenDocument,
        ).not.toContain(
          "Original overview.",
        );

        expect(
          writtenDocument,
        ).not.toContain(
          "Original boundaries.",
        );

        expect(result).toMatchObject({
          operationCount:
            2,
          updateCount:
            2,
          documentCount:
            1,
          updatedDocumentCount:
            1,
        });

        expect(
          result.documents,
        ).toEqual([
          {
            documentName:
              "ARCHITECTURE.md",
            targetRelativePath,
            operationCount:
              2,
            updateCount:
              2,
            contentChanged:
              true,
          },
        ]);
      },
    );

    test(
      "updates multiple authoritative documents",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const architecturePath =
          "docs/architecture/ARCHITECTURE.md";

        const securityPath =
          "docs/architecture/SECURITY.md";

        writeRelativeFile(
          repositoryRoot,
          architecturePath,
          createDocumentContent({
            title:
              "Architecture",
            sections: [
              {
                sectionId:
                  "overview",
                content:
                  "Old architecture.",
              },
            ],
          }),
        );

        writeRelativeFile(
          repositoryRoot,
          securityPath,
          createDocumentContent({
            title:
              "Security",
            sections: [
              {
                sectionId:
                  "controls",
                content:
                  "Old controls.",
              },
            ],
          }),
        );

        const operations = [
          createOperation({
            documentName:
              "ARCHITECTURE.md",
            targetRelativePath:
              architecturePath,
            sectionId:
              "overview",
            sourceSectionId:
              "overview",
            currentContent:
              "Old architecture.",
            replacementContent:
              "New architecture.",
          }),
          createOperation({
            documentName:
              "SECURITY.md",
            targetRelativePath:
              securityPath,
            sourceDocumentName:
              "SECURITY.md",
            sourceRelativePath:
              "docs/architecture/synchronized/SECURITY.md",
            sectionId:
              "controls",
            sourceSectionId:
              "controls",
            currentContent:
              "Old controls.",
            replacementContent:
              "New controls.",
          }),
        ];

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations,
              }),
          });

        expect(
          readRelativeFile(
            repositoryRoot,
            architecturePath,
          ),
        ).toContain(
          "New architecture.",
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            securityPath,
          ),
        ).toContain(
          "New controls.",
        );

        expect(result).toMatchObject({
          operationCount:
            2,
          updateCount:
            2,
          documentCount:
            2,
          updatedDocumentCount:
            2,
        });
      },
    );

    test(
      "preserves content outside delegated sections",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const targetRelativePath =
          "docs/architecture/ARCHITECTURE.md";

        const originalDocument = [
          "# Architecture",
          "",
          "Owner-maintained introduction.",
          "",
          createSyncSection(
            "overview",
            "Original overview.",
          ),
          "",
          "Owner-maintained conclusion.",
          "",
        ].join("\n");

        writeRelativeFile(
          repositoryRoot,
          targetRelativePath,
          originalDocument,
        );

        executeAuthoritativeSynchronizationPlan({
          repositoryRoot,
          plan:
            createPlan({
              operations: [
                createOperation({
                  targetRelativePath,
                  sectionId:
                    "overview",
                  sourceSectionId:
                    "overview",
                  currentContent:
                    "Original overview.",
                  replacementContent:
                    "Updated overview.",
                }),
              ],
            }),
        });

        const writtenDocument =
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          );

        expect(
          writtenDocument,
        ).toContain(
          "Owner-maintained introduction.",
        );

        expect(
          writtenDocument,
        ).toContain(
          "Owner-maintained conclusion.",
        );

        expect(
          writtenDocument,
        ).toContain(
          "Updated overview.",
        );
      },
    );

    test(
      "rejects a stale plan before writing",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
          operation,
        } =
          createSingleDocumentFixture();

        const stalePlan =
          createPlan({
            operations: [
              {
                ...operation,
                currentContent:
                  "Content that is no longer present.",
              },
            ],
          });

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              stalePlan,
          }),
        ).toThrow(
          `Authoritative synchronization plan is stale for ${targetRelativePath}#architecture-overview`,
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "rejects a missing delegated target section before writing",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
          operation,
        } =
          createSingleDocumentFixture();

        const invalidPlan =
          createPlan({
            operations: [
              {
                ...operation,
                sectionId:
                  "missing-section",
                sourceSectionId:
                  "missing-section",
              },
            ],
          });

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              invalidPlan,
          }),
        ).toThrow(
          `Authoritative governance document ${targetRelativePath} is missing required SYNC section: missing-section`,
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );
      },
    );

    test(
      "rejects duplicate document-section operations",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
          operation,
        } =
          createSingleDocumentFixture();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations: [
                  operation,
                  {
                    ...operation,
                  },
                ],
              }),
          }),
        ).toThrow(
          `Plan contains duplicate authoritative operation: ${targetRelativePath}#architecture-overview`,
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );
      },
    );

    test(
      "rejects an operation that lacks owner approval",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
          operation,
        } =
          createSingleDocumentFixture();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations: [
                  {
                    ...operation,
                    ownerApproved:
                      false,
                  },
                ],
              }),
          }),
        ).toThrow(
          "plan.operations[0] requires explicit owner approval",
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );
      },
    );

    test(
      "rejects agent-controlled authority in hybrid mode",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
          operation,
        } =
          createSingleDocumentFixture();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                mode:
                  "hybrid",
                operations: [
                  {
                    ...operation,
                    authorityState:
                      "owner-controlled",
                  },
                ],
              }),
          }),
        ).toThrow(
          'authority state "owner-controlled" is not executable in governance mode "hybrid"',
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );
      },
    );

    test(
      "rejects hybrid-control authority in authoritative mode",
      () => {
        const {
          repositoryRoot,
          targetRelativePath,
          originalDocument,
          operation,
        } =
          createSingleDocumentFixture();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                mode:
                  "authoritative",
                operations: [
                  {
                    ...operation,
                    authorityState:
                      "hybrid-control",
                  },
                ],
              }),
          }),
        ).toThrow(
          'authority state "hybrid-control" is not executable in governance mode "authoritative"',
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            targetRelativePath,
          ),
        ).toBe(
          originalDocument,
        );
      },
    );

    test(
      "rejects operations in locked mode",
      () => {
        const {
          repositoryRoot,
          operation,
        } =
          createSingleDocumentFixture();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                mode:
                  "locked",
                operations: [
                  operation,
                ],
              }),
          }),
        ).toThrow(
          'authority state "hybrid-control" is not executable in governance mode "locked"',
        );
      },
    );

    test(
      "rejects operations in shadow mode",
      () => {
        const {
          repositoryRoot,
          operation,
        } =
          createSingleDocumentFixture();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                mode:
                  "shadow",
                operations: [
                  operation,
                ],
              }),
          }),
        ).toThrow(
          'authority state "hybrid-control" is not executable in governance mode "shadow"',
        );
      },
    );

    test(
      "rejects unsupported governance modes",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                mode:
                  "unsafe",
              }),
          }),
        ).toThrow(
          "Unsupported governance mode: unsafe",
        );
      },
    );

    test(
      "rejects target paths outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const outsideDirectory =
          fs.mkdtempSync(
            path.join(
              os.tmpdir(),
              "forge-authoritative-outside-",
            ),
          );

        temporaryDirectories.add(
          outsideDirectory,
        );

        const outsideFile =
          path.join(
            outsideDirectory,
            "ARCHITECTURE.md",
          );

        fs.writeFileSync(
          outsideFile,
          createDocumentContent({
            title:
              "Outside",
            sections: [
              {
                sectionId:
                  "overview",
                content:
                  "Outside content.",
              },
            ],
          }),
          "utf8",
        );

        const relativeOutsidePath =
          path.relative(
            repositoryRoot,
            outsideFile,
          );

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations: [
                  createOperation({
                    targetRelativePath:
                      relativeOutsidePath,
                    sectionId:
                      "overview",
                    sourceSectionId:
                      "overview",
                    currentContent:
                      "Outside content.",
                    replacementContent:
                      "Unauthorized update.",
                  }),
                ],
              }),
          }),
        ).toThrow(
          "Authoritative governance document must remain inside the repository",
        );

        expect(
          fs.readFileSync(
            outsideFile,
            "utf8",
          ),
        ).toContain(
          "Outside content.",
        );
      },
    );

    test(
      "rejects target files reached through a symlink outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const outsideDirectory =
          fs.mkdtempSync(
            path.join(
              os.tmpdir(),
              "forge-authoritative-symlink-",
            ),
          );

        temporaryDirectories.add(
          outsideDirectory,
        );

        const outsideFile =
          path.join(
            outsideDirectory,
            "ARCHITECTURE.md",
          );

        fs.writeFileSync(
          outsideFile,
          createDocumentContent({
            title:
              "Outside",
            sections: [
              {
                sectionId:
                  "overview",
                content:
                  "Outside content.",
              },
            ],
          }),
          "utf8",
        );

        const symlinkPath =
          path.join(
            repositoryRoot,
            "docs",
            "architecture",
            "LINKED.md",
          );

        fs.symlinkSync(
          outsideFile,
          symlinkPath,
        );

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations: [
                  createOperation({
                    documentName:
                      "LINKED.md",
                    targetRelativePath:
                      "docs/architecture/LINKED.md",
                    sectionId:
                      "overview",
                    sourceSectionId:
                      "overview",
                    currentContent:
                      "Outside content.",
                    replacementContent:
                      "Unauthorized update.",
                  }),
                ],
              }),
          }),
        ).toThrow(
          "Authoritative governance document resolves outside the repository",
        );

        expect(
          fs.readFileSync(
            outsideFile,
            "utf8",
          ),
        ).toContain(
          "Outside content.",
        );
      },
    );

    test(
      "fails before writing when a target document is missing",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations: [
                  createOperation({
                    targetRelativePath:
                      "docs/architecture/MISSING.md",
                  }),
                ],
              }),
          }),
        ).toThrow(
          "Authoritative governance document does not exist: docs/architecture/MISSING.md",
        );

        expect(
          fs.existsSync(
            path.join(
              repositoryRoot,
              "docs",
              "architecture",
              "MISSING.md",
            ),
          ),
        ).toBe(false);
      },
    );

    test(
      "rolls back previously written documents when a later write fails",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const firstPath =
          "docs/architecture/A.md";

        const secondPath =
          "docs/architecture/B.md";

        const firstOriginal =
          createDocumentContent({
            title:
              "A",
            sections: [
              {
                sectionId:
                  "section-a",
                content:
                  "Original A.",
              },
            ],
          });

        const secondOriginal =
          createDocumentContent({
            title:
              "B",
            sections: [
              {
                sectionId:
                  "section-b",
                content:
                  "Original B.",
              },
            ],
          });

        writeRelativeFile(
          repositoryRoot,
          firstPath,
          firstOriginal,
        );

        writeRelativeFile(
          repositoryRoot,
          secondPath,
          secondOriginal,
        );

        const realRenameSync =
          fs.renameSync.bind(
            fs,
          );

        let renameCount = 0;

        vi.spyOn(
          fs,
          "renameSync",
        ).mockImplementation(
          (
            oldPath,
            newPath,
          ) => {
            renameCount += 1;

            if (
              renameCount === 2
            ) {
              throw new Error(
                "simulated second write failure",
              );
            }

            return realRenameSync(
              oldPath,
              newPath,
            );
          },
        );

        const operations = [
          createOperation({
            documentName:
              "A.md",
            targetRelativePath:
              firstPath,
            sectionId:
              "section-a",
            sourceSectionId:
              "section-a",
            currentContent:
              "Original A.",
            replacementContent:
              "Updated A.",
          }),
          createOperation({
            documentName:
              "B.md",
            targetRelativePath:
              secondPath,
            sourceDocumentName:
              "B.md",
            sourceRelativePath:
              "docs/architecture/synchronized/B.md",
            sectionId:
              "section-b",
            sourceSectionId:
              "section-b",
            currentContent:
              "Original B.",
            replacementContent:
              "Updated B.",
          }),
        ];

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations,
              }),
          }),
        ).toThrow(
          "simulated second write failure",
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            firstPath,
          ),
        ).toBe(
          firstOriginal,
        );

        expect(
          readRelativeFile(
            repositoryRoot,
            secondPath,
          ),
        ).toBe(
          secondOriginal,
        );

        expect(
          listTemporaryFiles(
            repositoryRoot,
          ),
        ).toEqual([]);
      },
    );

    test(
      "returns a deeply immutable execution summary",
      () => {
        const {
          repositoryRoot,
          plan,
        } =
          createSingleDocumentFixture();

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan,
          });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.documents,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.documents[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.operations,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.operations[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.skippedSections,
          ),
        ).toBe(true);

        expect(() => {
          result.status =
            "modified";
        }).toThrow();

        expect(() => {
          result.operations.push({
            status:
              "modified",
          });
        }).toThrow();
      },
    );

    test(
      "preserves deterministic operation and document ordering",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const documentPaths = [
          "docs/architecture/B.md",
          "docs/architecture/A.md",
        ];

        writeRelativeFile(
          repositoryRoot,
          documentPaths[0],
          createDocumentContent({
            title:
              "B",
            sections: [
              {
                sectionId:
                  "section-b",
                content:
                  "Original B.",
              },
            ],
          }),
        );

        writeRelativeFile(
          repositoryRoot,
          documentPaths[1],
          createDocumentContent({
            title:
              "A",
            sections: [
              {
                sectionId:
                  "section-a",
                content:
                  "Original A.",
              },
            ],
          }),
        );

        const operations = [
          createOperation({
            documentName:
              "B.md",
            targetRelativePath:
              documentPaths[0],
            sourceDocumentName:
              "B.md",
            sourceRelativePath:
              "docs/architecture/synchronized/B.md",
            sectionId:
              "section-b",
            sourceSectionId:
              "section-b",
            currentContent:
              "Original B.",
            replacementContent:
              "Updated B.",
          }),
          createOperation({
            documentName:
              "A.md",
            targetRelativePath:
              documentPaths[1],
            sourceDocumentName:
              "A.md",
            sourceRelativePath:
              "docs/architecture/synchronized/A.md",
            sectionId:
              "section-a",
            sourceSectionId:
              "section-a",
            currentContent:
              "Original A.",
            replacementContent:
              "Updated A.",
          }),
        ];

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                operations,
              }),
          });

        expect(
          result.documents.map(
            (document) =>
              document.targetRelativePath,
          ),
        ).toEqual(
          documentPaths,
        );

        expect(
          result.operations.map(
            (operation) =>
              operation.targetRelativePath,
          ),
        ).toEqual(
          documentPaths,
        );
      },
    );

    test(
      "copies skipped section metadata into the result",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const skippedSection = {
          documentName:
            "ARCHITECTURE.md",
          targetRelativePath:
            "docs/architecture/ARCHITECTURE.md",
          sourceDocumentName:
            "ARCHITECTURE.md",
          sourceRelativePath:
            "docs/architecture/synchronized/ARCHITECTURE.md",
          sectionId:
            "owner-notes",
          sourceSectionId:
            "owner-notes",
          authorityState:
            "owner-controlled",
          ownerApproved:
            false,
          reason:
            "authority-not-delegated",
        };

        const result =
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan:
              createPlan({
                skippedSections: [
                  skippedSection,
                ],
              }),
          });

        expect(
          result.skippedCount,
        ).toBe(1);

        expect(
          result.skippedSections,
        ).toEqual([
          skippedSection,
        ]);

        expect(
          result.skippedSections[0],
        ).not.toBe(
          skippedSection,
        );
      },
    );

    test(
      "rejects an inconsistent operation count",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const plan =
          createPlan();

        plan.operationCount = 1;

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
            plan,
          }),
        ).toThrow(
          "plan.operationCount does not match plan.operations length",
        );
      },
    );

    test(
      "requires a plan object",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot,
          }),
        ).toThrow(
          "plan must be an object",
        );
      },
    );

    test(
      "requires a repository root",
      () => {
        expect(() =>
          executeAuthoritativeSynchronizationPlan({
            repositoryRoot:
              "",
            plan:
              createPlan(),
          }),
        ).toThrow(
          "repositoryRoot must be a non-empty string",
        );
      },
    );
  },
);
