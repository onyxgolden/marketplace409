import { describe, expect, test } from "vitest";
import {
  buildActionPlan,
  requiredConfirmationForPlan,
  confirmationSatisfiesGate,
  CONFIDENCE_GATE_THRESHOLD,
} from "../buildActionPlan.js";
import { parseActionCommand } from "../parseActionCommand.js";

const ROWS = [
  {
    eventId: "e1",
    eventDate: "2026-09-10",
    description: "SHELL OIL 57444123",
    amount: 45.2,
    transactionKind: "expense",
    normalizedCategory: "other",
    suggestion: { category: "fuel", confidence: 0.92, reasons: ["matched \"shell\""] },
  },
  {
    eventId: "e2",
    eventDate: "2026-09-11",
    description: "HEB GROCERY #412",
    amount: 120.0,
    transactionKind: "expense",
    normalizedCategory: "other",
    suggestion: { category: "groceries", confidence: 0.4, reasons: [] },
  },
  {
    eventId: "e3",
    eventDate: "2026-09-12",
    description: "Transfer to Share 0009",
    amount: -10000,
    transactionKind: "expense",
    normalizedCategory: "other",
    suggestion: null,
  },
];

const ALERTS = [
  { key: "duplicate:aaaa1111", type: "duplicate", severity: "high", title: "Possible duplicate charge: shell", detail: "d" },
  { key: "spend-spike:bbbb2222", type: "spend-spike", severity: "medium", title: "dining_drinks spend is up", detail: "d" },
];

function planFor(command, overrides = {}) {
  const parsed = parseActionCommand(command);
  return buildActionPlan({
    parsed,
    ambiguousRows: ROWS,
    anomalyAlerts: ALERTS,
    ...overrides,
  });
}

describe("buildActionPlan", () => {
  test("categorize plans one item per matched row, high confidence", () => {
    const plan = planFor("categorize shell as fuel");
    expect(plan.items).toHaveLength(1);
    const [item] = plan.items;
    expect(item.kind).toBe("categorize");
    expect(item.eventId).toBe("e1");
    expect(item.category).toBe("fuel");
    expect(item.confidence).toBeGreaterThanOrEqual(CONFIDENCE_GATE_THRESHOLD);
    expect(item.reversible).toBe(true);
    expect(plan.requiresTypedConfirm).toBe(false);
    expect(requiredConfirmationForPlan(plan)).toBe("single");
  });

  test("categorize 'all' matches every unresolved row", () => {
    const plan = planFor("categorize all as groceries");
    expect(plan.items).toHaveLength(3);
    expect(plan.requiresTypedConfirm).toBe(false);
  });

  test("amount filter narrows the plan", () => {
    const plan = planFor("categorize all under $100 as fuel");
    expect(plan.items.map((item) => item.eventId)).toEqual(["e1"]);
  });

  test("apply_suggestion uses the categorizer's confidence", () => {
    const plan = planFor("apply suggestion for shell");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].category).toBe("fuel");
    expect(plan.items[0].confidence).toBeCloseTo(0.92, 3);
    expect(plan.requiresTypedConfirm).toBe(false);
  });

  test("low-confidence suggestion trips the typed gate", () => {
    const plan = planFor("apply suggestion for heb");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].confidence).toBeLessThan(CONFIDENCE_GATE_THRESHOLD);
    expect(plan.requiresTypedConfirm).toBe(true);
    expect(requiredConfirmationForPlan(plan)).toBe("typed");
  });

  test("rows without a suggestion are skipped by apply_suggestion", () => {
    const plan = planFor("apply suggestions for all");
    expect(plan.items.map((item) => item.eventId).sort()).toEqual(["e1", "e2"]);
  });

  test("mark_transfer discounts confidence", () => {
    const plan = planFor("mark transfer for fidelity");
    expect(plan.items).toHaveLength(0); // "fidelity" matches nothing in the fixture
    const plan2 = planFor("mark transfer for share");
    expect(plan2.items).toHaveLength(1);
    expect(plan2.items[0].kind).toBe("mark_transfer");
    expect(plan2.items[0].confidence).toBeCloseTo(0.95 * 0.9, 3);
    expect(plan2.requiresTypedConfirm).toBe(false);
  });

  test("dismiss_anomaly plans matched alerts", () => {
    const plan = planFor("dismiss the high duplicate alert");
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0].kind).toBe("dismiss_anomaly");
    expect(plan.items[0].alertKey).toBe("duplicate:aaaa1111");
    expect(plan.requiresTypedConfirm).toBe(false);
  });

  test("empty match yields an empty plan with an honest summary", () => {
    const plan = planFor("categorize nothing-here-xyz as fuel");
    expect(plan.items).toHaveLength(0);
    expect(plan.summary).toMatch(/nothing matches/i);
    expect(requiredConfirmationForPlan(plan)).toBe("none");
  });

  test("plan is frozen and JSON-serializable", () => {
    const plan = planFor("categorize all as groceries");
    expect(Object.isFrozen(plan)).toBe(true);
    expect(() => JSON.parse(JSON.stringify(plan))).not.toThrow();
    const roundTripped = JSON.parse(JSON.stringify(plan));
    expect(roundTripped.items).toHaveLength(3);
  });

  test("unparseable command yields an empty plan", () => {
    const plan = buildActionPlan({
      parsed: parseActionCommand("delete everything"),
      ambiguousRows: ROWS,
      anomalyAlerts: ALERTS,
    });
    expect(plan.items).toHaveLength(0);
  });
});

describe("confirmationSatisfiesGate", () => {
  test("typed gate needs exactly CONFIRM, case-insensitive", () => {
    const plan = planFor("apply suggestion for heb");
    expect(requiredConfirmationForPlan(plan)).toBe("typed");
    expect(confirmationSatisfiesGate(plan, "CONFIRM")).toBe(true);
    expect(confirmationSatisfiesGate(plan, "confirm")).toBe(true);
    expect(confirmationSatisfiesGate(plan, "  confirm  ")).toBe(true);
    expect(confirmationSatisfiesGate(plan, "SINGLE")).toBe(false);
    expect(confirmationSatisfiesGate(plan, "yes")).toBe(false);
    expect(confirmationSatisfiesGate(plan, null)).toBe(false);
  });

  test("single gate needs the SINGLE acknowledgement", () => {
    const plan = planFor("categorize shell as fuel");
    expect(requiredConfirmationForPlan(plan)).toBe("single");
    expect(confirmationSatisfiesGate(plan, "SINGLE")).toBe(true);
    expect(confirmationSatisfiesGate(plan, "CONFIRM")).toBe(false);
  });

  test("empty plan never satisfies", () => {
    const plan = planFor("categorize nothing-here-xyz as fuel");
    expect(confirmationSatisfiesGate(plan, "CONFIRM")).toBe(false);
    expect(confirmationSatisfiesGate(plan, "SINGLE")).toBe(false);
  });
});
