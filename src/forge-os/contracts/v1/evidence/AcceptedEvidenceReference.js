function isNonEmptyString(value) {
  return (
    typeof value === "string" &&
    value.trim().length > 0
  );
}

export function createAcceptedEvidenceReference({
  evidenceId,
  sourceComponent,
  acceptedAt,
} = {}) {
  if (!isNonEmptyString(evidenceId)) {
    throw new Error(
      "Accepted evidence reference requires an evidence ID.",
    );
  }

  if (!isNonEmptyString(sourceComponent)) {
    throw new Error(
      "Accepted evidence reference requires a source component.",
    );
  }

  return Object.freeze({
    evidenceId,
    sourceComponent,
    acceptedAt,
  });
}
