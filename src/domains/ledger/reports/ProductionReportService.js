import { BalanceCalculator } from "../calculators/BalanceCalculator.js";
import { AccountRollupCachedService } from "../services/AccountRollupCachedService.js";
import { AccountRollupSnapshotBuilder } from "../services/AccountRollupSnapshotBuilder.js";
import { SnapshotReportFactory } from "./SnapshotReportFactory.js";

/**
 * ProductionReportService
 *
 * Application-facing reporting API.
 *
 * Responsibility:
 * Orchestrates the production reporting pipeline from ledger truth
 * to immutable financial reports.
 *
 * Flow:
 * GeneralLedger
 *   → BalanceCalculator
 *   → AccountRollupCachedService
 *   → AccountRollupSnapshotBuilder
 *   → SnapshotReportFactory
 *   → Financial Reports
 *
 * Protected rule:
 * Consumers should not need to know about snapshots, adapters,
 * rollup caches, or report builders.
 */
export class ProductionReportService {
  constructor({
    generalLedger,
    chartOfAccounts,
    reportFactory = new SnapshotReportFactory(),
  }) {
    if (!generalLedger) {
      throw new Error("GeneralLedger is required");
    }

    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    this.generalLedger = generalLedger;
    this.chartOfAccounts = chartOfAccounts;
    this.reportFactory = reportFactory;

    this.balanceCalculator = new BalanceCalculator(generalLedger);

    this.rollupService = new AccountRollupCachedService({
      chartOfAccounts,
      balanceCalculator: this.balanceCalculator,
    });

    this.snapshotBuilder = new AccountRollupSnapshotBuilder({
      chartOfAccounts,
      rollupService: this.rollupService,
    });

    Object.freeze(this);
  }

  buildBalanceSheet() {
    return this.reportFactory.buildBalanceSheet(this._buildSnapshot());
  }

  buildIncomeStatement() {
    return this.reportFactory.buildIncomeStatement(this._buildSnapshot());
  }

  buildTrialBalance() {
    return this.reportFactory.buildTrialBalance(this._buildSnapshot());
  }

  buildReports() {
    const snapshot = this._buildSnapshot();

    return Object.freeze({
      balanceSheet: this.reportFactory.buildBalanceSheet(snapshot),
      incomeStatement: this.reportFactory.buildIncomeStatement(snapshot),
      trialBalance: this.reportFactory.buildTrialBalance(snapshot),
    });
  }

  _buildSnapshot() {
    return this.snapshotBuilder.build();
  }
}

Object.freeze(ProductionReportService);
