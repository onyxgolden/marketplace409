import { describe, expect, test } from "vitest";

import { AccountingPeriod } from "../../entities/AccountingPeriod";
import { InMemoryAccountingPeriodRepository } from "../InMemoryAccountingPeriodRepository";

describe("InMemoryAccountingPeriodRepository save behavior", () => {
  test("returns the same accounting period that was saved", () => {
    const repository = new InMemoryAccountingPeriodRepository();

    const period = new AccountingPeriod({
      id: "2026-01",
      name: "January 2026",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    repository.save(period);

    const loadedPeriod = repository.findById(period.id);

    expect(loadedPeriod).toBe(period);
  });
});
