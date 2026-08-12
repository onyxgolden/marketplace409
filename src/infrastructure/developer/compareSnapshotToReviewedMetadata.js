const METADATA_TEXT_FIELDS = Object.freeze({
  phaseIdentifier: (snapshot) => snapshot?.phase?.identifier,
  phaseTitle: (snapshot) => snapshot?.phase?.title,
  startingObjective: (snapshot) =>
    snapshot?.objective?.startingObjective,
  endingObjective: (snapshot) => snapshot?.objective?.endingObjective,
  incompleteReason: (snapshot) => snapshot?.completion?.incompleteReason,
  nextSessionObjective: (snapshot) => snapshot?.nextSession?.objective,
  nextSessionStartingInspection: (snapshot) =>
    snapshot?.nextSession?.startingInspection,
});

const METADATA_ARRAY_FIELDS = Object.freeze({
  deliveredWork: (snapshot) => snapshot?.work?.delivered,
  knownWarnings: (snapshot) => snapshot?.work?.knownWarnings,
});

const MAX_DISPLAY_VALUE_LENGTH = 160;

function truncateForDisplay(value) {
  const text = Array.isArray(value)
    ? JSON.stringify(value)
    : String(value ?? "(none)");

  return text.length > MAX_DISPLAY_VALUE_LENGTH
    ? `${text.slice(0, MAX_DISPLAY_VALUE_LENGTH)}…`
    : text;
}

function arraysEqual(expected, actual) {
  return (
    Array.isArray(actual) &&
    actual.length === expected.length &&
    expected.every((value, index) => value === actual[index])
  );
}

/**
 * Mirrors collectSessionEvidence.mjs's resolveCompletion() completion-
 * eligibility gate (evidence must cover the current commit and every
 * validation category must be "passing"), computed entirely from the
 * snapshot's own recorded evidence. This proves the snapshot's
 * completion.workComplete flag was correctly RESOLVED from the reviewer's
 * markSessionComplete choice -- not merely present -- without needing any
 * information beyond the snapshot itself.
 */
export function computeExpectedWorkComplete(
  snapshot,
  markSessionComplete,
) {
  if (markSessionComplete !== true) {
    return false;
  }

  const selectedArtifact =
    snapshot?.evidence?.selectedValidationArtifact ?? null;

  const evidenceCoversCurrentCommit =
    selectedArtifact !== null &&
    selectedArtifact.repositoryHead ===
      snapshot?.repository?.head;

  const validation = snapshot?.validation ?? {};

  const validationAllPassing =
    validation.focusedTests?.status === "passing" &&
    validation.fullTests?.status === "passing" &&
    validation.productionBuild?.status === "passing";

  return evidenceCoversCurrentCommit && validationAllPassing;
}

/**
 * Compares a session snapshot against the exact normalized
 * reviewedMetadata payload submitted for this run (i.e. the output of
 * validateReviewedSessionMetadata, NOT the raw dashboard payload).
 *
 * Only fields actually present in normalizedMetadata are compared -- per
 * the contract's documented semantics, an omitted field means "leave the
 * existing default in place" and must never be treated as a mismatch.
 *
 * Returns an array of mismatches (empty when the snapshot fully reflects
 * what was submitted). Each mismatch carries truncated, human-readable
 * expected/actual values -- never the whole snapshot or the whole
 * metadata payload, and never a filesystem path.
 */
export function compareSnapshotToReviewedMetadata(
  snapshot,
  normalizedMetadata,
) {
  const mismatches = [];

  for (const [field, readSnapshotValue] of Object.entries(
    METADATA_TEXT_FIELDS,
  )) {
    if (!(field in normalizedMetadata)) {
      continue;
    }

    const expected = normalizedMetadata[field];
    const actual = readSnapshotValue(snapshot);

    if (expected !== actual) {
      mismatches.push({
        field,
        expected: truncateForDisplay(expected),
        actual: truncateForDisplay(actual),
      });
    }
  }

  for (const [field, readSnapshotValue] of Object.entries(
    METADATA_ARRAY_FIELDS,
  )) {
    if (!(field in normalizedMetadata)) {
      continue;
    }

    const expected = normalizedMetadata[field];
    const actual = readSnapshotValue(snapshot);

    if (!arraysEqual(expected, actual)) {
      mismatches.push({
        field,
        expected: truncateForDisplay(expected),
        actual: truncateForDisplay(actual),
      });
    }
  }

  const expectedWorkComplete = computeExpectedWorkComplete(
    snapshot,
    normalizedMetadata.markSessionComplete === true,
  );

  const actualWorkComplete =
    snapshot?.completion?.workComplete === true;

  if (expectedWorkComplete !== actualWorkComplete) {
    mismatches.push({
      field: "markSessionComplete",
      expected: String(expectedWorkComplete),
      actual: String(actualWorkComplete),
    });
  }

  return mismatches;
}
