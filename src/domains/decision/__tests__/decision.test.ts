import { describe, expect, it } from "vitest";
import { Decision } from "../decision";

describe("Decision", () => {
  it("creates an immutable decision", () => {
    const decision = new Decision({
      id: "decision-1",
      context: {
        property: "123 Main",
      },
      recommendation: "Review expenses",
      confidence: 0.85,
      priority: "high",
    });

    expect(decision.id).toBe("decision-1");
    expect(decision.status).toBe("open");
    expect(Object.isFrozen(decision)).toBe(true);
  });

  it("serializes decision state", () => {
    const decision = new Decision({
      id: "decision-2",
      context: {},
      recommendation: "Increase reserves",
      confidence: 0.9,
      priority: "urgent",
    });

    expect(decision.toJSON()).toEqual({
      id: "decision-2",
      context: {},
      recommendation: "Increase reserves",
      confidence: 0.9,
      priority: "urgent",
      status: "open",
      selectedAction: null,
      outcome: null,
    });
  });

  it("rejects invalid confidence", () => {
    expect(
      () =>
        new Decision({
          id: "decision-3",
          context: {},
          recommendation: "Test",
          confidence: Number.NaN,
          priority: "low",
        }),
    ).toThrow();
  });

  it("rejects invalid priority", () => {
    expect(
      () =>
        new Decision({
          id: "decision-4",
          context: {},
          recommendation: "Test",
          confidence: 0.5,
          priority: "invalid" as never,
        }),
    ).toThrow();
  });

  it("rejects invalid status", () => {
    expect(
      () =>
        new Decision({
          id: "decision-5",
          context: {},
          recommendation: "Test",
          confidence: 0.5,
          priority: "low",
          status: "invalid" as never,
        }),
    ).toThrow();
  });
});
