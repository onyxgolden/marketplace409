import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  enforceGovernance,
} from "./enforceGovernance.mjs";

import {
  loadGovernanceMode,
} from "./loadGovernanceMode.mjs";

import {
  synchronizeAuthoritativeGovernance,
} from "./synchronizeAuthoritativeGovernance.mjs";

import {
  executeShadowGovernanceTransaction,
} from "./executeShadowGovernanceTransaction.mjs";

import {
  dispatchGovernanceMode,
} from "./dispatchGovernanceMode.mjs";

const repositoryRoot = process.cwd();

function validatePipelineDependency(
  dependency,
  dependencyName,
) {
  if (
    typeof dependency !==
    "function"
  ) {
    throw new Error(
      `${dependencyName} must be a function`,
    );
  }

  return dependency;
}

export function runGovernancePipeline(
  {
    mode,
    validationEvidencePath,
    governanceStatePath,
    enforce =
      enforceGovernance,
    runShadowPipeline =
      executeShadowGovernanceTransaction,
    synchronizeAuthoritative =
      synchronizeAuthoritativeGovernance,
  } = {},
) {
  enforce =
    validatePipelineDependency(
      enforce,
      "enforce",
    );

  runShadowPipeline =
    validatePipelineDependency(
      runShadowPipeline,
      "runShadowPipeline",
    );

  synchronizeAuthoritative =
    validatePipelineDependency(
      synchronizeAuthoritative,
      "synchronizeAuthoritative",
    );

  const activeMode =
    mode ??
    loadGovernanceMode(
      undefined,
      {
        repositoryRoot,
      },
    ).mode;

  console.log(
    `FORGE governance mode: ${activeMode}`,
  );

  if (
    [
      "shadow",
      "hybrid",
      "authoritative",
    ].includes(activeMode)
  ) {
    enforce({
      repositoryRoot,
      validationEvidencePath,
      governanceStatePath,
    });
  }

  return dispatchGovernanceMode({
    mode: activeMode,
    runShadowPipeline,
    synchronizeAuthoritative,
  });
}

function isDirectExecution() {
  if (!process.argv[1]) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      path.resolve(process.argv[1]),
    ).href
  );
}

if (isDirectExecution()) {
  try {
    runGovernancePipeline();
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );
    process.exit(1);
  }
}
