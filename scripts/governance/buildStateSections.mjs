function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function assertStringArray(value, location) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${location} must be an array`);
  }

  for (const [index, item] of value.entries()) {
    if (
      typeof item !== "string" ||
      item.length === 0
    ) {
      throw new TypeError(
        `${location}[${index}] must be a non-empty string`,
      );
    }
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

function buildBulletList(
  values,
  emptyMessage,
) {
  if (values.length === 0) {
    return emptyMessage;
  }

  return values
    .map((value) => `- ${value}`)
    .join("\n");
}

export function buildCompletedWork(
  governanceState,
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

  assertStringArray(
    state.completedWork,
    "governanceState.state.completedWork",
  );

  return [
    "## Completed",
    "",
    buildBulletList(
      state.completedWork,
      "None recorded.",
    ),
  ].join("\n");
}

export function buildLastCompletedWork(
  governanceState,
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

  assertStringArray(
    state.completedWork,
    "governanceState.state.completedWork",
  );

  const lastCompletedWork =
    state.completedWork.length === 0
      ? "None recorded."
      : state.completedWork[
          state.completedWork.length - 1
        ];

  return [
    "## Last Completed Work",
    "",
    lastCompletedWork,
  ].join("\n");
}

export function buildKnownWarnings(
  governanceState,
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

  assertStringArray(
    state.knownWarnings,
    "governanceState.state.knownWarnings",
  );

  return [
    "## Known Warnings",
    "",
    buildBulletList(
      state.knownWarnings,
      "None recorded.",
    ),
  ].join("\n");
}

export function buildStartingInspection(
  governanceState,
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

  const nextSession = state.nextSession;

  assertObject(
    nextSession,
    "governanceState.state.nextSession",
  );

  return [
    "## Starting Inspection",
    "",
    `${displayValue(
      nextSession.startingInspection,
    )}.`,
  ].join("\n");
}

export function buildCapabilityStatus(
  governanceState,
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const state = governanceState.state;
  const completion = governanceState.completion;

  assertObject(
    state,
    "governanceState.state",
  );

  assertObject(
    completion,
    "governanceState.completion",
  );

  assertStringArray(
    state.completedWork,
    "governanceState.state.completedWork",
  );

  const completedWork = buildBulletList(
    state.completedWork,
    "None recorded.",
  );

  const completionStatus =
    completion.workComplete === true
      ? "complete"
      : "incomplete";

  const evidenceStatus =
    completion.supportedByEvidence === true
      ? "yes"
      : "no";

  return [
    "## Repository Capability Status",
    "",
    "**Recorded completed work:**",
    "",
    completedWork,
    "",
    `**Work status:** ${completionStatus}`,
    `**Completion supported by evidence:** ${evidenceStatus}`,
    "",
    displayValue(
      completion.incompleteReason,
      completion.supportedByEvidence === true
        ? "Completion is supported by recorded evidence."
        : "Completion is not supported by recorded evidence.",
    ),
  ].join("\n");
}
