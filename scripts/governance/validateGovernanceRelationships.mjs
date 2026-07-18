import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const defaultRepositoryRoot =
  process.cwd();

export const GOVERNANCE_RELATIONSHIPS_VERSION =
  "1.0";

export const GOVERNANCE_RELATIONSHIP_MODEL =
  Object.freeze([
    Object.freeze({
      id:
        "engineering-law",

      label:
        "Engineering Law",

      authorityParentId:
        null,

      canonicalOwners:
        Object.freeze([
          Object.freeze({
            path:
              "docs/architecture/FORGE_CONSTITUTION.md",

            type:
              "file",
          }),
        ]),
    }),

    Object.freeze({
      id:
        "governance-specification",

      label:
        "Governance Specification",

      authorityParentId:
        "engineering-law",

      canonicalOwners:
        Object.freeze([
          Object.freeze({
            path:
              "docs/architecture/FORGE_GOVERNANCE_SPECIFICATION.md",

            type:
              "file",
          }),
        ]),
    }),

    Object.freeze({
      id:
        "governance-policy",

      label:
        "Governance Policy",

      authorityParentId:
        "governance-specification",

      canonicalOwners:
        Object.freeze([
          Object.freeze({
            path:
              "governance/policies",

            type:
              "directory",
          }),
        ]),
    }),

    Object.freeze({
      id:
        "governance-execution",

      label:
        "Governance Execution",

      authorityParentId:
        "governance-policy",

      canonicalOwners:
        Object.freeze([
          Object.freeze({
            path:
              "scripts/governance",

            type:
              "directory",
          }),
        ]),
    }),

    Object.freeze({
      id:
        "governance-validation",

      label:
        "Governance Validation",

      authorityParentId:
        "governance-execution",

      canonicalOwners:
        Object.freeze([
          Object.freeze({
            path:
              "scripts/governance/__tests__",

            type:
              "directory",
          }),
        ]),
    }),

    Object.freeze({
      id:
        "repository-evidence",

      label:
        "Repository Evidence",

      authorityParentId:
        "governance-validation",

      canonicalOwners:
        Object.freeze([
          Object.freeze({
            path:
              "governance/snapshots",

            type:
              "directory",
          }),

          Object.freeze({
            path:
              "governance/state",

            type:
              "directory",
          }),

          Object.freeze({
            path:
              "governance/validation",

            type:
              "directory",
          }),
        ]),
    }),
  ]);

function assertNonEmptyString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function assertRelationshipArray(
  relationships,
) {
  if (!Array.isArray(relationships)) {
    throw new TypeError(
      "relationships must be an array",
    );
  }
}

function normalizeRepositoryRoot(
  repositoryRoot,
) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  return path.resolve(
    repositoryRoot,
  );
}

function resolveRepositoryPath(
  repositoryRoot,
  suppliedPath,
) {
  assertNonEmptyString(
    suppliedPath,
    "canonicalOwner.path",
  );

  const absolutePath =
    path.resolve(
      repositoryRoot,
      suppliedPath,
    );

  const relativePath =
    path.relative(
      repositoryRoot,
      absolutePath,
    );

  if (
    relativePath === ".." ||
    relativePath.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(
      relativePath,
    )
  ) {
    throw new Error(
      `Governance relationship path must remain inside the repository: ${suppliedPath}`,
    );
  }

  return Object.freeze({
    absolutePath,

    relativePath:
      relativePath || ".",
  });
}

function validateCanonicalOwner(
  repositoryRoot,
  canonicalOwner,
  nodeId,
  ownerIndex,
) {
  if (
    typeof canonicalOwner !== "object" ||
    canonicalOwner === null ||
    Array.isArray(canonicalOwner)
  ) {
    throw new TypeError(
      `relationships.${nodeId}.canonicalOwners[${ownerIndex}] must be an object`,
    );
  }

  assertNonEmptyString(
    canonicalOwner.path,
    `relationships.${nodeId}.canonicalOwners[${ownerIndex}].path`,
  );

  if (
    canonicalOwner.type !== "file" &&
    canonicalOwner.type !== "directory"
  ) {
    throw new Error(
      `Canonical owner type must be file or directory: ${canonicalOwner.path}`,
    );
  }

  const resolved =
    resolveRepositoryPath(
      repositoryRoot,
      canonicalOwner.path,
    );

  if (
    !fs.existsSync(
      resolved.absolutePath,
    )
  ) {
    throw new Error(
      `Canonical owner does not exist for governance node ${nodeId}: ${resolved.relativePath}`,
    );
  }

  const fileStatus =
    fs.statSync(
      resolved.absolutePath,
    );

  if (
    canonicalOwner.type === "file" &&
    !fileStatus.isFile()
  ) {
    throw new Error(
      `Canonical owner is not a file for governance node ${nodeId}: ${resolved.relativePath}`,
    );
  }

  if (
    canonicalOwner.type === "directory" &&
    !fileStatus.isDirectory()
  ) {
    throw new Error(
      `Canonical owner is not a directory for governance node ${nodeId}: ${resolved.relativePath}`,
    );
  }

  return Object.freeze({
    path:
      resolved.relativePath,

    type:
      canonicalOwner.type,
  });
}

function validateRelationshipDefinitions(
  relationships,
) {
  const nodeIds =
    new Set();

  const nodeLabels =
    new Set();

  relationships.forEach(
    (relationship, index) => {
      if (
        typeof relationship !== "object" ||
        relationship === null ||
        Array.isArray(
          relationship,
        )
      ) {
        throw new TypeError(
          `relationships[${index}] must be an object`,
        );
      }

      assertNonEmptyString(
        relationship.id,
        `relationships[${index}].id`,
      );

      assertNonEmptyString(
        relationship.label,
        `relationships[${index}].label`,
      );

      if (
        relationship.authorityParentId !== null
      ) {
        assertNonEmptyString(
          relationship.authorityParentId,
          `relationships[${index}].authorityParentId`,
        );
      }

      if (
        !Array.isArray(
          relationship.canonicalOwners,
        ) ||
        relationship.canonicalOwners.length === 0
      ) {
        throw new Error(
          `Governance node must have at least one canonical owner: ${relationship.id}`,
        );
      }

      if (
        nodeIds.has(
          relationship.id,
        )
      ) {
        throw new Error(
          `Duplicate governance node id: ${relationship.id}`,
        );
      }

      if (
        nodeLabels.has(
          relationship.label,
        )
      ) {
        throw new Error(
          `Duplicate governance node label: ${relationship.label}`,
        );
      }

      nodeIds.add(
        relationship.id,
      );

      nodeLabels.add(
        relationship.label,
      );
    },
  );

  return nodeIds;
}

function validateAuthorityGraph(
  relationships,
  nodeIds,
) {
  const roots =
    relationships.filter(
      (relationship) =>
        relationship.authorityParentId ===
        null,
    );

  if (roots.length !== 1) {
    throw new Error(
      `Governance authority graph must contain exactly one root; received ${roots.length}`,
    );
  }

  const relationshipsById =
    new Map(
      relationships.map(
        (relationship) => [
          relationship.id,
          relationship,
        ],
      ),
    );

  for (
    const relationship
    of relationships
  ) {
    if (
      relationship.authorityParentId ===
      relationship.id
    ) {
      throw new Error(
        `Governance node cannot be its own authority parent: ${relationship.id}`,
      );
    }

    if (
      relationship.authorityParentId !==
        null &&
      !nodeIds.has(
        relationship.authorityParentId,
      )
    ) {
      throw new Error(
        `Governance authority parent does not exist for ${relationship.id}: ${relationship.authorityParentId}`,
      );
    }

    const visited =
      new Set();

    let current =
      relationship;

    while (
      current.authorityParentId !==
      null
    ) {
      if (
        visited.has(
          current.id,
        )
      ) {
        throw new Error(
          `Governance authority cycle detected at node: ${current.id}`,
        );
      }

      visited.add(
        current.id,
      );

      current =
        relationshipsById.get(
          current.authorityParentId,
        );
    }
  }

  return roots[0].id;
}

function freezeArray(
  values,
) {
  return Object.freeze([
    ...values,
  ]);
}

function freezeNode(
  node,
) {
  return Object.freeze({
    id:
      node.id,

    label:
      node.label,

    authorityParentId:
      node.authorityParentId,

    canonicalOwners:
      freezeArray(
        node.canonicalOwners,
      ),
  });
}

export function validateGovernanceRelationships({
  repositoryRoot =
    defaultRepositoryRoot,

  relationships =
    GOVERNANCE_RELATIONSHIP_MODEL,
} = {}) {
  const normalizedRepositoryRoot =
    normalizeRepositoryRoot(
      repositoryRoot,
    );

  assertRelationshipArray(
    relationships,
  );

  const nodeIds =
    validateRelationshipDefinitions(
      relationships,
    );

  const rootNodeId =
    validateAuthorityGraph(
      relationships,
      nodeIds,
    );

  const claimedOwnerPaths =
    new Map();

  const validatedNodes =
    [...relationships]
      .sort(
        (left, right) =>
          left.id.localeCompare(
            right.id,
          ),
      )
      .map(
        (relationship) => {
          const canonicalOwners =
            relationship
              .canonicalOwners
              .map(
                (
                  canonicalOwner,
                  ownerIndex,
                ) =>
                  validateCanonicalOwner(
                    normalizedRepositoryRoot,
                    canonicalOwner,
                    relationship.id,
                    ownerIndex,
                  ),
              )
              .sort(
                (left, right) =>
                  left.path.localeCompare(
                    right.path,
                  ),
              );

          for (
            const canonicalOwner
            of canonicalOwners
          ) {
            const existingOwner =
              claimedOwnerPaths.get(
                canonicalOwner.path,
              );

            if (
              existingOwner &&
              existingOwner !==
                relationship.id
            ) {
              throw new Error(
                `Canonical owner is assigned to multiple governance nodes: ${canonicalOwner.path}`,
              );
            }

            claimedOwnerPaths.set(
              canonicalOwner.path,
              relationship.id,
            );
          }

          return freezeNode({
            id:
              relationship.id,

            label:
              relationship.label,

            authorityParentId:
              relationship.authorityParentId,

            canonicalOwners,
          });
        },
      );

  const authorityEdges =
    validatedNodes
      .filter(
        (node) =>
          node.authorityParentId !==
          null,
      )
      .map(
        (node) =>
          Object.freeze({
            authorityId:
              node.authorityParentId,

            dependentId:
              node.id,
          }),
      )
      .sort(
        (left, right) =>
          `${left.authorityId}:${left.dependentId}`
            .localeCompare(
              `${right.authorityId}:${right.dependentId}`,
            ),
      );

  const checkedOwnerPaths =
    [...claimedOwnerPaths.keys()]
      .sort();

  return Object.freeze({
    version:
      GOVERNANCE_RELATIONSHIPS_VERSION,

    valid:
      true,

    repositoryRoot:
      normalizedRepositoryRoot,

    rootNodeId,

    nodes:
      freezeArray(
        validatedNodes,
      ),

    authorityEdges:
      freezeArray(
        authorityEdges,
      ),

    checkedOwnerPaths:
      freezeArray(
        checkedOwnerPaths,
      ),
  });
}

function isDirectExecution() {
  const suppliedScriptPath =
    process.argv[1];

  if (!suppliedScriptPath) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      path.resolve(
        suppliedScriptPath,
      ),
    ).href
  );
}

if (isDirectExecution()) {
  try {
    const result =
      validateGovernanceRelationships();

    console.log(
      `PASS: Governance relationship validation passed. Checked ${result.nodes.length} governance nodes, ${result.authorityEdges.length} authority relationships, and ${result.checkedOwnerPaths.length} canonical owner paths.`,
    );
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );

    process.exitCode = 1;
  }
}
