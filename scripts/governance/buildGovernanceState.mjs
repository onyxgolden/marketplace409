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

function assertString(value, location) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new TypeError(
      `${location} must be a non-empty string`,
    );
  }
}

function cloneStringArray(value, location) {
  if (!Array.isArray(value)) {
    throw new TypeError(
      `${location} must be an array`,
    );
  }

  return value.map(
    (item, index) => {
      assertString(
        item,
        `${location}[${index}]`,
      );

      return item;
    },
  );
}

export function buildGovernanceState({
  currentGovernanceState,
}) {
  assertObject(
    currentGovernanceState,
    "currentGovernanceState",
  );

  const currentState =
    currentGovernanceState.state;

  assertObject(
    currentState,
    "currentGovernanceState.state",
  );

  assertObject(
    currentState.activePhase,
    "currentGovernanceState.state.activePhase",
  );

  assertString(
    currentState.activePhase.identifier,
    "currentGovernanceState.state.activePhase.identifier",
  );

  assertString(
    currentState.activePhase.title,
    "currentGovernanceState.state.activePhase.title",
  );

  assertString(
    currentState.activePhase.status,
    "currentGovernanceState.state.activePhase.status",
  );

  assertString(
    currentState.currentObjective,
    "currentGovernanceState.state.currentObjective",
  );

  assertObject(
    currentState.nextSession,
    "currentGovernanceState.state.nextSession",
  );

  assertString(
    currentState.nextSession.objective,
    "currentGovernanceState.state.nextSession.objective",
  );

  assertString(
    currentState.nextSession.startingInspection,
    "currentGovernanceState.state.nextSession.startingInspection",
  );

  return {
    activePhase: {
      identifier:
        currentState.activePhase.identifier,

      title:
        currentState.activePhase.title,

      status:
        currentState.activePhase.status,
    },

    currentObjective:
      currentState.currentObjective,

    completedWork:
      cloneStringArray(
        currentState.completedWork,
        "currentGovernanceState.state.completedWork",
      ),

    knownWarnings:
      cloneStringArray(
        currentState.knownWarnings,
        "currentGovernanceState.state.knownWarnings",
      ),

    nextSession: {
      objective:
        currentState.nextSession.objective,

      startingInspection:
        currentState.nextSession.startingInspection,
    },
  };
}
