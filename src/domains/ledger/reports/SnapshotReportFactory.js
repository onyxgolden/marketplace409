import { SnapshotToAccountBalanceCollectionAdapter } from "./SnapshotToAccountBalanceCollectionAdapter.js";
import { BalanceSheetBuilder } from "./builders/BalanceSheetBuilder.js";
import { IncomeStatementBuilder } from "./builders/IncomeStatementBuilder.js";
import { TrialBalanceBuilder } from "./builders/TrialBalanceBuilder.js";

/**
 * SnapshotReportFactory
 *
 * Phase 5 production report entry point.
 *
 * Responsibility:
 * Converts RollupSnapshot read models into existing immutable financial reports.
 *
 * Flow:
 * RollupSnapshot
 *   → SnapshotToAccountBalanceCollectionAdapter
 *   → AccountBalanceCollection
 *   → Existing Report Builders
 *   → Financial Reports
 *
 * Protected rule:
 * This factory does not mutate ledger truth.
 * It does not calculate accounting.
 * It only adapts snapshot read models into report construction.
 */
export class SnapshotReportFactory {
  constructor({
    balanceSheetBuilder = new BalanceSheetBuilder(),
    incomeStatementBuilder = new IncomeStatementBuilder(),
    trialBalanceBuilder = new TrialBalanceBuilder(),
  } = {}) {
    this.balanceSheetBuilder = balanceSheetBuilder;
    this.incomeStatementBuilder = incomeStatementBuilder;
    this.trialBalanceBuilder = trialBalanceBuilder;

    Object.freeze(this);
  }

  buildBalanceSheet(snapshot) {
    return this.balanceSheetBuilder.build(
      this._toAccountBalanceCollection(snapshot)
    );
  }

  buildIncomeStatement(snapshot) {
    return this.incomeStatementBuilder.build(
      this._toAccountBalanceCollection(snapshot)
    );
  }

  buildTrialBalance(snapshot) {
    return this.trialBalanceBuilder.build(
      this._toAccountBalanceCollection(snapshot)
    );
  }

  _toAccountBalanceCollection(snapshot) {
    const adapter = new SnapshotToAccountBalanceCollectionAdapter({
      snapshot,
    });

    return adapter.toAccountBalanceCollection();
  }
}