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
  GOVERNANCE_RELATIONSHIP_MODEL,
  validateGovernanceRelationships,
} from "../validateGovernanceRelationships.mjs";

const temporaryDirectories = [];

function createTemporaryRepository() {
  const repositoryRoot =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-governance-relationships-",
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

function createValidRelationshipFixture() {
  return [
    {
      id:
        "engineering-law",

      label:
        "Engineering Law",

      authorityParentId:
        null,

      canonicalOwners: [
        {
          path:
            "docs/architecture/FORGE_CONSTITUTION.md",

          type:
            "file",
        },
      ],
    },

    {
      id:
        "governance-specification",

      label:
        "Governance Specification",

      authorityParentId:
        "engineering-law",

      canonicalOwners: [
        {
          path:
            "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",

          type:
            "file",
        },
      ],
    },

    {
      id:
        "governance-policy",

      label:
        "Governance Policy",

      authorityParentId:
        "governance-specification",

      canonicalOwners: [
        {
          path:
            "governance/policies",

          type:
            "directory",
        },
      ],
    },
  ];
}

function createValidRepositoryFixture(
  repositoryRoot,
) {
  createFile(
    repositoryRoot,
    "docs/architecture/FORGE_CONSTITUTION.md",
    "# FORGE Constitution\n",
  );

  createFile(
    repositoryRoot,
    "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
    "# Governance Specification\n",
  );

  createDirectory(
    repositoryRoot,
    "governance/policies",
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
  "validateGovernanceRelationships",
  () => {
    test(
      "validates the canonical governance relationship graph",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createValidRepositoryFixture(
          repositoryRoot,
        );

        const result =
          validateGovernanceRelationships({
            repositoryRoot,

            relationships:
              createValidRelationshipFixture(),
          });

        expect(result).toEqual({
          version:
            "1.0",

          valid:
            true,

          repositoryRoot:
            path.resolve(
              repositoryRoot,
            ),

          rootNodeId:
            "engineering-law",

          nodes: [
            {
              id:
                "engineering-law",

              label:
                "Engineering Law",

              authorityParentId:
                null,

              canonicalOwners: [
                {
                  path:
                    "docs/architecture/FORGE_CONSTITUTION.md",

                  type:
                    "file",
                },
              ],
            },

            {
              id:
                "governance-policy",

              label:
                "Governance Policy",

              authorityParentId:
                "governance-specification",

              canonicalOwners: [
                {
                  path:
                    "governance/policies",

                  type:
                    "directory",
                },
              ],
            },

            {
              id:
                "governance-specification",

              label:
                "Governance Specification",

              authorityParentId:
                "engineering-law",

              canonicalOwners: [
                {
                  path:
                    "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",

                  type:
                    "file",
                },
              ],
            },
          ],

          authorityEdges: [
            {
              authorityId:
                "engineering-law",

              dependentId:
                "governance-specification",
            },

            {
              authorityId:
                "governance-specification",

              dependentId:
                "governance-policy",
            },
          ],

          checkedOwnerPaths: [
            "docs/architecture/FORGE_CONSTITUTION.md",
            "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
            "governance/policies",
          ],
        });
      },
    );

    test(
      "uses the immutable canonical relationship model by default",
      () => {
        expect(
          Object.isFrozen(
            GOVERNANCE_RELATIONSHIP_MODEL,
          ),
        ).toBe(true);

        for (
          const relationship
          of GOVERNANCE_RELATIONSHIP_MODEL
        ) {
          expect(
            Object.isFrozen(
              relationship,
            ),
          ).toBe(true);

          expect(
            Object.isFrozen(
              relationship.canonicalOwners,
            ),
          ).toBe(true);

          for (
            const owner
            of relationship.canonicalOwners
          ) {
            expect(
              Object.isFrozen(
                owner,
              ),
            ).toBe(true);
          }
        }
      },
    );

    test(
      "rejects a governance node without a canonical owner",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,

              relationships: [
                {
                  id:
                    "engineering-law",

                  label:
                    "Engineering Law",

                  authorityParentId:
                    null,

                  canonicalOwners:
                    [],
                },
              ],
            }),
        ).toThrow(
          "Governance node must have at least one canonical owner: engineering-law",
        );
      },
    );

    test(
      "rejects duplicate governance node identifiers",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[1].id =
          "engineering-law";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Duplicate governance node id: engineering-law",
        );
      },
    );

    test(
      "rejects duplicate governance node labels",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[1].label =
          "Engineering Law";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Duplicate governance node label: Engineering Law",
        );
      },
    );

    test(
      "rejects an authority parent that does not exist",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[1].authorityParentId =
          "missing-authority";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Governance authority parent does not exist for governance-specification: missing-authority",
        );
      },
    );

    test(
      "rejects a governance node that names itself as its authority parent",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[1].authorityParentId =
          "governance-specification";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Governance node cannot be its own authority parent: governance-specification",
        );
      },
    );

    test(
      "rejects an authority graph with multiple roots",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[1].authorityParentId =
          null;

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Governance authority graph must contain exactly one root; received 2",
        );
      },
    );

    test(
      "rejects an authority graph without a root",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[0].authorityParentId =
          "governance-policy";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Governance authority graph must contain exactly one root; received 0",
        );
      },
    );

    test(
      "rejects an authority cycle",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships.push({
          id:
            "independent-root",

          label:
            "Independent Root",

          authorityParentId:
            null,

          canonicalOwners: [
            {
              path:
                "governance/independent",

              type:
                "directory",
            },
          ],
        });

        relationships[0].authorityParentId =
          "governance-policy";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Governance authority cycle detected",
        );
      },
    );

    test(
      "rejects a missing canonical owner path",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,

              relationships:
                createValidRelationshipFixture(),
            }),
        ).toThrow(
          "Canonical owner does not exist for governance node engineering-law: docs/architecture/FORGE_CONSTITUTION.md",
        );
      },
    );

    test(
      "rejects a canonical owner with the wrong filesystem type",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createValidRepositoryFixture(
          repositoryRoot,
        );

        const relationships =
          createValidRelationshipFixture();

        relationships[0]
          .canonicalOwners[0]
          .type =
            "directory";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Canonical owner is not a directory for governance node engineering-law: docs/architecture/FORGE_CONSTITUTION.md",
        );
      },
    );

    test(
      "rejects an unsupported canonical owner type",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[0]
          .canonicalOwners[0]
          .type =
            "link";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Canonical owner type must be file or directory: docs/architecture/FORGE_CONSTITUTION.md",
        );
      },
    );

    test(
      "rejects relationship paths outside the repository",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        const relationships =
          createValidRelationshipFixture();

        relationships[0]
          .canonicalOwners[0]
          .path =
            "../outside.md";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Governance relationship path must remain inside the repository: ../outside.md",
        );
      },
    );

    test(
      "rejects a canonical owner assigned to multiple governance nodes",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createValidRepositoryFixture(
          repositoryRoot,
        );

        const relationships =
          createValidRelationshipFixture();

        relationships[1]
          .canonicalOwners[0]
          .path =
            "docs/architecture/FORGE_CONSTITUTION.md";

        expect(
          () =>
            validateGovernanceRelationships({
              repositoryRoot,
              relationships,
            }),
        ).toThrow(
          "Canonical owner is assigned to multiple governance nodes: docs/architecture/FORGE_CONSTITUTION.md",
        );
      },
    );

    test(
      "returns governance nodes, edges, and owner paths in deterministic order",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createValidRepositoryFixture(
          repositoryRoot,
        );

        const relationships =
          createValidRelationshipFixture()
            .reverse();

        const result =
          validateGovernanceRelationships({
            repositoryRoot,
            relationships,
          });

        expect(
          result.nodes.map(
            (node) =>
              node.id,
          ),
        ).toEqual([
          "engineering-law",
          "governance-policy",
          "governance-specification",
        ]);

        expect(
          result.authorityEdges,
        ).toEqual([
          {
            authorityId:
              "engineering-law",

            dependentId:
              "governance-specification",
          },

          {
            authorityId:
              "governance-specification",

            dependentId:
              "governance-policy",
          },
        ]);

        expect(
          result.checkedOwnerPaths,
        ).toEqual([
          "docs/architecture/FORGE_CONSTITUTION.md",
          "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",
          "governance/policies",
        ]);
      },
    );

    test(
      "returns deeply immutable validation results",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createValidRepositoryFixture(
          repositoryRoot,
        );

        const result =
          validateGovernanceRelationships({
            repositoryRoot,

            relationships:
              createValidRelationshipFixture(),
          });

        expect(
          Object.isFrozen(
            result,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.nodes,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.nodes[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.nodes[0]
              .canonicalOwners,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.nodes[0]
              .canonicalOwners[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.authorityEdges,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.authorityEdges[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.checkedOwnerPaths,
          ),
        ).toBe(true);

        expect(
          () =>
            result.nodes.push({
              id:
                "invalid",
            }),
        ).toThrow();

        expect(
          () => {
            result.nodes[0].label =
              "Changed";
          },
        ).toThrow();
      },
    );

    test(
      "does not mutate repository contents",
      () => {
        const repositoryRoot =
          createTemporaryRepository();

        createValidRepositoryFixture(
          repositoryRoot,
        );

        const before =
          captureRepositoryFiles(
            repositoryRoot,
          );

        validateGovernanceRelationships({
          repositoryRoot,

          relationships:
            createValidRelationshipFixture(),
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
            "scripts/governance/validateGovernanceRelationships.mjs",
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
          "PASS: Governance relationship validation passed.",
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
            "scripts/governance/validateGovernanceRelationships.mjs",
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
          "FAIL: Canonical owner does not exist for governance node",
        );

        expect(
          result.stdout,
        ).toBe("");
      },
    );
  },
);
