const MAX_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 50;
const MAX_ARRAY_ITEM_LENGTH = 500;

const ALLOWED_KEYS = new Set([
  "phaseIdentifier",
  "phaseTitle",
  "startingObjective",
  "endingObjective",
  "deliveredWork",
  "knownWarnings",
  "markSessionComplete",
  "incompleteReason",
  "nextSessionObjective",
  "nextSessionStartingInspection",
]);

const STRING_FIELDS = Object.freeze([
  "phaseIdentifier",
  "phaseTitle",
  "startingObjective",
  "endingObjective",
  "incompleteReason",
  "nextSessionObjective",
  "nextSessionStartingInspection",
]);

const ARRAY_FIELDS = Object.freeze([
  "deliveredWork",
  "knownWarnings",
]);

export class ReviewedSessionMetadataValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ReviewedSessionMetadataValidationError";
  }
}

function fail(message) {
  throw new ReviewedSessionMetadataValidationError(message);
}

function isPlainObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function validateStringField(value, field) {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    fail(`${field} must be a string`);
  }

  const trimmed = value.trim();

  if (trimmed.length === 0) {
    return undefined;
  }

  if (trimmed.length > MAX_STRING_LENGTH) {
    fail(
      `${field} must be ${MAX_STRING_LENGTH} characters or fewer`,
    );
  }

  return trimmed;
}

function validateArrayField(value, field) {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    fail(`${field} must be an array`);
  }

  if (value.length > MAX_ARRAY_ITEMS) {
    fail(
      `${field} must contain ${MAX_ARRAY_ITEMS} items or fewer`,
    );
  }

  return value.map((item, index) => {
    if (typeof item !== "string") {
      fail(`${field}[${index}] must be a string`);
    }

    const trimmed = item.trim();

    if (trimmed.length === 0) {
      fail(`${field}[${index}] must not be empty`);
    }

    if (trimmed.length > MAX_ARRAY_ITEM_LENGTH) {
      fail(
        `${field}[${index}] must be ${MAX_ARRAY_ITEM_LENGTH} characters or fewer`,
      );
    }

    return trimmed;
  });
}

/**
 * Validates and normalizes a reviewed-session-metadata payload.
 *
 * Every field is optional. A field that is omitted, or that is a
 * blank/whitespace-only string, is left out of the normalized result
 * entirely -- callers must treat an absent key as "leave the existing
 * default in place," never as "clear it to empty."
 *
 * This function performs no I/O and has no knowledge of validation
 * evidence, commits, or completion resolution. It only validates shape.
 */
export function validateReviewedSessionMetadata(payload) {
  if (!isPlainObject(payload)) {
    fail("Reviewed session metadata must be an object");
  }

  for (const key of Object.keys(payload)) {
    if (!ALLOWED_KEYS.has(key)) {
      fail(
        `Unrecognized reviewed session metadata field: ${key}`,
      );
    }
  }

  const normalized = {};

  for (const field of STRING_FIELDS) {
    const value = validateStringField(payload[field], field);

    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  for (const field of ARRAY_FIELDS) {
    const value = validateArrayField(payload[field], field);

    if (value !== undefined) {
      normalized[field] = value;
    }
  }

  if (payload.markSessionComplete !== undefined) {
    if (typeof payload.markSessionComplete !== "boolean") {
      fail("markSessionComplete must be a boolean");
    }

    normalized.markSessionComplete = payload.markSessionComplete;
  } else {
    normalized.markSessionComplete = false;
  }

  return Object.freeze(normalized);
}

/**
 * Applies validated reviewed metadata onto a base session snapshot,
 * overriding only fields the reviewer actually supplied. Fields left
 * out of reviewedMetadata are left untouched on the snapshot (so any
 * REVIEW_REQUIRED default the caller already set survives).
 *
 * Deliberately does NOT resolve markSessionComplete into
 * completion.workComplete / completion.supportedByEvidence. That
 * resolution depends on post-validation evidence eligibility for the
 * current commit, which this pure module has no access to -- callers
 * must resolve it themselves after validation evidence exists.
 *
 * Returns a new snapshot object; never mutates the input.
 */
export function applyReviewedSessionMetadata({
  snapshot,
  reviewedMetadata,
}) {
  if (!isPlainObject(snapshot)) {
    fail("snapshot must be an object");
  }

  if (!isPlainObject(reviewedMetadata)) {
    fail("reviewedMetadata must be an object");
  }

  const next = {
    ...snapshot,
    phase: { ...snapshot.phase },
    objective: { ...snapshot.objective },
    work: {
      ...snapshot.work,
      delivered: [...(snapshot.work.delivered || [])],
      knownWarnings: [
        ...(snapshot.work.knownWarnings || []),
      ],
    },
    completion: { ...snapshot.completion },
    nextSession: { ...snapshot.nextSession },
  };

  if (reviewedMetadata.phaseIdentifier !== undefined) {
    next.phase.identifier =
      reviewedMetadata.phaseIdentifier;
  }

  if (reviewedMetadata.phaseTitle !== undefined) {
    next.phase.title = reviewedMetadata.phaseTitle;
  }

  if (reviewedMetadata.startingObjective !== undefined) {
    next.objective.startingObjective =
      reviewedMetadata.startingObjective;
  }

  if (reviewedMetadata.endingObjective !== undefined) {
    next.objective.endingObjective =
      reviewedMetadata.endingObjective;
  }

  if (reviewedMetadata.deliveredWork !== undefined) {
    next.work.delivered = [
      ...reviewedMetadata.deliveredWork,
    ];
  }

  if (reviewedMetadata.knownWarnings !== undefined) {
    next.work.knownWarnings = [
      ...reviewedMetadata.knownWarnings,
    ];
  }

  if (reviewedMetadata.incompleteReason !== undefined) {
    next.completion.incompleteReason =
      reviewedMetadata.incompleteReason;
  }

  if (reviewedMetadata.nextSessionObjective !== undefined) {
    next.nextSession.objective =
      reviewedMetadata.nextSessionObjective;
  }

  if (
    reviewedMetadata.nextSessionStartingInspection !==
    undefined
  ) {
    next.nextSession.startingInspection =
      reviewedMetadata.nextSessionStartingInspection;
  }

  return Object.freeze(next);
}
