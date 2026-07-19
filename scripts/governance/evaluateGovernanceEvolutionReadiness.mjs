function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${location} must be an object`,
    );
  }
}

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}

function collectReasons({
  repository,
  governance,
  evidence,
  promotion,
}) {
  const reasons = [];

  if (
    repository.workingTreeClean !== true
  ) {
    reasons.push({
      code: "working-tree-not-clean",
      message:
        "Repository contains uncommitted changes.",
    });
  }

  if (
    repository.headMatchesOriginMain !== true
  ) {
    reasons.push({
      code: "head-does-not-match-origin-main",
      message:
        "Repository HEAD does not match origin/main.",
    });
  }

  if (
    governance.status !== "completed"
  ) {
    reasons.push({
      code: "governance-not-complete",
      message:
        "Governance pipeline did not complete successfully.",
    });
  }

  if (
    evidence.status !== "completed"
  ) {
    reasons.push({
      code: "session-evidence-not-complete",
      message:
        "Session evidence collection did not complete successfully.",
    });
  }

  if (
    promotion.eligible !== true
  ) {
    reasons.push({
      code: "promotion-not-eligible",
      message:
        "Promotion eligibility requirements are not satisfied.",
    });
  }

  return reasons;
}

export function evaluateGovernanceEvolutionReadiness({
  repository,
  governance,
  evidence,
  promotion,
}) {
  assertObject(
    repository,
    "repository",
  );

  assertObject(
    governance,
    "governance",
  );

  assertObject(
    evidence,
    "evidence",
  );

  assertObject(
    promotion,
    "promotion",
  );

  const reasons =
    collectReasons({
      repository,
      governance,
      evidence,
      promotion,
    });

  return deepFreeze({
    status:
      reasons.length === 0
        ? "ready"
        : "review-required",

    eligible:
      reasons.length === 0,

    requiresHumanApproval:
      true,

    reasons,
  });
}
