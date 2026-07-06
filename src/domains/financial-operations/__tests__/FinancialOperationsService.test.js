import { FinancialOperationsService } from "../FinancialOperationsService.js";

describe("FinancialOperationsService", () => {
  test("builds immutable operations from financial intelligence", () => {
    const service = new FinancialOperationsService();

    const collection = service.buildOperations({
      recommendations: [
        "Continue routine monitoring and preserve current controls.",
        "Review pricing, margins, and operating costs.",
      ],
      planningAssistance: {
        priority: "optimize",
        suggestedFocus: "controlled growth",
      },
    });

    expect(collection.count).toBe(2);

    expect(collection.toArray()).toEqual([
      {
        id: "financial-operation-1",
        title: "Continue routine monitoring and preserve current controls.",
        category: "controlled growth",
        priority: "optimize",
        status: "recommended",
        rationale: "Derived from deterministic financial intelligence.",
      },
      {
        id: "financial-operation-2",
        title: "Review pricing, margins, and operating costs.",
        category: "controlled growth",
        priority: "optimize",
        status: "recommended",
        rationale: "Derived from deterministic financial intelligence.",
      },
    ]);

    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.toArray())).toBe(true);
    expect(Object.isFrozen(collection.toArray()[0])).toBe(true);
  });

  test("uses deterministic defaults when planning assistance is missing", () => {
    const service = new FinancialOperationsService();

    const collection = service.buildOperations({
      recommendations: ["Prioritize cash reserves and short-term liquidity."],
    });

    expect(collection.toArray()).toEqual([
      {
        id: "financial-operation-1",
        title: "Prioritize cash reserves and short-term liquidity.",
        category: "financial controls",
        priority: "monitor",
        status: "recommended",
        rationale: "Derived from deterministic financial intelligence.",
      },
    ]);
  });

  test("returns an empty immutable collection when recommendations are missing", () => {
    const service = new FinancialOperationsService();

    const collection = service.buildOperations({});

    expect(collection.count).toBe(0);
    expect(collection.toArray()).toEqual([]);
    expect(Object.isFrozen(collection)).toBe(true);
    expect(Object.isFrozen(collection.toArray())).toBe(true);
  });
});
