import { Money } from "@/platform";

export class AccountRollupSnapshotBuilder {
  constructor({ chartOfAccounts, rollupService }) {
    if (!chartOfAccounts) {
      throw new Error("ChartOfAccounts is required");
    }

    if (!rollupService) {
      throw new Error("AccountRollupService is required");
    }

    this.chartOfAccounts = chartOfAccounts;
    this.rollupService = rollupService;

    Object.freeze(this);
  }

  build() {
    const result = new Map();

    for (const account of this.chartOfAccounts.accounts) {
      const balance = this.rollupService.getBalanceByAccount(account.id);
      result.set(account.id, balance);
    }

    return new RollupSnapshot(result);
  }
}

class RollupSnapshot {
  constructor(map) {
    this._map = new Map(map);
    Object.freeze(this);
  }

  get(accountId) {
    return this._map.get(accountId) || new Money(0);
  }

  entries() {
    return Array.from(this._map.entries());
  }

  toObject() {
    const obj = {};
    for (const [k, v] of this._map.entries()) {
      obj[k] = v;
    }
    return obj;
  }
}
