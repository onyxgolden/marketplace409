import { describe, expect, test } from "vitest";

import { Money } from "../../../../platform";
import { JournalEntry } from "../JournalEntry";
import { Posting } from "../Posting";
import { LedgerDirection } from "../../value-objects";

function createDebitPosting(amount = 100) {
  return new Posting({
    id: "P-DEBIT",
    accountId: "Cash",
    amount: new Money(amount),
    direction: LedgerDirection.DEBIT,
  });
}

function createCreditPosting(amount = 100) {
  return new Posting({
    id: "P-CREDIT",
    accountId: "Revenue",
    amount: new Money(amount),
    direction: LedgerDirection.CREDIT,
  });
}

describe("JournalEntry", () => {
  test("creates a balanced journal entry", () => {
    const entry = new JournalEntry({
      id: "JE1",
      date: "2026-06-18",
      description: "Opening entry",
      postings: [createDebitPosting(100), createCreditPosting(100)],
    });

    expect(entry.id).toBe("JE1");
    expect(entry.date).toBe("2026-06-18");
    expect(entry.description).toBe("Opening entry");
    expect(entry.postings).toHaveLength(2);
  });

  test("requires an id", () => {
    expect(() => {
      new JournalEntry({
        date: "2026-06-18",
        postings: [createDebitPosting(100), createCreditPosting(100)],
      });
    }).toThrow("JournalEntry requires an id");
  });

  test("requires a date", () => {
    expect(() => {
      new JournalEntry({
        id: "JE1",
        postings: [createDebitPosting(100), createCreditPosting(100)],
      });
    }).toThrow("JournalEntry requires a date");
  });

  test("requires postings to be an array", () => {
    expect(() => {
      new JournalEntry({
        id: "JE1",
        date: "2026-06-18",
        postings: "invalid",
      });
    }).toThrow("JournalEntry postings must be an array");
  });

  test("requires postings to contain only Posting objects", () => {
    expect(() => {
      new JournalEntry({
        id: "JE1",
        date: "2026-06-18",
        postings: [createDebitPosting(100), { invalid: true }],
      });
    }).toThrow("JournalEntry postings must contain Posting objects");
  });

  test("requires at least two postings", () => {
    expect(() => {
      new JournalEntry({
        id: "JE1",
        date: "2026-06-18",
        postings: [createDebitPosting(100)],
      });
    }).toThrow("JournalEntry requires at least two postings");
  });

  test("requires debits to equal credits", () => {
    expect(() => {
      new JournalEntry({
        id: "JE1",
        date: "2026-06-18",
        postings: [createDebitPosting(100), createCreditPosting(90)],
      });
    }).toThrow("JournalEntry debits must equal credits");
  });

  test("calculates debit and credit totals", () => {
    const entry = new JournalEntry({
      id: "JE1",
      date: "2026-06-18",
      postings: [createDebitPosting(100), createCreditPosting(100)],
    });

    expect(entry.getDebitTotal().amount).toBe(100);
    expect(entry.getCreditTotal().amount).toBe(100);
  });

  test("serializes to JSON", () => {
    const createdAt = new Date("2026-06-18T12:00:00.000Z");

    const entry = new JournalEntry({
      id: "JE1",
      date: "2026-06-18",
      description: "Opening entry",
      postings: [createDebitPosting(100), createCreditPosting(100)],
      metadata: { source: "test" },
      createdAt,
    });

    expect(entry.toJSON()).toEqual({
      id: "JE1",
      date: "2026-06-18",
      description: "Opening entry",
      postings: [
        {
          id: "P-DEBIT",
          accountId: "Cash",
          amount: { amount: 100, currency: "USD" },
          direction: LedgerDirection.DEBIT,
          description: "",
          metadata: {},
        },
        {
          id: "P-CREDIT",
          accountId: "Revenue",
          amount: { amount: 100, currency: "USD" },
          direction: LedgerDirection.CREDIT,
          description: "",
          metadata: {},
        },
      ],
      metadata: { source: "test" },
      createdAt,
    });
  });
  test("is immutable", () => {
    const entry = new JournalEntry({
      id: "JE1",
      date: "2026-06-18",
      postings: [createDebitPosting(100), createCreditPosting(100)],
    });

    expect(Object.isFrozen(entry)).toBe(true);
  });
});
