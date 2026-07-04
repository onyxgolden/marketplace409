import { describe, expect, it } from "vitest";

import { AccountingPeriod } from "../../entities";
import { InMemoryAccountingPeriodRepository } from "../../repositories";
import { AccountingPeriodService } from "../AccountingPeriodService";

function createPeriod(id = "2026-01") {
  return new AccountingPeriod({
    id,
    name: "January 2026",
    startDate: "2026-01-01",
    endDate: "2026-01-31",
    isClosed: false,
  });
}

describe("AccountingPeriodService", () => {
  it("requires a repository", () => {
    expect(() => new AccountingPeriodService()).toThrow(
      "AccountingPeriodService requires a repository",
    );
  });

  it("creates an AccountingPeriod", () => {
    const repository = new InMemoryAccountingPeriodRepository();
    const service = new AccountingPeriodService(repository);

    const period = service.createPeriod({
      id: "2026-01",
      name: "January 2026",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

    expect(period).toBeInstanceOf(AccountingPeriod);
    expect(period.id).toBe("2026-01");
    expect(period.isClosed).toBe(false);
  });

  it("saves and retrieves a period", () => {
    const repository = new InMemoryAccountingPeriodRepository();
    const service = new AccountingPeriodService(repository);

    const period = createPeriod();

    const saved = service.savePeriod(period);
    const loaded = service.getPeriodById(period.id);

    expect(saved).toBe(period);
    expect(loaded).toBe(period);
  });

  it("finds the period containing a date", () => {
    const january = createPeriod("2026-01");
    const february = new AccountingPeriod({
      id: "2026-02",
      name: "February 2026",
      startDate: "2026-02-01",
      endDate: "2026-02-28",
    });

    const repository = new InMemoryAccountingPeriodRepository([
      january,
      february,
    ]);
    const service = new AccountingPeriodService(repository);

    expect(service.getPeriodForDate("2026-02-14")).toBe(february);
  });

  it("returns undefined when no period contains the date", () => {
    const repository = new InMemoryAccountingPeriodRepository([
      createPeriod(),
    ]);
    const service = new AccountingPeriodService(repository);

    expect(service.getPeriodForDate("2026-03-01")).toBeUndefined();
  });

  it("closes an existing period", () => {
    const repository = new InMemoryAccountingPeriodRepository();
    const service = new AccountingPeriodService(repository);

    const period = createPeriod();

    service.savePeriod(period);

    const closed = service.closePeriod(period.id);

    expect(closed).toBeInstanceOf(AccountingPeriod);
    expect(closed.id).toBe(period.id);
    expect(closed.isClosed).toBe(true);
    expect(closed).not.toBe(period);

    const stored = service.getPeriodById(period.id);

    expect(stored).toBe(closed);
  });

  it("throws when closing a missing period", () => {
    const repository = new InMemoryAccountingPeriodRepository();
    const service = new AccountingPeriodService(repository);

    expect(() => service.closePeriod("missing")).toThrow(
      "AccountingPeriod not found: missing",
    );
  });
});
