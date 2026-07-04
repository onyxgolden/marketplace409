import { describe, expect, test } from "vitest";

import { AccountingPeriod } from "../../entities/AccountingPeriod";
import { InMemoryAccountingPeriodRepository } from "../../repositories/InMemoryAccountingPeriodRepository";
import { AccountingPeriodService } from "../AccountingPeriodService";
import { AccountingPeriodValidator } from "../AccountingPeriodValidator";

function createAccountingPeriodService(periods = []) {
  return new AccountingPeriodService(
    new InMemoryAccountingPeriodRepository(periods),
  );
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

describe("AccountingPeriodValidator", () => {
  test("requires an AccountingPeriodService", () => {
    expect(() => new AccountingPeriodValidator()).toThrow(
      "AccountingPeriodValidator requires an AccountingPeriodService",
    );
  });

  test("validates a date inside an open accounting period", () => {
    const validator = new AccountingPeriodValidator({
      accountingPeriodService: createAccountingPeriodService([
        createOpenPeriod(),
      ]),
    });

    expect(validator.validateDateIsPostable("2026-06-18")).toBe(true);
  });

  test("throws when date is outside all accounting periods", () => {
    const validator = new AccountingPeriodValidator({
      accountingPeriodService: createAccountingPeriodService([
        createOpenPeriod(),
      ]),
    });

    expect(() => validator.validateDateIsPostable("2026-07-01")).toThrow(
      "JournalEntry date is outside an accounting period: 2026-07-01",
    );
  });

  test("throws when date belongs to a closed accounting period", () => {
    const validator = new AccountingPeriodValidator({
      accountingPeriodService: createAccountingPeriodService([
        createClosedPeriod(),
      ]),
    });

    expect(() => validator.validateDateIsPostable("2026-06-18")).toThrow(
      "JournalEntry date belongs to a closed accounting period: 2026-06",
    );
  });
});
