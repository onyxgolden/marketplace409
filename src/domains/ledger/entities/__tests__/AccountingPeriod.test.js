import { AccountingPeriod } from "../AccountingPeriod";

describe("AccountingPeriod", () => {
  const validPeriod = () =>
    new AccountingPeriod({
      id: "2026-01",
      name: "January 2026",
      startDate: "2026-01-01",
      endDate: "2026-01-31",
    });

  it("creates an open accounting period by default", () => {
    const period = validPeriod();

    expect(period.id).toBe("2026-01");
    expect(period.name).toBe("January 2026");
    expect(period.isOpen()).toBe(true);
    expect(period.isClosed).toBe(false);
  });

  it("supports closed accounting periods", () => {
    const period = new AccountingPeriod({
      id: "2025-12",
      name: "December 2025",
      startDate: "2025-12-01",
      endDate: "2025-12-31",
      isClosed: true,
    });

    expect(period.isOpen()).toBe(false);
    expect(period.isClosed).toBe(true);
  });

  it("contains dates within the period", () => {
    const period = validPeriod();

    expect(period.containsDate("2026-01-01")).toBe(true);
    expect(period.containsDate("2026-01-15")).toBe(true);
    expect(period.containsDate("2026-01-31")).toBe(true);
    expect(period.containsDate("2026-02-01")).toBe(false);
  });

  it("rejects an end date before the start date", () => {
    expect(() => {
      new AccountingPeriod({
        id: "bad",
        name: "Invalid",
        startDate: "2026-02-01",
        endDate: "2026-01-31",
      });
    }).toThrow("AccountingPeriod endDate must not precede startDate");
  });

  it("is immutable", () => {
    const period = validPeriod();

    expect(Object.isFrozen(period)).toBe(true);
  });

  it("serializes to JSON", () => {
    const json = validPeriod().toJSON();

    expect(json).toMatchObject({
      id: "2026-01",
      name: "January 2026",
      isClosed: false,
    });

    expect(json.startDate).toContain("2026-01-01");
    expect(json.endDate).toContain("2026-01-31");
  });
  it("requires an id", () => {
    expect(() => {
      new AccountingPeriod({
        name: "January 2026",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      });
    }).toThrow("AccountingPeriod requires an id");
  });

  it("requires a name", () => {
    expect(() => {
      new AccountingPeriod({
        id: "2026-01",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
      });
    }).toThrow("AccountingPeriod requires a name");
  });

  it("rejects an invalid startDate", () => {
    expect(() => {
      new AccountingPeriod({
        id: "2026-01",
        name: "January 2026",
        startDate: "not-a-date",
        endDate: "2026-01-31",
      });
    }).toThrow("AccountingPeriod startDate is invalid");
  });

  it("rejects an invalid endDate", () => {
    expect(() => {
      new AccountingPeriod({
        id: "2026-01",
        name: "January 2026",
        startDate: "2026-01-01",
        endDate: "not-a-date",
      });
    }).toThrow("AccountingPeriod endDate is invalid");
  });

  it("rejects an invalid createdAt", () => {
    expect(() => {
      new AccountingPeriod({
        id: "2026-01",
        name: "January 2026",
        startDate: "2026-01-01",
        endDate: "2026-01-31",
        createdAt: "not-a-date",
      });
    }).toThrow("AccountingPeriod createdAt is invalid");
  });

  it("rejects an invalid containsDate argument", () => {
    const period = validPeriod();

    expect(() => {
      period.containsDate("not-a-date");
    }).toThrow("AccountingPeriod containsDate requires a valid date");
  });
});
