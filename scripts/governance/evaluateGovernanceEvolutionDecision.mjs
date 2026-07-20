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

function collectBlockers({
  evolutionReadiness,
}) {
  const blockers = [];

  if (
    evolutionReadiness.eligible !== true
  ) {
    blockers.push(
      ...(
        evolutionReadiness.reasons ?? []
      ),
    );
  }

  return blockers;
}

function buildDecision({
  blockers,
}) {
  if (blockers.length > 0) {
    return {
      decision:
        "EVOLUTION_BLOCKED",

      eligible:
        false,

      rationale:
        "Evolution requirements are not satisfied.",

      blockers,

      requiredActions:
        blockers.map(
          (blocker) =>
            blocker.message,
        ),
    };
  }

  return {
    decision:
      "READY_FOR_REVIEW",

    eligible:
      true,

    rationale:
      "Evolution requirements are satisfied and human review is required.",

    blockers: [],

    requiredActions: [
      "Obtain explicit human approval before evolution.",
    ],
  };
}

export function evaluateGovernanceEvolutionDecision({
  repository,
  governance,
  evidence,
  promotion,
  evolutionReadiness,
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

  assertObject(
    evolutionReadiness,
    "evolutionReadiness",
  );

  const blockers =
    collectBlockers({
      evolutionReadiness,
    });

  return deepFreeze({
    ...buildDecision({
      blockers,
    }),

    requiresHumanApproval:
      true,
  });
}
