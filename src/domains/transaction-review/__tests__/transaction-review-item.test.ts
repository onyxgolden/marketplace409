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

    expect(Object.isFrozen(item)).toBe(true);
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
    });
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
});
