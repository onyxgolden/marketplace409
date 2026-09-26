import { describe, expect, it } from "vitest";
import {
  buildLeftThisMonth,
  daysRemainingInMonth,
  describeLeftThisMonth,
  monthEndLabelOf,
  monthKeyOf,
} from "./leftThisMonth.js";

// Fixed reference date: Saturday 2026-09-26 -> 5 days remain (26..30).
const TODAY = new Date(2026, 8, 26);

// Recurring patterns shaped like detectRecurringPayments() output.
function pattern(overrides) {
  return {
    accountId: "acct-1",
    accountName: "Checking",
    businessScope: "personal",
    category: "paycheck",
    cadence: "monthly",
    medianIntervalDays: 30,
    occurrences: 6,
    medianAmount: 100,
    nextExpectedDate: "2026-09-28",
    ...overrides,
  };
}

const incomePattern = () =>
  pattern({
    direction: "inbound",
    category: "paycheck",
    medianAmount: 2000,
    nextExpectedDate: "2026-09-28",
    medianIntervalDays: 14,
  });

const monthlyBill = () =>
  pattern({
    direction: "outbound",
    category: "mortgage",
    medianAmount: 1500,
    nextExpectedDate: "2026-09-27",
    medianIntervalDays: 30,
  });

const biweeklyBill = () =>
  pattern({
    direction: "outbound",
    category: "insurance",
    medianAmount: 300,
    nextExpectedDate: "2026-09-29",
    medianIntervalDays: 14,
  });

// money() stub matching the dashboard formatter's shape ($X.XX).
const fakeMoney = (dollars) => `$${Number(dollars).toFixed(2)}`;

describe("daysRemainingInMonth", () => {
  it("counts today through month end, inclusive", () => {
    expect(daysRemainingInMonth(TODAY)).toBe(5);
  });

  it("is 1 on the last day of the month", () => {
    expect(daysRemainingInMonth(new Date(2026, 8, 30))).toBe(1);
  });

  it("handles February in a non-leap year", () => {
    expect(daysRemainingInMonth(new Date(2026, 1, 1))).toBe(28);
  });

  it("handles February in a leap year", () => {
    expect(daysRemainingInMonth(new Date(2024, 1, 28))).toBe(2);
  });
});

describe("monthKeyOf / monthEndLabelOf", () => {
  it("builds the YYYY-MM key from local fields", () => {
    expect(monthKeyOf(TODAY)).toBe("2026-09");
  });

  it("labels the end of the month", () => {
    expect(monthEndLabelOf(TODAY)).toBe("Sep 30");
  });
});

describe("buildLeftThisMonth residual math", () => {
  it("income minus bills minus planned spending = left; daily = left / days remaining", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [incomePattern(), monthlyBill(), biweeklyBill()],
      // $2,000 income on Sep 28; $1,500 + $300 bills on Sep 27/29; $150 planned left.
      budgetLines: [{ plannedAmountCents: 80000, actualAmountCents: 65000 }],
    });

    expect(result.income.cents).toBe(200000);
    expect(result.bills.cents).toBe(180000);
    expect(result.plannedSpending.cents).toBe(15000);
    expect(result.residualCents).toBe(5000);
    expect(result.dailyCents).toBe(1000);
    expect(result.daysRemaining).toBe(5);
    expect(result.overBudget).toBe(false);
    expect(result.hasAnyData).toBe(true);
  });

  it("counts only occurrences inside the remaining window", () => {
    // Next occurrence after month end -> nothing left this month.
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [
        pattern({ direction: "inbound", medianAmount: 2000, nextExpectedDate: "2026-10-02", medianIntervalDays: 14 }),
      ],
      budgetLines: [],
    });
    expect(result.income.cents).toBe(0);
    expect(result.income.known).toBe(true);
    expect(result.income.occurrences).toBe(0);
  });

  it("skips past occurrences and steps forward by the pattern rhythm", () => {
    // Stale nextExpectedDate (Sep 20); biweekly rhythm steps to Oct 4 -> no occurrence left.
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [
        pattern({ direction: "outbound", medianAmount: 500, nextExpectedDate: "2026-09-20", medianIntervalDays: 14 }),
      ],
      budgetLines: [],
    });
    expect(result.bills.cents).toBe(0);
  });

  it("floors overspent budget lines at zero instead of inflating the rest", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [],
      budgetLines: [
        { plannedAmountCents: 50000, actualAmountCents: 90000 },
        { plannedAmountCents: 30000, actualAmountCents: 10000 },
      ],
    });
    expect(result.plannedSpending.cents).toBe(20000);
    expect(result.plannedSpending.totalPlannedCents).toBe(80000);
  });

  it("marks terms unknown when their data source is empty -- never a silent $0", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [],
      budgetLines: [{ plannedAmountCents: 50000, actualAmountCents: 10000 }],
    });
    expect(result.income.known).toBe(false);
    expect(result.bills.known).toBe(false);
    expect(result.plannedSpending.known).toBe(true);
    expect(result.hasAnyData).toBe(true);
    // Unknown income/bills means no definitive residual: the answer is
    // "not tracked yet", never a number built on silent zeros.
    expect(result.residualKnown).toBe(false);
    expect(result.residualCents).toBeNull();
    expect(result.dailyCents).toBeNull();
    expect(result.overBudget).toBe(false);
  });

  it("reports no data at all when every source is empty", () => {
    expect(buildLeftThisMonth({ today: TODAY, patterns: [], budgetLines: [] }).hasAnyData).toBe(false);
    expect(buildLeftThisMonth({ today: TODAY, patterns: null, budgetLines: null }).hasAnyData).toBe(false);
  });
});

describe("describeLeftThisMonth plain-language breakdown", () => {
  it("spells the math out term by term", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [incomePattern(), monthlyBill(), biweeklyBill()],
      budgetLines: [{ plannedAmountCents: 80000, actualAmountCents: 65000 }],
    });
    const description = describeLeftThisMonth(result, fakeMoney);

    expect(description.equation).toBe(
      "$2000.00 expected income − $1800.00 expected bills − $150.00 planned spending",
    );
    expect(description.resultText).toBe("$50.00 left");
    expect(description.dailyText).toBe("$10.00/day for 5 days");
  });

  it("frames a negative residual as over budget, never as a negative headline", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [monthlyBill()], // $1,500 bills, no income occurrences left this month
      budgetLines: [],
    });
    expect(result.overBudget).toBe(true);
    const description = describeLeftThisMonth(result, fakeMoney);
    expect(description.resultText).toBe("$1500.00 over budget");
    expect(description.dailyText).toBe("$300.00/day over budget for 5 days");
    expect(description.equation).toContain("$0.00 expected income");
    expect(description.equation).toContain("planned spending not tracked yet");
  });

  it("labels untracked terms instead of zeroing them", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [],
      budgetLines: [{ plannedAmountCents: 50000, actualAmountCents: 10000 }],
    });
    const description = describeLeftThisMonth(result, fakeMoney);
    expect(description.equation).toBe(
      "expected income not tracked yet − expected bills not tracked yet − $400.00 planned spending",
    );
    expect(description.incomeNote).toContain("No recurring income detected");
    expect(description.plannedNote).toContain("September");
    expect(description.plannedNote).toContain("$500.00");
  });

  it("renders 'not tracked yet' -- never a headline number -- when income/bills are unknown", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [],
      budgetLines: [{ plannedAmountCents: 50000, actualAmountCents: 10000 }],
    });
    const description = describeLeftThisMonth(result, fakeMoney);
    expect(description.resultText).toBe("not tracked yet");
    expect(description.dailyText).toBe(
      "no daily average until expected income and bills are tracked",
    );
  });

  it("still computes a residual when only the budget is untracked", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [monthlyBill()], // $1,500 bills, no income occurrences left this month
      budgetLines: [],
    });
    expect(result.residualKnown).toBe(true);
    expect(result.residualCents).toBe(-150000);
    const description = describeLeftThisMonth(result, fakeMoney);
    expect(description.equation).toContain("planned spending not tracked yet");
    expect(description.resultText).toBe("$1500.00 over budget");
  });

  it("warns when bills and budget lines may double-count the same payment", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [monthlyBill()],
      budgetLines: [{ plannedAmountCents: 50000, actualAmountCents: 10000 }],
    });
    expect(describeLeftThisMonth(result, fakeMoney).overlapNote).toContain(
      "may be counted twice",
    );
  });

  it("omits the overlap warning when a term is untracked", () => {
    const result = buildLeftThisMonth({
      today: TODAY,
      patterns: [],
      budgetLines: [{ plannedAmountCents: 50000, actualAmountCents: 10000 }],
    });
    expect(describeLeftThisMonth(result, fakeMoney).overlapNote).toBeNull();
  });
});
