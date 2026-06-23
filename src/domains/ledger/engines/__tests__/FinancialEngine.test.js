import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { Account } from "../../accounts/Account.js";
import { AccountType } from "../../accounts/AccountType.js";
import { ChartOfAccounts } from "../../accounts/ChartOfAccounts.js";
import { GeneralLedger } from "../../entities/GeneralLedger.js";
import { LedgerDirection } from "../../value-objects/index.js";
import { FinancialEngine } from "../FinancialEngine.js";

function ledgerEntry({ accountId, direction, amount }) {
  return {
    accountId,
    direction,
    amount: new Money(amount),
  };
}

describe("FinancialEngine", () => {
  test("exposes immutable financial reports for a ledger context", () => {
    const chartOfAccounts = new ChartOfAccounts([
      new Account({
        id: "1000",
        name: "Assets",
        type: AccountType.ASSET,
      }),
      new Account({
        id: "1010",
        name: "Cash",
        type: AccountType.ASSET,
        parentId: "1000",
      }),
      new Account({
        id: "4000",
        name: "Revenue",
        type: AccountType.REVENUE,
      }),
      new Account({
        id: "5000",
        name: "Expenses",
        type: AccountType.EXPENSE,
      }),
    ]);

    const generalLedger = GeneralLedger.fromEntries([
      ledgerEntry({
        accountId: "1010",
        direction: LedgerDirection.DEBIT,
        amount: 500,
      }),
      ledgerEntry({
        accountId: "4000",
        direction: LedgerDirection.CREDIT,
        amount: 300,
      }),
      ledgerEntry({
        accountId: "5000",
        direction: LedgerDirection.DEBIT,
        amount: 100,
      }),
    ]);

    const engine = new FinancialEngine({
      generalLedger,
      chartOfAccounts,
    });

    const reports = engine.buildReports();

    expect(Object.isFrozen(engine)).toBe(true);
    expect(reports.balanceSheet).toBeDefined();
    expect(reports.incomeStatement).toBeDefined();
    expect(reports.trialBalance).toBeDefined();

    expect(engine.buildBalanceSheet()).toBeDefined();
    expect(engine.buildIncomeStatement()).toBeDefined();
    expect(engine.buildTrialBalance()).toBeDefined();
  });
});
