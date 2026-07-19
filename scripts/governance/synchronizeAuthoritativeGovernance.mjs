import path from "node:path";

import {
  executeAuthoritativeSynchronizationPlan,
} from "./executeAuthoritativeSynchronizationPlan.mjs";

import {
  planAuthoritativeSynchronization,
} from "./planAuthoritativeSynchronization.mjs";

const defaultGovernanceModePath =
  "governance/config/governance-mode.json";

const defaultDelegationsPath =
  "governance/config/authoritative-delegations.json";

function assertNonEmptyString(
  value,
  label,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string`,
    );
  }
}

export function synchronizeAuthoritativeGovernance(
  {
    repositoryRoot =
      process.cwd(),
    governanceModePath =
      defaultGovernanceModePath,
    delegationsPath =
      defaultDelegationsPath,
  } = {},
) {
  assertNonEmptyString(
    repositoryRoot,
    "repositoryRoot",
  );

  assertNonEmptyString(
    governanceModePath,
    "governanceModePath",
  );

  assertNonEmptyString(
    delegationsPath,
    "delegationsPath",
  );

  const normalizedRepositoryRoot =
    path.resolve(
      repositoryRoot,
    );

  const plan =
    planAuthoritativeSynchronization({
      repositoryRoot:
        normalizedRepositoryRoot,
      governanceModePath,
      delegationsPath,
    });

  return executeAuthoritativeSynchronizationPlan({
    repositoryRoot:
      normalizedRepositoryRoot,
    plan,
  });
}
