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
import { parseLedgerQuery } from "../parseLedgerQuery.js";
import { answerLedgerQuery } from "../answerLedgerQuery.js";
import { formatLedgerAnswer } from "../formatLedgerAnswer.js";

// Fixed "now": Saturday, September 19, 2026 (America/Chicago).
const NOW = new Date("2026-09-19T12:00:00-05:00");

function chartOfAccounts() {
  return new ChartOfAccounts([
    new Account({ id: "1000", name: "Cash", type: AccountType.ASSET }),
    new Account({ id: "4100", name: "Rent revenue", type: AccountType.REVENUE }),
    new Account({ id: "5100", name: "Dining & drinks", type: AccountType.EXPENSE }),
    new Account({ id: "5200", name: "Groceries", type: AccountType.EXPENSE }),
  ]);
}

function post(id, date, accountId, amount, direction, offsetAccountId) {
  const engine = new PostingEngine();
  return engine.post(
    new JournalEntry({
      id,
      date,
      description: `entry ${id}`,
      postings: [
        new Posting({
          id: `${id}-p1`,
          accountId,
          amount: new Money(amount),
          direction,
        }),
        new Posting({
          id: `${id}-p2`,
          accountId: offsetAccountId,
          amount: new Money(amount),
          direction:
            direction === LedgerDirection.DEBIT
              ? LedgerDirection.CREDIT
              : LedgerDirection.DEBIT,
        }),
      ],
    }),
  );
}

function engine() {
  const ledger = GeneralLedger.create()
    // January: $200 dining, $300 groceries, $2,000 rent revenue.
    .record(post("je-jan-1", "2026-01-15", "5100", 200, LedgerDirection.DEBIT, "1000"))
    .record(post("je-jan-2", "2026-01-15", "5200", 300, LedgerDirection.DEBIT, "1000"))
    .record(post("je-jan-3", "2026-01-15", "4100", 2000, LedgerDirection.CREDIT, "1000"))
    // February: $100 dining.
    .record(post("je-feb-1", "2026-02-15", "5100", 100, LedgerDirection.DEBIT, "1000"));

  return new FinancialEngine({ generalLedger: ledger, chartOfAccounts: chartOfAccounts() });
}

function ask(question) {
  const parsed = parseLedgerQuery(question, { now: NOW });
  expect(parsed.unparseable).not.toBe(true);
  return answerLedgerQuery({ engine: engine(), parsed, question });
}

describe("answerLedgerQuery", () => {
  test("answers a family spend question for one period", () => {
    const answer = ask("what did I spend on dining in january 2026");

    expect(answer.metric).toBe("spend");
    expect(answer.categoryFamily).toBe("dining_drinks");
    expect(answer.amount).toBe(200);
    expect(answer.lines).toEqual([
      { accountId: "5100", name: "Dining & drinks", type: "expense", amount: 200 },
    ]);
  });

  test("synonyms resolve to the same family as the account name", () => {
    const answer = ask("food in january");
    expect(answer.categoryFamily).toBe("dining_drinks");
    expect(answer.amount).toBe(200);
  });

  test("revenue comes back human-signed (positive)", () => {
    const answer = ask("revenue from rent in january 2026");
    expect(answer.metric).toBe("revenue");
    expect(answer.amount).toBe(2000);
    expect(answer.lines).toEqual([
      { accountId: "4100", name: "Rent revenue", type: "revenue", amount: 2000 },
    ]);
  });

  test("net = revenue - expenses", () => {
    const answer = ask("net in january 2026");
    expect(answer.metric).toBe("net");
    expect(answer.categoryFamily).toBe(null);
    expect(answer.amount).toBe(1500);
  });

  test("periods filter independently", () => {
    expect(ask("spend on dining in february 2026").amount).toBe(100);
    expect(ask("spend on dining in january 2026").amount).toBe(200);
  });

  test("no category means every revenue/expense account", () => {
    const answer = ask("everything I spent in january 2026");
    expect(answer.amount).toBe(500);
    expect(answer.lines.map((line) => line.accountId).sort()).toEqual(["5100", "5200"]);
  });

  test("a family with no activity answers zero with no lines", () => {
    const answer = ask("what did I spend on travel in january 2026");
    expect(answer.amount).toBe(0);
    expect(answer.lines).toEqual([]);
  });

  test("rejects unparseable input instead of guessing", () => {
    expect(() =>
      answerLedgerQuery({
        engine: engine(),
        parsed: parseLedgerQuery("hello", { now: NOW }),
        question: "hello",
      }),
    ).toThrow("not unparseable");
  });
});

describe("formatLedgerAnswer", () => {
  const dollars = (value) => `$${Number(value).toFixed(2)}`;

  test("spend sentence with a category", () => {
    const answer = ask("what did I spend on dining in january 2026");
    expect(formatLedgerAnswer(answer, dollars)).toBe(
      "You spent $200.00 on Dining Drinks in Jan 2026.",
    );
  });

  test("revenue sentence without a category", () => {
    const answer = ask("how much did we earn in january 2026");
    expect(formatLedgerAnswer(answer, dollars)).toBe(
      "You earned $2000.00 in Jan 2026.",
    );
  });

  test("net sentence", () => {
    const answer = ask("net in january 2026");
    expect(formatLedgerAnswer(answer, dollars)).toBe(
      "Your net in Jan 2026 was $1500.00.",
    );
  });
});
