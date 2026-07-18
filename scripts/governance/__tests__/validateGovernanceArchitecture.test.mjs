import { spawnSync } from "node:child_process";
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
  validateGovernanceArchitecture,
} from "../validateGovernanceArchitecture.mjs";

const temporaryDirectories = [];

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-architecture-",
      ),
    );

  temporaryDirectories.push(
    repositoryRoot,
  );

  return repositoryRoot;
}

function createFile(
  repositoryRoot,
  relativePath,
  content = "",
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
}

function createDirectory(
  repositoryRoot,
  relativePath,
) {
  fs.mkdirSync(
    path.join(
      repositoryRoot,
      relativePath,
    ),
    {
      recursive: true,
    },
  );
}

function captureRepositoryFiles(
  repositoryRoot,
) {
  function walk(
    currentDirectory,
  ) {
    return fs
      .readdirSync(
        currentDirectory,
        {
          withFileTypes: true,
        },
      )
      .sort(
        (left, right) =>
          left.name.localeCompare(
            right.name,
          ),
      )
      .flatMap(
        (entry) => {
          const absolutePath =
            path.join(
              currentDirectory,
              entry.name,
            );

          const relativePath =
            path.relative(
              repositoryRoot,
              absolutePath,
            );

          if (entry.isDirectory()) {
            return [
              `${relativePath}/`,
              ...walk(
                absolutePath,
              ),
            ];
          }

          return [
            `${relativePath}:${fs.readFileSync(
              absolutePath,
              "utf8",
            )}`,
          ];
        },
      );
  }

  return walk(
    repositoryRoot,
  );
}

afterEach(() => {
  for (
    const temporaryDirectory
    of temporaryDirectories.splice(0)
  ) {
    fs.rmSync(
      temporaryDirectory,
      {
        recursive: true,
        force: true,
      },
    );
  }
});

describe(
  "validateGovernanceArchitecture",
  () => {
    test(
      "validates required governance documents and directories",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createFile(
          repositoryRoot,
          "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
          "# Governance Specification\n",
        );

        createDirectory(
          repositoryRoot,
          "governance/policies",
        );

        const result =
          validateGovernanceArchitecture({
            repositoryRoot,

            requiredDocuments: [
              "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
            ],

            requiredDirectories: [
              "governance/policies",
            ],
          });

        expect(result).toEqual({
          version: "1.0",
          valid: true,
          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),
          documents: [
            "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
          ],
          directories: [
            "governance/policies",
          ],
          checkedPaths: [
            "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
            "governance/policies",
          ],
        });
      },
    );

    test(
      "rejects a missing required governance document",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(
          () =>
            validateGovernanceArchitecture({
              repositoryRoot,

              requiredDocuments: [
                "docs/architecture/MISSING.md",
              ],

              requiredDirectories: [],
            }),
        ).toThrow(
          "Required governance document does not exist: docs/architecture/MISSING.md",
        );
      },
    );

    test(
      "rejects a missing required governance directory",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(
          () =>
            validateGovernanceArchitecture({
              repositoryRoot,

              requiredDocuments: [],

              requiredDirectories: [
                "governance/missing",
              ],
            }),
        ).toThrow(
          "Required governance directory does not exist: governance/missing",
        );
      },
    );

    test(
      "rejects architecture paths outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(
          () =>
            validateGovernanceArchitecture({
              repositoryRoot,

              requiredDocuments: [
                "../outside.md",
              ],

              requiredDirectories: [],
            }),
        ).toThrow(
          "Governance architecture path must remain inside the repository: ../outside.md",
        );
      },
    );

    test(
      "returns paths in deterministic order",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createFile(
          repositoryRoot,
          "docs/zeta.md",
        );

        createFile(
          repositoryRoot,
          "docs/alpha.md",
        );

        createDirectory(
          repositoryRoot,
          "governance/zeta",
        );

        createDirectory(
          repositoryRoot,
          "governance/alpha",
        );

        const result =
          validateGovernanceArchitecture({
            repositoryRoot,

            requiredDocuments: [
              "docs/zeta.md",
              "docs/alpha.md",
            ],

            requiredDirectories: [
              "governance/zeta",
              "governance/alpha",
            ],
          });

        expect(
          result.documents,
        ).toEqual([
          "docs/alpha.md",
          "docs/zeta.md",
        ]);

        expect(
          result.directories,
        ).toEqual([
          "governance/alpha",
          "governance/zeta",
        ]);

        expect(
          result.checkedPaths,
        ).toEqual([
          "docs/alpha.md",
          "docs/zeta.md",
          "governance/alpha",
          "governance/zeta",
        ]);
      },
    );

    test(
      "returns immutable validation results",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createFile(
          repositoryRoot,
          "docs/architecture.md",
        );

        const result =
          validateGovernanceArchitecture({
            repositoryRoot,

            requiredDocuments: [
              "docs/architecture.md",
            ],

            requiredDirectories: [],
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
            result.directories,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.checkedPaths,
          ),
        ).toBe(true);

        expect(
          () =>
            result.documents.push(
              "docs/other.md",
            ),
        ).toThrow();
      },
    );

    test(
      "does not mutate repository contents",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createFile(
          repositoryRoot,
          "docs/architecture.md",
          "authoritative content\n",
        );

        createDirectory(
          repositoryRoot,
          "governance/policies",
        );

        const before =
          captureRepositoryFiles(
            repositoryRoot,
          );

        validateGovernanceArchitecture({
          repositoryRoot,

          requiredDocuments: [
            "docs/architecture.md",
          ],

          requiredDirectories: [
            "governance/policies",
          ],
        });

        const after =
          captureRepositoryFiles(
            repositoryRoot,
          );

        expect(after).toEqual(
          before,
        );
      },
    );
    test(
      "exits successfully when CLI validation passes",
      () => {
        const validatorScriptPath =
          path.resolve(
            process.cwd(),
            "scripts/governance/validateGovernanceArchitecture.mjs",
          );

        const result =
          spawnSync(
            process.execPath,
            [
              validatorScriptPath,
            ],
            {
              cwd:
                process.cwd(),

              encoding:
                "utf8",
            },
          );

        expect(
          result.status,
        ).toBe(0);

        expect(
          result.stdout,
        ).toContain(
          "PASS: Governance architecture validation passed.",
        );

        expect(
          result.stderr,
        ).toBe("");
      },
    );

    test(
      "exits with failure status when CLI validation fails",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const validatorScriptPath =
          path.resolve(
            process.cwd(),
            "scripts/governance/validateGovernanceArchitecture.mjs",
          );

        const result =
          spawnSync(
            process.execPath,
            [
              validatorScriptPath,
            ],
            {
              cwd:
                repositoryRoot,

              encoding:
                "utf8",
            },
          );

        expect(
          result.status,
        ).toBe(1);

        expect(
          result.stderr,
        ).toContain(
          "FAIL: Required governance document does not exist:",
        );

        expect(
          result.stdout,
        ).toBe("");
      },
    ); 
 },
);
