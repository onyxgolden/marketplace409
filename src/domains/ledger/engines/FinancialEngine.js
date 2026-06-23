import { ProductionReportService } from "../reports/ProductionReportService.js";

/**
 * FinancialEngine
 *
 * Immutable accounting engine for a ledger context.
 *
 * Responsibility:
 * Owns the application-facing accounting context:
 * - GeneralLedger
 * - ChartOfAccounts
 * - Production reporting API
 *
 * It does not post entries.
 * It does not mutate ledger truth.
 * It does not calculate directly.
 *
 * Protected rule:
 * Application code should depend on FinancialEngine,
 * not low-level calculators, rollup services, snapshots, or report builders.
 */
export class FinancialEngine {
  constructor({ generalLedger, chartOfAccounts }) {
    if (!generalLedger) {
      throw new Error("GeneralLedger is required");
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    this.generalLedger = generalLedger;
    this.chartOfAccounts = chartOfAccounts;

    this.reportService = new ProductionReportService({
      generalLedger,
      chartOfAccounts,
    });

    Object.freeze(this);
  }

  buildBalanceSheet() {
    return this.reportService.buildBalanceSheet();
  }

  buildIncomeStatement() {
    return this.reportService.buildIncomeStatement();
  }

  buildTrialBalance() {
    return this.reportService.buildTrialBalance();
  }

  buildReports() {
    return this.reportService.buildReports();
  }
}

Object.freeze(FinancialEngine);
