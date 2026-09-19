import { describe, expect, test } from "vitest";
import { lineVarianceCents, varianceLabel } from "../budgetVariance.js";

describe("lineVarianceCents", () => {
  test("positive when under plan", () => {
    expect(lineVarianceCents({ plannedAmountCents: 10000, actualAmountCents: 6000 })).toBe(4000);
  });

  test("negative when over plan", () => {
    expect(lineVarianceCents({ plannedAmountCents: 10000, actualAmountCents: 12500 })).toBe(-2500);
  });

  test("zero planned still reports (overspent a zero plan)", () => {
    expect(lineVarianceCents({ plannedAmountCents: 0, actualAmountCents: 500 })).toBe(-500);
  });

  test("null when never planned", () => {
    expect(lineVarianceCents({ plannedAmountCents: null, actualAmountCents: 500 })).toBeNull();
  });

  test("missing actual counts as zero spent", () => {
    expect(lineVarianceCents({ plannedAmountCents: 10000 })).toBe(10000);
  });
});

describe("varianceLabel", () => {
  test("labels left / over / on plan / null", () => {
    expect(varianceLabel(4000)).toBe("left");
    expect(varianceLabel(-2500)).toBe("over");
    expect(varianceLabel(0)).toBe("on plan");
    expect(varianceLabel(null)).toBeNull();
  });
});
