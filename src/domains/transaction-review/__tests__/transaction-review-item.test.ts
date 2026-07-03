import { describe, expect, test } from "vitest";

import { TransactionReviewItem } from "../transaction-review-item";

describe("TransactionReviewItem", () => {
  test("creates an immutable review item", () => {
    const item = new TransactionReviewItem({
      record: { id: "record-1" },
      transaction: { id: "transaction-1" },
      resolvedProperty: { name: "Unknown Property" },
      needsAssignment: true,
    });

    expect(item.record).toEqual({ id: "record-1" });
    expect(item.transaction).toEqual({ id: "transaction-1" });
    expect(item.resolvedProperty).toEqual({
      name: "Unknown Property",
    });
    expect(item.needsAssignment).toBe(true);
    expect(item.confidence).toBe(0);
    expect(item.suggestedProperties).toEqual([]);
    expect(item.assignmentStatus).toBe("unassigned");
    expect(item.reviewState).toBe("pending");

    expect(Object.isFrozen(item)).toBe(true);
    expect(Object.isFrozen(item.suggestedProperties)).toBe(true);
  });

  test("serializes to JSON", () => {
    const item = new TransactionReviewItem({
      record: { id: "record-1" },
      transaction: { id: "transaction-1" },
      resolvedProperty: { name: "Property A" },
      needsAssignment: false,
    });

    expect(item.toJSON()).toEqual({
      record: { id: "record-1" },
      transaction: { id: "transaction-1" },
      resolvedProperty: { name: "Property A" },
      needsAssignment: false,
      confidence: 0,
      suggestedProperties: [],
      assignmentStatus: "assigned",
      reviewState: "pending",
    });
  });

  test("supports explicit canonical review fields", () => {
    const item = new TransactionReviewItem({
      record: { id: "record-1" },
      transaction: { id: "transaction-1" },
      resolvedProperty: { name: "Property A" },
      needsAssignment: false,
      confidence: 0.85,
      suggestedProperties: [{ name: "Property A" }],
      assignmentStatus: "suggested",
      reviewState: "reviewed",
    });

    expect(item.confidence).toBe(0.85);
    expect(item.suggestedProperties).toEqual([{ name: "Property A" }]);
    expect(item.assignmentStatus).toBe("suggested");
    expect(item.reviewState).toBe("reviewed");
  });

  test("requires needsAssignment to be a boolean", () => {
    expect(() => {
      new TransactionReviewItem({
        record: {},
        transaction: {},
        resolvedProperty: {},
        needsAssignment: "yes" as never,
      });
    }).toThrow(
      "TransactionReviewItem needsAssignment must be a boolean",
    );
  });

  test("requires confidence to be a number", () => {
    expect(() => {
      new TransactionReviewItem({
        record: {},
        transaction: {},
        resolvedProperty: {},
        needsAssignment: true,
        confidence: "high" as never,
      });
    }).toThrow("TransactionReviewItem confidence must be a number");
  });

  test("requires suggestedProperties to be an array", () => {
    expect(() => {
      new TransactionReviewItem({
        record: {},
        transaction: {},
        resolvedProperty: {},
        needsAssignment: true,
        suggestedProperties: "Property A" as never,
      });
    }).toThrow(
      "TransactionReviewItem suggestedProperties must be an array",
    );
  });

  test("requires assignmentStatus to be valid", () => {
    expect(() => {
      new TransactionReviewItem({
        record: {},
        transaction: {},
        resolvedProperty: {},
        needsAssignment: true,
        assignmentStatus: "complete" as never,
      });
    }).toThrow("TransactionReviewItem assignmentStatus must be valid");
  });

  test("requires reviewState to be valid", () => {
    expect(() => {
      new TransactionReviewItem({
        record: {},
        transaction: {},
        resolvedProperty: {},
        needsAssignment: true,
        reviewState: "open" as never,
      });
    }).toThrow("TransactionReviewItem reviewState must be valid");
  });
});
