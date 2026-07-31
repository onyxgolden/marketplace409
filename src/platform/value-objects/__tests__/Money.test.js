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

  test("toJSON preserves currency so round-tripping through JSON does not silently default to USD", () => {
    const money = new Money(2500, "CAD");

    const serialized = JSON.parse(JSON.stringify(money));

    expect(serialized.amount).toBe(2500);
    expect(serialized.currency).toBe("CAD");
  });
});
