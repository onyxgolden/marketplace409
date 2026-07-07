import {
  FinancialOperation,
  FinancialOperationCollection,
  FinancialOperationPlan,
} from "../index.js";

describe("FinancialOperationPlan", () => {
  test("creates an immutable financial operation plan", () => {
    const operation = new FinancialOperation({
      id: "financial-operation-1",
      title: "Review operating costs.",
      category: "controlled growth",
      priority: "optimize",
      status: "recommended",
      rationale: "Derived from deterministic financial intelligence.",
    });

    const actions = new FinancialOperationCollection([operation]);

    const plan = new FinancialOperationPlan({
      priority: "optimize",
      focus: "controlled growth",
      summary: "Optimize operating performance.",
      actions,
      source: {
        derivedFrom: "financial-intelligence",
      },
    });

    expect(plan.type).toBe("financial-operations");
    expect(plan.priority).toBe("optimize");
    expect(plan.focus).toBe("controlled growth");
    expect(plan.summary).toBe("Optimize operating performance.");
    expect(plan.actions).toBe(actions);
    expect(plan.source).toEqual({
      derivedFrom: "financial-intelligence",
    });

    expect(Object.isFrozen(plan)).toBe(true);
    expect(Object.isFrozen(plan.source)).toBe(true);
  });

  test("preserves the public response contract with deterministic summary context", () => {
    const operation = new FinancialOperation({
      id: "financial-operation-1",
      title: "Review operating costs.",
      category: "controlled growth",
      priority: "optimize",
      status: "recommended",
      rationale: "Derived from deterministic financial intelligence.",
    });

    const plan = new FinancialOperationPlan({
      priority: "optimize",
      focus: "controlled growth",
      summary: "Optimize operating performance.",
      actions: new FinancialOperationCollection([operation]),
      source: {
        derivedFrom: "financial-intelligence",
      },
    });

    expect(plan.toResponse()).toEqual({
      type: "financial-operations",
      priority: "optimize",
      focus: "controlled growth",
      summary: "Optimize operating performance.",
      actions: [operation],
      source: {
        derivedFrom: "financial-intelligence",
      },
    });

    expect(Object.isFrozen(plan.toResponse())).toBe(true);
  });

  test("uses deterministic defaults", () => {
    const plan = new FinancialOperationPlan();

    expect(plan.toResponse()).toEqual({
      type: "financial-operations",
      priority: "monitor",
      focus: "financial controls",
      summary: "Maintain current financial controls.",
      actions: [],
      source: {},
    });

    expect(Object.isFrozen(plan)).toBe(true);
  });
});
