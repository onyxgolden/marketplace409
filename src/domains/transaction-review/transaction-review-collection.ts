import { TransactionReviewItem } from "./transaction-review-item";

export type TransactionReviewCollectionInput = Readonly<{
  items: readonly TransactionReviewItem[];
}>;

export class TransactionReviewCollection {
  readonly items: readonly TransactionReviewItem[];

  readonly needsReviewCount: number;
  readonly assignedCount: number;
  readonly reviewedCount: number;
  readonly ignoredCount: number;
  readonly completionPercentage: number;

  constructor({ items }: TransactionReviewCollectionInput) {
    this.items = Object.freeze([...items]);

    let assignedCount = 0;
    let reviewedCount = 0;
    let ignoredCount = 0;

    for (const item of this.items) {
      switch (item.assignmentStatus) {
        case "assigned":
          assignedCount++;
          break;
      }

      switch (item.reviewState) {
        case "reviewed":
          reviewedCount++;
          break;
        case "ignored":
          ignoredCount++;
          break;
      }
    }

    const total = this.items.length;

    const needsReviewCount =
      total - reviewedCount - ignoredCount;

    this.assignedCount = assignedCount;
    this.reviewedCount = reviewedCount;
    this.ignoredCount = ignoredCount;
    this.needsReviewCount = needsReviewCount;

    this.completionPercentage =
      total === 0 ? 0 : reviewedCount / total;

    Object.freeze(this);
  }

  toJSON() {
    return {
      items: this.items,
      needsReviewCount: this.needsReviewCount,
      assignedCount: this.assignedCount,
      reviewedCount: this.reviewedCount,
      ignoredCount: this.ignoredCount,
      completionPercentage: this.completionPercentage,
    };
  }
}
