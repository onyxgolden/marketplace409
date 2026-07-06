import {
  FinancialOperation,
  FinancialOperationCollection,
} from "../index.js";

describe("FinancialOperationCollection", () => {
  test("creates an immutable collection of financial operations", () => {
    const operation = new FinancialOperation({
      id: "financial-operation-1",
      title: "Review operating costs.",
      category: "controlled growth",
      priority: "optimize",
      status: "recommended",
      rationale: "Derived from deterministic financial intelligence.",
    });

    const collection = new FinancialOperationCollection([operation]);

    expect(collection.count).toBe(1);
    expect(collection.toArray()).toEqual([operation]);
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.toArray())).toBe(true);
  });

  test("creates an empty immutable collection", () => {
    const collection = FinancialOperationCollection.empty();

    expect(collection.count).toBe(0);
    expect(collection.toArray()).toEqual([]);
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.toArray())).toBe(true);
  });
});
