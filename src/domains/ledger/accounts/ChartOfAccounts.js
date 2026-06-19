import { Account } from "./Account";

export class ChartOfAccounts {
  constructor(accounts = []) {
    if (!Array.isArray(accounts)) {
      throw new Error("Accounts must be an array");
    }

    const accountIds = new Set();

    for (const account of accounts) {
      if (!(account instanceof Account)) {
        throw new Error("Chart accounts must be Account instances");
      }

      if (accountIds.has(account.id)) {
        throw new Error("Duplicate account id");
      }

      accountIds.add(account.id);
    }

    this.accounts = Object.freeze([...accounts]);

    Object.freeze(this);
  }

    getById(id) {
    const account = this.accounts.find((account) => account.id === id);

    if (!account) {
      throw new Error("Account not found");
    }

    return account;
  }

  hasAccount(id) {
    return this.accounts.some((account) => account.id === id);
  }

    addAccount(account) {
    return new ChartOfAccounts([...this.accounts, account]);
  }
}