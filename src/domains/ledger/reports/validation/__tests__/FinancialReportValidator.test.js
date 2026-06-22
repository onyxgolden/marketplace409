import { describe, expect, test } from "vitest";
import { AccountBalance } from "../../AccountBalance";
import { AccountBalanceCollection } from "../../AccountBalanceCollection";
import { TrialBalance } from "../../TrialBalance";
import { IncomeStatement } from "../../IncomeStatement";
import { FinancialReportValidator } from "../FinancialReportValidator";

describe("FinancialReportValidator", () => {
  test("passes when trial balance is balanced", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 50 }),
      new AccountBalance({ accountId: "revenue", balance: -50 }),
    ]);

    const report = new TrialBalance(balances);

    const result = new FinancialReportValidator().validate(report);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  test("fails when trial balance is not balanced", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "cash", balance: 100 }),
      new AccountBalance({ accountId: "revenue", balance: -40 }),
    ]);

    const report = new TrialBalance(balances);

    const result = new FinancialReportValidator().validate(report);

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  test("rejects unsupported report types", () => {
    const result = new FinancialReportValidator().validate({});

    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("Unsupported report type");
  });

  test("passes income statement when net income matches source balances", () => {
    const balances = new AccountBalanceCollection([
      new AccountBalance({ accountId: "revenue", balance: 200 }),
      new AccountBalance({ accountId: "expense", balance: -50 }),
    ]);

    const report = new IncomeStatement(balances);

    const result = new FinancialReportValidator().validate(report);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
