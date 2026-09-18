import { describe, expect, test } from "vitest";
import { parseBudgetScope, isValidBudgetScope } from "../parseBudgetScope";

describe("parseBudgetScope", () => {
  test("defaults to personal when scope is absent", () => {
    expect(parseBudgetScope(new URLSearchParams())).toBe("personal");
  });

  test("accepts personal and business", () => {
    expect(parseBudgetScope(new URLSearchParams("scope=personal"))).toBe("personal");
    expect(parseBudgetScope(new URLSearchParams("scope=business"))).toBe("business");
  });

  test("rejects anything else", () => {
    expect(parseBudgetScope(new URLSearchParams("scope=rental"))).toBeNull();
    expect(parseBudgetScope(new URLSearchParams("scope="))).toBeNull();
  });
});

describe("isValidBudgetScope", () => {
  test("accepts only personal and business", () => {
    expect(isValidBudgetScope("personal")).toBe(true);
    expect(isValidBudgetScope("business")).toBe(true);
    expect(isValidBudgetScope("other")).toBe(false);
    expect(isValidBudgetScope(undefined)).toBe(false);
  });
});
