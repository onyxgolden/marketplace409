import { describe, expect, test } from "vitest";

import { Money } from "../../../../platform";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { PostingValidator } from "../PostingValidator";

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

function createJournalEntry(debit = 100, credit = 100) {
  return new JournalEntry({
    id: "JE1",
    date: "2026-06-18",
    postings: [createDebitPosting(debit), createCreditPosting(credit)],
  });
}

describe("PostingValidator", () => {
  test("validates a balanced journal entry", () => {
    const validator = new PostingValidator();

    expect(validator.validate(createJournalEntry())).toBe(true);
  });

  test("can validate multiple journal entries", () => {
    const validator = new PostingValidator();

    expect(validator.validate(createJournalEntry(100, 100))).toBe(true);
    expect(validator.validate(createJournalEntry(2500, 2500))).toBe(true);
    expect(validator.validate(createJournalEntry(999999, 999999))).toBe(true);
  });

  test("validation is repeatable", () => {
    const validator = new PostingValidator();
    const entry = createJournalEntry();

    expect(validator.validate(entry)).toBe(true);
    expect(validator.validate(entry)).toBe(true);
    expect(validator.validate(entry)).toBe(true);
  });

  test("does not mutate the journal entry", () => {
    const validator = new PostingValidator();
    const entry = createJournalEntry();

    validator.validate(entry);

    expect(Object.isFrozen(entry)).toBe(true);
    expect(entry.postings).toHaveLength(2);
    expect(entry.getDebitTotal().amount).toBe(100);
    expect(entry.getCreditTotal().amount).toBe(100);
  });

  test("requires a JournalEntry", () => {
    const validator = new PostingValidator();

    expect(() => validator.validate({})).toThrow(
      "PostingValidator requires a JournalEntry"
    );
  });
});