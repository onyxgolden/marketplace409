import { describe, expect, test } from "vitest";

import { Money } from "../../../../platform";
import { JournalEntry } from "../../entities/JournalEntry";
import { Posting } from "../../entities/Posting";
import { LedgerDirection } from "../../value-objects";
import { AccountingPeriod } from "../../entities/AccountingPeriod";
import { InMemoryAccountingPeriodRepository } from "../../repositories/InMemoryAccountingPeriodRepository";
import { AccountingPeriodService } from "../AccountingPeriodService";
import { AccountingPeriodValidator } from "../AccountingPeriodValidator";
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

function createAccountingPeriodValidator(periods = []) {
  return new AccountingPeriodValidator({
    accountingPeriodService: new AccountingPeriodService(
      new InMemoryAccountingPeriodRepository(periods),
    ),
  });
}

function createOpenPeriod() {
  return new AccountingPeriod({
    id: "2026-06",
    name: "June 2026",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
  });
}

function createClosedPeriod() {
  return new AccountingPeriod({
    id: "2026-06",
    name: "June 2026",
    startDate: "2026-06-01",
    endDate: "2026-06-30",
    isClosed: true,
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

  test("validates journal entry date against an open accounting period when provided", () => {
    const validator = new PostingValidator({
      accountingPeriodValidator: createAccountingPeriodValidator([
        createOpenPeriod(),
      ]),
    });

    expect(validator.validate(createJournalEntry())).toBe(true);
  });

  test("throws when journal entry date is outside all accounting periods", () => {
    const validator = new PostingValidator({
      accountingPeriodValidator: createAccountingPeriodValidator([
        createOpenPeriod(),
      ]),
    });

    const entry = new JournalEntry({
      id: "JE-MISSING-PERIOD",
      date: "2026-07-01",
      postings: [createDebitPosting(), createCreditPosting()],
    });

    expect(() => validator.validate(entry)).toThrow(
      "JournalEntry date is outside an accounting period: 2026-07-01",
    );
  });

  test("throws when journal entry date belongs to a closed accounting period", () => {
    const validator = new PostingValidator({
      accountingPeriodValidator: createAccountingPeriodValidator([
        createClosedPeriod(),
      ]),
    });

    expect(() => validator.validate(createJournalEntry())).toThrow(
      "JournalEntry date belongs to a closed accounting period: 2026-06",
    );
  });

  test("requires a JournalEntry", () => {
    const validator = new PostingValidator();

    expect(() => validator.validate({})).toThrow(
      "PostingValidator requires a JournalEntry"
    );
  });
});