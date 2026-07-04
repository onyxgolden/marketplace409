import { describe, expect, test } from "vitest";

import { AccountingPeriod } from "../../entities/AccountingPeriod";
import { InMemoryAccountingPeriodRepository } from "../InMemoryAccountingPeriodRepository";

describe("InMemoryAccountingPeriodRepository", () => {
  test("returns undefined when a period is not found", () => {
    const repository = new InMemoryAccountingPeriodRepository();

    expect(repository.findById("missing")).toBeUndefined();
  });

  test("loads a seeded accounting period", () => {
    const period = new AccountingPeriod({
      id: "2026-01",
      name: "January 2026",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    const repository = new InMemoryAccountingPeriodRepository([period]);

    expect(repository.findById(period.id)).toBe(period);
  });
});
