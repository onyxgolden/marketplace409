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

export function buildSynchronizationMetadata(
  governanceState,
  {
    evaluationDocument = false,
  } = {},
) {
  if (
    typeof governanceState !== "object" ||
    governanceState === null ||
    Array.isArray(governanceState)
  ) {
    throw new TypeError(
      "governanceState must be an object",
    );
  }

  const synchronization =
    governanceState.synchronization;

  const session = governanceState.session;

  if (
    typeof synchronization !== "object" ||
    synchronization === null ||
    Array.isArray(synchronization)
  ) {
    throw new TypeError(
      "governanceState.synchronization must be an object",
    );
  }

  if (
    typeof session !== "object" ||
    session === null ||
    Array.isArray(session)
  ) {
    throw new TypeError(
      "governanceState.session must be an object",
    );
  }

  const synchronizationLabel = evaluationDocument
    ? "Last Evaluation Update"
    : "Last Synchronization";

  const sessionLabel = evaluationDocument
    ? "Last Session ID"
    : "Session ID";

  const snapshotLabel = evaluationDocument
    ? "Last Evidence Snapshot"
    : "Evidence Snapshot";

  return [
    "## Synchronization Metadata",
    "",
    `**${synchronizationLabel}:** ${displayValue(
      synchronization.stateGeneratedAt,
      "Not yet generated",
    )}`,
    `**${sessionLabel}:** Not recorded`,
    `**${snapshotLabel}:** ${displayValue(
      synchronization.sourceSnapshot ??
        session.latestSnapshot,
    )}`,
    `**Renderer Version:** ${displayValue(
      synchronization.rendererVersion,
    )}`,
    `**Mode:** ${displayValue(
      synchronization.mode,
    )}`,
  ].join("\n");
}
