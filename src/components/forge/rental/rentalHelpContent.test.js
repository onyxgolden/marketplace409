import { describe, expect, it } from "vitest";
import {
  RENTAL_COMMON_WORKFLOWS,
  RENTAL_DAILY_WORKFLOW,
  RENTAL_FUNCTION_HELP,
  RENTAL_HELP_GROUPS,
  getRentalFunctionHelp,
} from "./rentalHelpContent";

const EXPECTED_FUNCTION_IDS = [
  "overview", "setup", "tenants", "leases", "rentec-migration", "rentec-files",
  "charges", "reconciliation", "rentec-payment-import", "rentec-financial-history-import",
  "financial-setup", "deposits", "reports", "maintenance", "inspections", "insurance",
  "documents", "communications", "lease-lifecycle", "lease-preparation", "autopay",
  "animals", "support",
];

describe("rentalHelpContent", () => {
  it("covers every Rental Manager destination exactly once", () => {
    const groupedIds = RENTAL_HELP_GROUPS.flatMap((group) => group.ids);
    expect(groupedIds).toEqual(EXPECTED_FUNCTION_IDS);
    expect(new Set(groupedIds).size).toBe(groupedIds.length);
    expect(Object.keys(RENTAL_FUNCTION_HELP)).toEqual(EXPECTED_FUNCTION_IDS);
  });

  it("gives every destination a title, summary, and actionable guidance", () => {
    for (const help of Object.values(RENTAL_FUNCTION_HELP)) {
      expect(help.title.length).toBeGreaterThan(0);
      expect(help.summary.length).toBeGreaterThan(0);
      expect(help.actions.length).toBeGreaterThan(0);
      expect(help.actions.every((action) => action.length > 0)).toBe(true);
    }
  });

  it("provides a daily routine and non-duplicated common workflows", () => {
    expect(RENTAL_DAILY_WORKFLOW.length).toBeGreaterThanOrEqual(5);
    expect(RENTAL_COMMON_WORKFLOWS.length).toBeGreaterThanOrEqual(6);
    const ids = RENTAL_COMMON_WORKFLOWS.map((workflow) => workflow.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(RENTAL_COMMON_WORKFLOWS.every((workflow) => workflow.steps.length > 1)).toBe(true);
  });

  it("falls back safely to overview help for an unknown destination", () => {
    expect(getRentalFunctionHelp("not-a-real-function")).toBe(RENTAL_FUNCTION_HELP.overview);
  });

  it("preserves important financial and authorization boundaries in plain language", () => {
    const allText = JSON.stringify({ RENTAL_FUNCTION_HELP, RENTAL_COMMON_WORKFLOWS });
    expect(allText).toContain("Deposits are never rent or NOI");
    expect(allText).toContain("Authorization alone never activates a debit");
    expect(allText).toContain("assistance animal");
    expect(allText).toContain("Never approve an ambiguous transaction by guessing");
  });
});
