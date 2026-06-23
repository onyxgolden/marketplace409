import { AccountBalanceCollection } from "./AccountBalanceCollection.js";
import { AccountBalance } from "./AccountBalance.js";

/**
 * SnapshotToAccountBalanceCollectionAdapter
 *
 * Bridges Phase 4 Snapshot layer → Phase 3 Reporting layer.
 *
 * Responsibility:
 * Converts RollupSnapshot into AccountBalanceCollection
 * without modifying ledger truth or snapshot behavior.
 *
 * This is the ONLY approved bridge between:
 * RollupSnapshot → Reporting System
 */
export class SnapshotToAccountBalanceCollectionAdapter {
  constructor({ snapshot }) {
    if (!snapshot) {
      throw new Error("Snapshot is required");
    }

    this.snapshot = snapshot;

    Object.freeze(this);
  }

  toAccountBalanceCollection() {
    const balances = [];

    for (const [accountId, value] of this.snapshot.entries()) {
      balances.push(
        new AccountBalance({
          accountId,
          debitTotal: 0,
          creditTotal: 0,
          balance: this._normalize(value),
        })
      );
    }

    return new AccountBalanceCollection(balances);
  }

  _normalize(value) {
    // Handles Money objects, numbers, or fallback-safe values
    if (!value) return 0;

    if (typeof value === "number") return value;

    if (typeof value === "object") {
      if (typeof value.amount === "number") return value.amount;
      if (typeof value.value === "number") return value.value;
      if (typeof value.toNumber === "function") return value.toNumber();
    }

    return 0;
  }
}
