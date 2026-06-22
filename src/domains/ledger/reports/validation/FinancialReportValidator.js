import { TrialBalance } from "../TrialBalance.js";
import { BalanceSheet } from "../BalanceSheet.js";
import { IncomeStatement } from "../IncomeStatement.js";

/**
 * FinancialReportValidator
 *
 * Integrity engine for financial reports.
 * Does NOT mutate data.
 */

export class FinancialReportValidator {
  validate(report) {
    const errors = [];

    // -------------------------
    // Trial Balance validation
    // -------------------------
    if (report instanceof TrialBalance) {
      const total = report.totalBalance();

      if (total !== 0) {
        errors.push(
          `TrialBalance is not balanced. Net total = ${total}`
        );
      }

      return this.#result(report, errors);
    }

    // -------------------------
    // Balance Sheet validation
    // -------------------------
    if (report instanceof BalanceSheet) {
      const sheetErrors = this.#validateBalanceSheet(report);
      return this.#result(report, sheetErrors);
    }

    // -------------------------
// Income Statement validation
// -------------------------
if (report instanceof IncomeStatement) {
  const lines = report.lines();

  const expectedNet = lines.reduce(
    (sum, line) => sum + line.amount,
    0
  );

  const actualNet =
  typeof report.netIncome === "function"
    ? report.netIncome.call(report)
    : report.netIncome;

  const errors = [];

  if (expectedNet !== actualNet) {
    errors.push(
      `IncomeStatement netIncome mismatch. Expected=${expectedNet}, Actual=${actualNet}`
    );
  }

  return this.#result(report, errors);
}

    // -------------------------
    // Unsupported type
    // -------------------------
    return {
      valid: false,
      errors: ["Unsupported report type for validation"],
      reportName: report?.name || "Unknown",
    };
  }

  // -------------------------
  // Balance Sheet Rule Engine
  // -------------------------
  #validateBalanceSheet(report) {
    const lines = report.lines();

    let assets = 0;
    let liabilities = 0;
    let equity = 0;

    for (const line of lines) {
      const label = (line.label || "").toLowerCase();

      if (label.includes("asset")) {
        assets += line.amount;
      } else if (label.includes("liability")) {
        liabilities += line.amount;
      } else if (label.includes("equity")) {
        equity += line.amount;
      }
    }

    const errors = [];

    if (assets !== liabilities + equity) {
      errors.push(
        `BalanceSheet is not balanced. Assets=${assets}, Liabilities=${liabilities}, Equity=${equity}`
      );
    }

    return errors;
  }

  // -------------------------
  // Shared result format
  // -------------------------
  #result(report, errors) {
    return {
      valid: errors.length === 0,
      errors,
      reportName: report.name,
    };
  }
}
