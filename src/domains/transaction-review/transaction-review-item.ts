export type TransactionReviewItemInput = Readonly<{
  record: unknown;
  transaction: unknown;
  resolvedProperty: unknown;
  needsAssignment: boolean;
}>;

export class TransactionReviewItem {
  readonly record: unknown;
  readonly transaction: unknown;
  readonly resolvedProperty: unknown;
  readonly needsAssignment: boolean;

  constructor({
    record,
    transaction,
    resolvedProperty,
    needsAssignment,
  }: TransactionReviewItemInput) {
    if (typeof needsAssignment !== "boolean") {
      throw new Error("TransactionReviewItem needsAssignment must be a boolean");
    }

    this.record = record;
    this.transaction = transaction;
    this.resolvedProperty = resolvedProperty;
    this.needsAssignment = needsAssignment;

    Object.freeze(this);
  }

  toJSON() {
    return {
      record: this.record,
      transaction: this.transaction,
      resolvedProperty: this.resolvedProperty,
      needsAssignment: this.needsAssignment,
    };
  }
}
