import { Money } from "../../../platform/value-objects/Money";

export class AccountRollupSnapshotCache {
  constructor({ accountRollupService }) {
    if (!accountRollupService) {
      throw new Error("AccountRollupService is required");
    }

    this.accountRollupService = accountRollupService;
    this.cache = new Map();

    this.chartHash = this._computeChartHash();

    Object.freeze(this);
  }

  getBalanceByAccount(accountId) {
    const key = this._buildKey(accountId);

    if (this.cache.has(key)) {
      return this.cache.get(key);
    }

    const result =
      this.accountRollupService.getBalanceByAccount(accountId);

    this.cache.set(key, result);

    return result;
  }

  invalidate() {
    this.cache.clear();
    this.chartHash = this._computeChartHash();
  }

  _buildKey(accountId) {
    return `${this.chartHash}:${accountId}`;
  }

  _computeChartHash() {
    // Fallback deterministic hash (safe Phase 4 baseline)
    const chart = this.accountRollupService.chartOfAccounts;

    const structure = chart.parentMap || chart.accounts || chart;

    return JSON.stringify(structure);
  }
}
