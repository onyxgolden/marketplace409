import path from "node:path";
import { pathToFileURL } from "node:url";

import { renderAllShadowDocuments } from "./renderShadowDocuments.mjs";
import { loadGovernanceState } from "./loadGovernanceState.mjs";
import {
  synchronizeGovernanceDocuments,
} from "./synchronizeGovernanceDocuments.mjs";

const repositoryRoot = process.cwd();

const synchronizedDirectory = path.join(
  repositoryRoot,
  "docs",
  "architecture",
  "synchronized",
);

export function synchronizeShadowGovernance() {
  const renderedDocuments =
    renderAllShadowDocuments({
      repositoryRoot,
    });

  synchronizeGovernanceDocuments({
    repositoryRoot,
    targetDirectory:
      synchronizedDirectory,
    renderedDocuments,
    createValidationSteps() {
      const governanceState =
        loadGovernanceState(
          "governance/state/current-governance-state.json",
          {
            repositoryRoot,
          },
        );

      return [
        {
          relativePath:
            "scripts/governance/validateGovernanceState.mjs",
        },
        {
          relativePath:
            "scripts/governance/validateSessionSnapshot.mjs",
          args: [
            governanceState.session.latestSnapshot,
          ],
        },
        {
          relativePath:
            "scripts/governance/verifyShadowGovernance.mjs",
        },
      ];
    },
    successMessage:
      "PASS: Shadow governance synchronized successfully.",
    rollbackMessage:
      "Synchronization failed. Restoring original shadow documents...",
  });
}

function isDirectExecution() {
  const invokedScriptPath =
    process.argv[1];

  if (!invokedScriptPath) {
    return false;
  }

  return import.meta.url ===
    pathToFileURL(
      path.resolve(
        invokedScriptPath,
      ),
    ).href;
}

if (isDirectExecution()) {
  try {
    synchronizeShadowGovernance();
  } catch (error) {
    console.error(
      error.message,
    );

    process.exit(1);
  }
}
