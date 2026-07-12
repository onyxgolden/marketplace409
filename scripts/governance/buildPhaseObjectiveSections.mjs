function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function displayValue(
  value,
  fallback = "Not recorded",
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  return String(value);
}

export function buildActivePhase(
  governanceState,
  {
    statusDocument = false,
  } = {},
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const state = governanceState.state;

  assertObject(
    state,
    "governanceState.state",
  );

  const activePhase = state.activePhase;

  assertObject(
    activePhase,
    "governanceState.state.activePhase",
  );

  const heading = statusDocument
    ? "## Current Architectural Phase"
    : "## Active Phase";

  return [
    heading,
    "",
    `**Phase:** ${displayValue(
      activePhase.identifier,
    )}`,
    `**Title:** ${displayValue(
      activePhase.title,
    )}`,
    `**Status:** ${displayValue(
      activePhase.status,
    )}`,
  ].join("\n");
}

export function buildCurrentObjective(
  governanceState,
  {
    statusDocument = false,
  } = {},
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const state = governanceState.state;

  assertObject(
    state,
    "governanceState.state",
  );

  const heading = statusDocument
    ? "## Immediate Objective"
    : "## Current Objective";

  return [
    heading,
    "",
    `${displayValue(
      state.currentObjective,
    )}.`,
  ].join("\n");
}
