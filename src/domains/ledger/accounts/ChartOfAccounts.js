import { Account } from "./Account";

/**
 * FORGE #21 LOCKED MODULE
 *
 * ChartOfAccounts is immutable.
 *
 * Single source of truth for hierarchy:
 * - parentMap only
 *
 * Do not add:
 * - childrenMap
 * - stored children arrays
 * - cached descendants
 * - rollup/balance logic
 */
export class ChartOfAccounts {
  constructor(accounts = [], parentMap = new Map()) {
    if (!Array.isArray(accounts)) {
      throw new Error("Accounts must be an array");
    }

    if (!(parentMap instanceof Map)) {
      throw new Error("Parent map must be a Map");
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

    for (const [childId, parentId] of parentMap.entries()) {
      if (!accountIds.has(childId)) {
        throw new Error("Child account not found");
      }

      if (!accountIds.has(parentId)) {
        throw new Error("Parent account not found");
      }

      if (childId === parentId) {
        throw new Error("Account cannot be its own parent");
      }
    }

    this.accounts = Object.freeze([...accounts]);
    this.parentMap = new Map(parentMap);

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
    return new ChartOfAccounts([...this.accounts, account], this.parentMap);
  }

  setParent(childId, parentId) {
    const nextParentMap = new Map(this.parentMap);
    nextParentMap.set(childId, parentId);

    return new ChartOfAccounts(this.accounts, nextParentMap);
  }

  getParent(childId) {
    return this.parentMap.get(childId) ?? null;
  }

  getChildren(parentId) {
    const childIds = [];

    for (const [childId, currentParentId] of this.parentMap.entries()) {
      if (currentParentId === parentId) {
        childIds.push(childId);
      }
    }

    return childIds.map((childId) => this.getById(childId));
  }
}
