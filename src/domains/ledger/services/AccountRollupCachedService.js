import { AccountRollupSnapshotCache } from "../reports/AccountRollupSnapshotCache";
import { AccountRollupService } from "./AccountRollupService";

export class AccountRollupCachedService {
  constructor({ chartOfAccounts, balanceCalculator }) {
    this.baseService = new AccountRollupService({
      chartOfAccounts,
      balanceCalculator,
    });

    this.cache = new AccountRollupSnapshotCache({
      accountRollupService: this.baseService,
    });
  }

  getBalanceByAccount(accountId) {
    return this.cache.getBalanceByAccount(accountId);
  }

  invalidateCache() {
    this.cache.invalidate();
  }
}
