import { describe, expect, test } from "vitest";
import { Money } from "../Money";

describe("Money", () => {
  test("creates a money value object", () => {
    const money = new Money(100);

    expect(money.amount).toBe(100);
  });

  test("is immutable", () => {
    const money = new Money(50);

    expect(Object.isFrozen(money)).toBe(true);
  });
});
