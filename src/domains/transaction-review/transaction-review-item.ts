export type TransactionReviewAssignmentStatus =
  | "unassigned"
  | "suggested"
  | "assigned";

export type TransactionReviewState = "pending" | "reviewed" | "ignored";

export type TransactionReviewItemInput = Readonly<{
  record: unknown;
  transaction: unknown;
  resolvedProperty: unknown;
  needsAssignment: boolean;
  confidence?: number;
  suggestedProperties?: readonly unknown[];
  assignmentStatus?: TransactionReviewAssignmentStatus;
  reviewState?: TransactionReviewState;
}>;

const VALID_ASSIGNMENT_STATUSES = new Set([
  "unassigned",
  "suggested",
  "assigned",
]);

const VALID_REVIEW_STATES = new Set(["pending", "reviewed", "ignored"]);

function buildDefaultAssignmentStatus(
  needsAssignment: boolean,
): TransactionReviewAssignmentStatus {
  return needsAssignment ? "unassigned" : "assigned";
}

export class TransactionReviewItem {
  readonly record: unknown;
  readonly transaction: unknown;
  readonly resolvedProperty: unknown;
  readonly needsAssignment: boolean;
  readonly confidence: number;
  readonly suggestedProperties: readonly unknown[];
  readonly assignmentStatus: TransactionReviewAssignmentStatus;
  readonly reviewState: TransactionReviewState;

  constructor({
    record,
    transaction,
    resolvedProperty,
    needsAssignment,
    confidence = 0,
    suggestedProperties = [],
    assignmentStatus = buildDefaultAssignmentStatus(needsAssignment),
    reviewState = "pending",
  }: TransactionReviewItemInput) {
    if (typeof needsAssignment !== "boolean") {
      throw new Error("TransactionReviewItem needsAssignment must be a boolean");
    }

    if (typeof confidence !== "number" || Number.isNaN(confidence)) {
      throw new Error("TransactionReviewItem confidence must be a number");
    }

    if (!Array.isArray(suggestedProperties)) {
      throw new Error(
        "TransactionReviewItem suggestedProperties must be an array",
      );
    }

    if (!VALID_ASSIGNMENT_STATUSES.has(assignmentStatus)) {
      throw new Error(
        "TransactionReviewItem assignmentStatus must be valid",
      );
    }

    if (!VALID_REVIEW_STATES.has(reviewState)) {
      throw new Error("TransactionReviewItem reviewState must be valid");
    }

    this.record = record;
    this.transaction = transaction;
    this.resolvedProperty = resolvedProperty;
    this.needsAssignment = needsAssignment;
    this.confidence = confidence;
    this.suggestedProperties = Object.freeze([...suggestedProperties]);
    this.assignmentStatus = assignmentStatus;
    this.reviewState = reviewState;

    Object.freeze(this);
  }

  toJSON() {
    return {
      record: this.record,
      transaction: this.transaction,
      resolvedProperty: this.resolvedProperty,
      needsAssignment: this.needsAssignment,
      confidence: this.confidence,
      suggestedProperties: this.suggestedProperties,
      assignmentStatus: this.assignmentStatus,
      reviewState: this.reviewState,
    };
  }
}
