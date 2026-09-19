import { describe, expect, test } from "vitest";
import { Money } from "@/platform";
import { Account } from "../../accounts/Account.js";
import { AccountType } from "../../accounts/AccountType.js";
import { ChartOfAccounts } from "../../accounts/ChartOfAccounts.js";
import { GeneralLedger } from "../../entities/GeneralLedger.js";
import { JournalEntry } from "../../entities/JournalEntry.js";
import { Posting } from "../../entities/Posting.js";
import { LedgerDirection } from "../../value-objects/index.js";
import { PostingEngine } from "../../services/PostingEngine.js";
import { FinancialEngine } from "../../engines/FinancialEngine.js";
import { expandMonths } from "../comparativePeriods.js";
import { buildComparativeIncomeStatements } from "../buildComparativeIncomeStatements.js";

function chartOfAccounts() {
  return new ChartOfAccounts([
    new Account({ id: "1010", name: "Cash", type: AccountType.ASSET }),
    new Account({ id: "4000", name: "Rent revenue", type: AccountType.REVENUE }),
    new Account({ id: "4010", name: "Fee revenue", type: AccountType.REVENUE }),
    new Account({ id: "5000", name: "Repairs", type: AccountType.EXPENSE }),
    new Account({ id: "5010", name: "Unused expense", type: AccountType.EXPENSE }),
  ]);
}

// One month of books: collect rent (+ optional fees) into cash, pay repairs out of cash.
// Balanced per journal entry.
function postMonth(id, date, rent, fees, repairs) {
  const engine = new PostingEngine();
  const postings = [
    new Posting({
      id: `${id}-p1`,
      accountId: "1010",
      amount: new Money(rent + fees),
      direction: LedgerDirection.DEBIT,
    }),
    new Posting({
      id: `${id}-p2`,
      accountId: "4000",
      amount: new Money(rent),
      direction: LedgerDirection.CREDIT,
    }),
    new Posting({
      id: `${id}-p3`,
      accountId: "5000",
      amount: new Money(repairs),
      direction: LedgerDirection.DEBIT,
    }),
    new Posting({
      id: `${id}-p4`,
      accountId: "1010",
      amount: new Money(repairs),
      direction: LedgerDirection.CREDIT,
    }),
  ];

  if (fees > 0) {
    postings.push(
      new Posting({
        id: `${id}-p5`,
        accountId: "4010",
        amount: new Money(fees),
        direction: LedgerDirection.CREDIT,
      }),
    );
  }

  return engine.post(
    new JournalEntry({ id, date, description: `Books for ${date}`, postings }),
  );
}

function buildEngine() {
  const ledger = GeneralLedger.create()
    .record(postMonth("je-jun", "2026-06-15", 1000, 200, 400))
    .record(postMonth("je-jul", "2026-07-15", 1200, 0, 100));

  return new FinancialEngine({ generalLedger: ledger, chartOfAccounts: chartOfAccounts() });
}

describe("buildComparativeIncomeStatements", () => {
  const periods = expandMonths(["2026-06", "2026-07"]);
  const result = buildComparativeIncomeStatements({ engine: buildEngine(), periods });

  test("returns one JSON-serializable entry per period", () => {
    expect(result).toHaveLength(2);
    expect(result[0].period).toMatchObject({ key: "2026-06", label: "Jun 2026" });
    expect(result[1].period).toMatchObject({ key: "2026-07", label: "Jul 2026" });
    expect(() => JSON.stringify(result)).not.toThrow();
  });

  test("reports per-month lines in human sign", () => {
    const june = Object.fromEntries(result[0].lines.map((l) => [l.accountId, l]));
    expect(june["4000"]).toMatchObject({ name: "Rent revenue", type: "revenue", amount: 1000 });
    expect(june["4010"]).toMatchObject({ name: "Fee revenue", type: "revenue", amount: 200 });
    expect(june["5000"]).toMatchObject({ name: "Repairs", type: "expense", amount: 400 });

    const july = Object.fromEntries(result[1].lines.map((l) => [l.accountId, l]));
    expect(july["4000"].amount).toBe(1200);
    // Fee revenue had no July activity but keeps its row so columns stay aligned.
    expect(july["4010"].amount).toBe(0);
    expect(july["5000"].amount).toBe(100);
  });

  test("computes revenue, expense, and net totals per period", () => {
    expect(result[0].totals).toEqual({ revenue: 1200, expenses: 400, netIncome: 800 });
    expect(result[1].totals).toEqual({ revenue: 1200, expenses: 100, netIncome: 1100 });
  });

  test("drops accounts with zero activity in every period", () => {
    const accountIds = result[0].lines.map((l) => l.accountId);
    expect(accountIds).not.toContain("5010"); // Unused expense
    expect(accountIds).not.toContain("1010"); // Cash is not P&L
  });

  test("validates its inputs", () => {
    expect(() => buildComparativeIncomeStatements({ engine: null, periods })).toThrow(/engine/);
    expect(() => buildComparativeIncomeStatements({ engine: buildEngine(), periods: [] })).toThrow(
      /non-empty periods/,
    );
  });
});
