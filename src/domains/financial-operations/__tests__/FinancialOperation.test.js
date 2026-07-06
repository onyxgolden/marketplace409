import { FinancialOperation } from "../FinancialOperation.js";

describe("FinancialOperation", () => {
  test("creates an immutable financial operation", () => {
    const operation = new FinancialOperation({
      id: "financial-operation-1",
      title: "Review operating costs.",
      category: "controlled growth",
      priority: "optimize",
      status: "recommended",
      rationale: "Derived from deterministic financial intelligence.",
    });

    expect(operation).toEqual({
      id: "financial-operation-1",
      title: "Review operating costs.",
      category: "controlled growth",
      priority: "optimize",
      status: "recommended",
      rationale: "Derived from deterministic financial intelligence.",
    });

    expect(Object.isFrozen(operation)).toBe(true);
  });

  test("requires an id", () => {
    expect(
      () =>
        new FinancialOperation({
          title: "Review operating costs.",
          category: "controlled growth",
          rationale: "Derived from deterministic financial intelligence.",
        }),
    ).toThrow("FinancialOperation requires an id.");
  });

  test("requires a title", () => {
    expect(
      () =>
        new FinancialOperation({
          id: "financial-operation-1",
          category: "controlled growth",
          rationale: "Derived from deterministic financial intelligence.",
        }),
    ).toThrow("FinancialOperation requires a title.");
  });

  test("requires a category", () => {
    expect(
      () =>
        new FinancialOperation({
          id: "financial-operation-1",
          title: "Review operating costs.",
          rationale: "Derived from deterministic financial intelligence.",
        }),
    ).toThrow("FinancialOperation requires a category.");
  });

  test("requires a rationale", () => {
    expect(
      () =>
        new FinancialOperation({
          id: "financial-operation-1",
          title: "Review operating costs.",
          category: "controlled growth",
        }),
    ).toThrow("FinancialOperation requires a rationale.");
  });
});
