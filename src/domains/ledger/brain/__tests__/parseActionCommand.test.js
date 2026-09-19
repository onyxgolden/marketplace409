import { describe, expect, test } from "vitest";
import { parseActionCommand, ACTION_HINT } from "../parseActionCommand.js";

describe("parseActionCommand", () => {
  test("categorize with description selector", () => {
    expect(parseActionCommand("categorize Shell transactions as fuel")).toEqual({
      intent: "categorize",
      category: "fuel",
      selector: { scope: "matched", text: "shell", amount: null },
    });
  });

  test("categorize resolves synonyms to slugs", () => {
    const parsed = parseActionCommand("categorize dining as restaurants");
    expect(parsed.intent).toBe("categorize");
    expect(parsed.category).toBe("dining_drinks");
  });

  test("categorize 'all' scope", () => {
    expect(parseActionCommand("categorize all as groceries")).toEqual({
      intent: "categorize",
      category: "groceries",
      selector: { scope: "all", text: null, amount: null },
    });
  });

  test("categorize with amount filter", () => {
    const parsed = parseActionCommand("categorize uncategorized under $100 as coffee");
    expect(parsed.intent).toBe("categorize");
    expect(parsed.category).toBe("dining_drinks");
    expect(parsed.selector.amount).toEqual({ op: "lt", value: 100 });
  });

  test("categorize requires the 'as <category>' tail", () => {
    const parsed = parseActionCommand("categorize Shell transactions");
    expect(parsed.unparseable).toBe(true);
    expect(parsed.hint).toBe(ACTION_HINT);
  });

  test("label/tag are categorize aliases", () => {
    expect(parseActionCommand("label HEB as groceries").intent).toBe("categorize");
    expect(parseActionCommand("tag venmo as personal").intent).toBe("categorize");
  });

  test("apply suggestions", () => {
    expect(parseActionCommand("apply suggestions for uncategorized")).toEqual({
      intent: "apply_suggestion",
      selector: { scope: "all", text: null, amount: null },
    });
    expect(parseActionCommand("use suggestion for shell").intent).toBe("apply_suggestion");
  });

  test("mark transfer, both word orders", () => {
    expect(parseActionCommand("mark transfer for the fidelity legs")).toEqual({
      intent: "mark_transfer",
      selector: { scope: "matched", text: "fidelity legs", amount: null },
    });
    expect(parseActionCommand("mark the fidelity legs as transfers").intent).toBe("mark_transfer");
  });

  test("dismiss anomaly with severity/type selectors", () => {
    const parsed = parseActionCommand("dismiss the high duplicate alert");
    expect(parsed.intent).toBe("dismiss_anomaly");
    expect(parsed.selector).toEqual({
      scope: "matched",
      text: "high duplicate",
      amount: null,
    });
  });

  test("dismiss bare", () => {
    expect(parseActionCommand("dismiss anomalies")).toEqual({
      intent: "dismiss_anomaly",
      selector: { scope: "all", text: null, amount: null },
    });
  });

  test("unknown phrasing is unparseable, never guessed", () => {
    for (const text of [
      "",
      "   ",
      "what did I spend on dining",
      "delete everything",
      "categorize stuff",
      "please fix my books",
    ]) {
      const parsed = parseActionCommand(text);
      expect(parsed.unparseable).toBe(true);
      expect(parsed.hint).toBe(ACTION_HINT);
    }
  });

  test("case-insensitive", () => {
    const parsed = parseActionCommand("CATEGORIZE Shell AS FUEL");
    expect(parsed.intent).toBe("categorize");
    expect(parsed.category).toBe("fuel");
  });
});
