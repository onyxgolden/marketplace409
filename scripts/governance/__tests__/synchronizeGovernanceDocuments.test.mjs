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
  synchronizeGovernanceDocuments,
} from "../synchronizeGovernanceDocuments.mjs";

const temporaryDirectories =
  new Set();

function createFixture() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-synchronizer-",
      ),
    );

  temporaryDirectories.add(
    repositoryRoot,
  );

  const targetDirectory =
    path.join(
      repositoryRoot,
      "documents",
    );

  const scriptsDirectory =
    path.join(
      repositoryRoot,
      "scripts",
    );

  fs.mkdirSync(
    targetDirectory,
    {
      recursive: true,
    },
  );

  fs.mkdirSync(
    scriptsDirectory,
    {
      recursive: true,
    },
  );

  fs.writeFileSync(
    path.join(
      targetDirectory,
      "A.md",
    ),
    "original A\n",
    "utf8",
  );

  fs.writeFileSync(
    path.join(
      targetDirectory,
      "B.md",
    ),
    "original B\n",
    "utf8",
  );

  return {
    repositoryRoot,
    targetDirectory,
  };
}

function createScript(
  repositoryRoot,
  scriptName,
  content,
) {
  const relativePath =
    path.posix.join(
      "scripts",
      scriptName,
    );

  fs.writeFileSync(
    path.join(
      repositoryRoot,
      relativePath,
    ),
    content,
    "utf8",
  );

  return relativePath;
}

function readDocument(
  targetDirectory,
  documentName,
) {
  return fs.readFileSync(
    path.join(
      targetDirectory,
      documentName,
    ),
    "utf8",
  );
}

function temporaryFiles(
  targetDirectory,
) {
  return fs.readdirSync(
    targetDirectory,
  ).filter(
    (fileName) =>
      fileName.endsWith(".tmp"),
  );
}

function synchronize({
  repositoryRoot,
  targetDirectory,
  validationSteps = [],
}) {
  synchronizeGovernanceDocuments({
    repositoryRoot,
    targetDirectory,
    renderedDocuments: {
      "A.md": "rendered A\n",
      "B.md": "rendered B\n",
    },
    createValidationSteps() {
      return validationSteps;
    },
    successMessage:
      "PASS: synchronized",
    rollbackMessage:
      "FAIL: restoring",
  });
}

afterEach(() => {
  vi.restoreAllMocks();

  for (
    const directory
    of temporaryDirectories
  ) {
    fs.rmSync(
      directory,
      {
        recursive: true,
        force: true,
      },
    );
  }

  temporaryDirectories.clear();
});

describe(
  "synchronizeGovernanceDocuments",
  () => {
    test(
      "writes every rendered document and executes steps in order",
      () => {
        const {
          repositoryRoot,
          targetDirectory,
        } = createFixture();

        const orderFile =
          path.join(
            repositoryRoot,
            "order.txt",
          );

        const firstScript =
          createScript(
            repositoryRoot,
            "first.mjs",
            [
              'import fs from "node:fs";',
              `fs.appendFileSync(${JSON.stringify(orderFile)}, "first\\n");`,
              "",
            ].join("\n"),
          );

        const secondScript =
          createScript(
            repositoryRoot,
            "second.mjs",
            [
              'import fs from "node:fs";',
              `fs.appendFileSync(${JSON.stringify(orderFile)}, "second\\n");`,
              "",
            ].join("\n"),
          );

        const logSpy =
          vi.spyOn(
            console,
            "log",
          ).mockImplementation(
            () => {},
          );

        synchronize({
          repositoryRoot,
          targetDirectory,
          validationSteps: [
            {
              relativePath:
                firstScript,
            },
            {
              relativePath:
                secondScript,
            },
          ],
        });

        expect(
          readDocument(
            targetDirectory,
            "A.md",
          ),
        ).toBe(
          "rendered A\n",
        );

        expect(
          readDocument(
            targetDirectory,
            "B.md",
          ),
        ).toBe(
          "rendered B\n",
        );

        expect(
          fs.readFileSync(
            orderFile,
            "utf8",
          ),
        ).toBe(
          "first\nsecond\n",
        );

        expect(
          logSpy,
        ).toHaveBeenCalledWith(
          "PASS: synchronized",
        );

        expect(
          temporaryFiles(
            targetDirectory,
          ),
        ).toEqual([]);
      },
    );

    test(
      "restores all original documents after validation failure",
      () => {
        const {
          repositoryRoot,
          targetDirectory,
        } = createFixture();

        const failingScript =
          createScript(
            repositoryRoot,
            "fail.mjs",
            "process.exit(1);\n",
          );

        const errorSpy =
          vi.spyOn(
            console,
            "error",
          ).mockImplementation(
            () => {},
          );

        expect(() =>
          synchronize({
            repositoryRoot,
            targetDirectory,
            validationSteps: [
              {
                relativePath:
                  failingScript,
              },
            ],
          }),
        ).toThrow(
          `Validation failed: ${failingScript}`,
        );

        expect(
          readDocument(
            targetDirectory,
            "A.md",
          ),
        ).toBe(
          "original A\n",
        );

        expect(
          readDocument(
            targetDirectory,
            "B.md",
          ),
        ).toBe(
          "original B\n",
        );

        expect(
          errorSpy,
        ).toHaveBeenCalledWith(
          "FAIL: restoring",
        );

        expect(
          temporaryFiles(
            targetDirectory,
          ),
        ).toEqual([]);
      },
    );

    test(
      "passes arguments to validation and verification scripts",
      () => {
        const {
          repositoryRoot,
          targetDirectory,
        } = createFixture();

        const argumentFile =
          path.join(
            repositoryRoot,
            "argument.txt",
          );

        const argumentScript =
          createScript(
            repositoryRoot,
            "argument.mjs",
            [
              'import fs from "node:fs";',
              `fs.writeFileSync(${JSON.stringify(argumentFile)}, process.argv[2], "utf8");`,
              "",
            ].join("\n"),
          );

        vi.spyOn(
          console,
          "log",
        ).mockImplementation(
          () => {},
        );

        synchronize({
          repositoryRoot,
          targetDirectory,
          validationSteps: [
            {
              relativePath:
                argumentScript,
              args: [
                "governance/snapshots/example.json",
              ],
            },
          ],
        });

        expect(
          fs.readFileSync(
            argumentFile,
            "utf8",
          ),
        ).toBe(
          "governance/snapshots/example.json",
        );
      },
    );

    test(
      "fails before writing when a target document is missing",
      () => {
        const {
          repositoryRoot,
          targetDirectory,
        } = createFixture();

        const originalA =
          readDocument(
            targetDirectory,
            "A.md",
          );

        expect(() =>
          synchronizeGovernanceDocuments({
            repositoryRoot,
            targetDirectory,
            renderedDocuments: {
              "A.md":
                "rendered A\n",
              "MISSING.md":
                "rendered missing\n",
            },
            createValidationSteps() {
              return [];
            },
            successMessage:
              "PASS: synchronized",
            rollbackMessage:
              "FAIL: restoring",
          }),
        ).toThrow();

        expect(
          readDocument(
            targetDirectory,
            "A.md",
          ),
        ).toBe(
          originalA,
        );

        expect(
          fs.existsSync(
            path.join(
              targetDirectory,
              "MISSING.md",
            ),
          ),
        ).toBe(false);

        expect(
          temporaryFiles(
            targetDirectory,
          ),
        ).toEqual([]);
      },
    );
  },
);
