import { describe, expect, it } from "vitest";
import { Decision } from "../decision";
import { DecisionCollection } from "../decision-collection";

describe("DecisionCollection", () => {
  it("aggregates decision lifecycle counts", () => {
    const collection = new DecisionCollection({
      items: [
        new Decision({
          id: "open",
          context: {},
          recommendation: "Review",
          confidence: 0.5,
          priority: "medium",
        }),
        new Decision({
          id: "accepted",
          context: {},
          recommendation: "Approve",
          confidence: 0.8,
          priority: "high",
          status: "accepted",
        }),
        new Decision({
          id: "completed",
          context: {},
          recommendation: "Execute",
          confidence: 0.9,
          priority: "urgent",
          status: "completed",
        }),
      ],
    });

    expect(collection.openCount).toBe(1);
    expect(collection.acceptedCount).toBe(1);
    expect(collection.completedCount).toBe(1);
    expect(collection.rejectedCount).toBe(0);
    expect(collection.completionPercentage).toBe(1 / 3);
  });

  it("creates an immutable collection", () => {
    const collection = new DecisionCollection({
      items: [],
    });

    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.items)).toBe(true);
  });

  it("serializes collection state", () => {
    const collection = new DecisionCollection({
      items: [],
    });

    expect(collection.toJSON()).toEqual({
      items: [],
      openCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      completedCount: 0,
      completionPercentage: 0,
    });
  });

  it("rejects non-decision items", () => {
    expect(
      () =>
        new DecisionCollection({
          items: [{}] as never,
        }),
    ).toThrow();
  });
});
