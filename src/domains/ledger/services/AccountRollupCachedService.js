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

  // Period queries bypass the snapshot cache -- they are ad-hoc reporting queries, and keying the
  // cache by arbitrary date ranges would trade correctness risk for little gain.
  getBalanceByAccountInPeriod(accountId, period) {
    return this.baseService.getBalanceByAccountInPeriod(accountId, period);
  }

  invalidateCache() {
    this.cache.invalidate();
  }
}
