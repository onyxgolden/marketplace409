import { describe, expect, test } from "vitest";

import { TransactionReviewItem } from "../transaction-review-item";
import { TransactionReviewCollection } from "../transaction-review-collection";

function createItem(overrides: Partial<any> = {}) {
  return new TransactionReviewItem({
    record: { id: "r1" },
    transaction: { id: "t1" },
    resolvedProperty: { name: "p1" },
    needsAssignment: false,
    ...overrides,
  });
}

describe("TransactionReviewCollection", () => {
  test("handles empty collection", () => {
    const collection = new TransactionReviewCollection({
      items: [],
    });

    expect(collection.items).toEqual([]);
    expect(collection.needsReviewCount).toBe(0);
    expect(collection.assignedCount).toBe(0);
    expect(collection.reviewedCount).toBe(0);
    expect(collection.ignoredCount).toBe(0);
    expect(collection.completionPercentage).toBe(0);
  });

  test("counts assigned items correctly", () => {
    const collection = new TransactionReviewCollection({
      items: [
        createItem({ assignmentStatus: "assigned" }),
        createItem({ assignmentStatus: "assigned" }),
        createItem({ assignmentStatus: "unassigned" }),
      ],
    });

    expect(collection.assignedCount).toBe(2);
  });

  test("counts review states correctly", () => {
    const collection = new TransactionReviewCollection({
      items: [
        createItem({ reviewState: "reviewed" }),
        createItem({ reviewState: "reviewed" }),
        createItem({ reviewState: "ignored" }),
      ],
    });

    expect(collection.reviewedCount).toBe(2);
    expect(collection.ignoredCount).toBe(1);
  });

  test("computes needsReviewCount correctly", () => {
    const collection = new TransactionReviewCollection({
      items: [
        createItem({ reviewState: "reviewed" }),
        createItem({ reviewState: "ignored" }),
        createItem({ reviewState: "pending" }),
      ],
    });

    expect(collection.needsReviewCount).toBe(1);
  });

  test("computes completion percentage", () => {
    const collection = new TransactionReviewCollection({
      items: [
        createItem({ reviewState: "reviewed" }),
        createItem({ reviewState: "reviewed" }),
        createItem({ reviewState: "pending" }),
        createItem({ reviewState: "ignored" }),
      ],
    });

    expect(collection.completionPercentage).toBe(0.5);
  });

  test("is immutable", () => {
    const collection = new TransactionReviewCollection({
      items: [createItem()],
    });

    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.items)).toBe(true);
  });
});
