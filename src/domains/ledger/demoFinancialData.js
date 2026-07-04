import { Money } from "../../platform";
import { Account } from "./accounts/Account.js";
import { AccountType } from "./accounts/AccountType.js";
import { ChartOfAccounts } from "./accounts/ChartOfAccounts.js";
import { GeneralLedger } from "./entities/GeneralLedger.js";
import { LedgerDirection } from "./value-objects/LedgerDirection.js";

function dollarsToCents(value) {
  return Math.round(Number(value || 0) * 100);
}

function ledgerEntry({ accountId, direction, dollars }) {
  return {
    accountId,
    direction,
    amount: new Money(dollarsToCents(dollars)),
  };
}

export function createDemoFinancialData() {
  const chartOfAccounts = new ChartOfAccounts([
    new Account({ id: "1000", name: "Cash", type: AccountType.ASSET }),
    new Account({ id: "1100", name: "Accounts Receivable", type: AccountType.ASSET }),
    new Account({ id: "2000", name: "Debt Owed", type: AccountType.LIABILITY }),
    new Account({ id: "4000", name: "Monthly Revenue", type: AccountType.REVENUE }),
    new Account({ id: "5000", name: "Monthly Expenses", type: AccountType.EXPENSE }),
  ]);

  const generalLedger = GeneralLedger.fromEntries([
    ledgerEntry({ accountId: "1000", direction: LedgerDirection.DEBIT, dollars: 10000 }),
    ledgerEntry({ accountId: "1100", direction: LedgerDirection.DEBIT, dollars: 2500 }),
    ledgerEntry({ accountId: "2000", direction: LedgerDirection.CREDIT, dollars: 4000 }),
    ledgerEntry({ accountId: "4000", direction: LedgerDirection.CREDIT, dollars: 12000 }),
    ledgerEntry({ accountId: "5000", direction: LedgerDirection.DEBIT, dollars: 8500 }),
  ]);

  return { generalLedger, chartOfAccounts };
}
