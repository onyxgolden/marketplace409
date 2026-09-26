// "Left this month" cash-flow residual -- pure domain logic, no I/O.
//
// Widget math, spelled out for the panel:
//   expected income remaining (upcoming detected recurring income, today through month end)
// - expected bills remaining (upcoming detected recurring bills, today through month end)
// - planned spending (the month's budget plan: still-unspent dollars per line)
// = amount left, plus a daily average (left / days remaining in the month).
//
// Honesty rules (the widget's whole point):
// - Every figure is derived from real data: detected recurring-payment patterns and the
//   month's budget lines. Nothing is estimated or invented.
// - A term with no backing data is marked unknown and excluded from the math -- it is
//   never silently counted as $0. Callers must label it as untracked.
// - No data at all (hasAnyData === false) means "render the empty state", never a $0 headline.
import {
  upcomingRecurringOccurrences,
} from "@/domains/financial-event/detectRecurringPayments";

// Days from today through the last day of the month, inclusive. Always >= 1
// (on the last day of the month the answer is 1).
export function daysRemainingInMonth(today = new Date()) {
  const year = today.getFullYear();
  const month = today.getMonth();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  return Math.max(1, daysInMonth - today.getDate() + 1);
}

// Local YYYY-MM-DD (upcomingRecurringOccurrences steps dates in UTC, so the
// start date must be built from local fields, not toISOString()).
export function toISODateLocal(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function monthKeyOf(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function monthNameOf(date) {
  return date.toLocaleDateString("en-US", { month: "long" });
}

// "Sep 30" style end-of-month label for "through {monthEndLabel}" copy.
export function monthEndLabelOf(today = new Date()) {
  return new Date(today.getFullYear(), today.getMonth() + 1, 0).toLocaleDateString(
    "en-US",
    { month: "short", day: "numeric" },
  );
}

const toCents = (dollars) => Math.round(Number(dollars || 0) * 100);

// patterns: detected recurring-payment patterns (from /api/financial/recurring).
// budgetLines: the month's budget lines (from /api/budgeting/plan).
// today: the reference date (defaults to now; injected in tests).
export function buildLeftThisMonth({ patterns, budgetLines, today = new Date() } = {}) {
  const daysRemaining = daysRemainingInMonth(today);
  const monthName = monthNameOf(today);
  const monthEndLabel = monthEndLabelOf(today);

  // Unknown terms stay unknown: an empty/failed data source is NOT zero income.
  const recurringKnown = Array.isArray(patterns) && patterns.length > 0;
  const budgetKnown = Array.isArray(budgetLines) && budgetLines.length > 0;

  // Only occurrences still ahead of us (today through month end) count as "remaining".
  // Patterns whose nextExpectedDate already passed step forward by their rhythm and
  // contribute only the occurrences that fall inside the window.
  const occurrences = recurringKnown
    ? upcomingRecurringOccurrences(patterns, {
        fromDate: toISODateLocal(today),
        daysAhead: daysRemaining,
      })
    : [];

  const incomeOccurrences = occurrences.filter(
    (occurrence) => occurrence.direction === "inbound",
  );
  const billOccurrences = occurrences.filter(
    (occurrence) => occurrence.direction === "outbound",
  );

  const incomeCents = incomeOccurrences.reduce(
    (sum, occurrence) => sum + toCents(occurrence.amount),
    0,
  );
  const billsCents = billOccurrences.reduce(
    (sum, occurrence) => sum + toCents(occurrence.amount),
    0,
  );

  // Planned spending = dollars still unspent per budget line (planned minus what
  // actually went out, floored at zero so an overspent line doesn't inflate the rest).
  const plannedSpendingCents = budgetKnown
    ? budgetLines.reduce((sum, line) => {
        const planned = Number(line?.plannedAmountCents ?? 0) || 0;
        const actual = Number(line?.actualAmountCents ?? 0) || 0;
        return sum + Math.max(0, planned - actual);
      }, 0)
    : 0;
  const totalPlannedCents = budgetKnown
    ? budgetLines.reduce(
        (sum, line) => sum + (Number(line?.plannedAmountCents ?? 0) || 0),
        0,
      )
    : 0;

  const residualCents = incomeCents - billsCents - plannedSpendingCents;
  const dailyCents = Math.round(residualCents / daysRemaining);

  // A definitive residual needs every cash-flow term known. Unknown income or
  // bills (no recurring patterns detected) means the answer is "not tracked
  // yet" -- never a number built on silent zeros.
  const residualKnown = recurringKnown;
  const headlineCents = residualKnown ? residualCents : null;
  const headlineDailyCents = residualKnown ? dailyCents : null;

  return Object.freeze({
    hasAnyData: recurringKnown || budgetKnown,
    daysRemaining,
    monthName,
    monthEndLabel,
    income: Object.freeze({
      cents: incomeCents,
      known: recurringKnown,
      occurrences: incomeOccurrences.length,
    }),
    bills: Object.freeze({
      cents: billsCents,
      known: recurringKnown,
      occurrences: billOccurrences.length,
    }),
    plannedSpending: Object.freeze({
      cents: plannedSpendingCents,
      known: budgetKnown,
      totalPlannedCents,
      lineCount: budgetLines?.length ?? 0,
    }),
    residualKnown,
    residualCents: headlineCents,
    dailyCents: headlineDailyCents,
    overBudget: residualKnown && headlineCents < 0,
  });
}

const toDollars = (cents) => Number(cents || 0) / 100;

// Plain-language spellout of the residual. The panel renders this verbatim, so
// every term names its source and unknown terms stay visibly untracked ("--"
// is never rendered as $0). money is injected so the module stays formatter-agnostic.
export function describeLeftThisMonth(result, money) {
  const format = (cents) => money(toDollars(cents));

  const incomeText = result.income.known
    ? `${format(result.income.cents)} expected income`
    : "expected income not tracked yet";
  const billsText = result.bills.known
    ? `${format(result.bills.cents)} expected bills`
    : "expected bills not tracked yet";
  const plannedText = result.plannedSpending.known
    ? `${format(result.plannedSpending.cents)} planned spending`
    : "planned spending not tracked yet";

  const equation = `${incomeText} \u2212 ${billsText} \u2212 ${plannedText}`;

  const dayUnit = result.daysRemaining === 1 ? "day" : "days";
  const resultText = !result.residualKnown
    ? "not tracked yet"
    : result.overBudget
      ? `${format(Math.abs(result.residualCents))} over budget`
      : `${format(result.residualCents)} left`;
  const dailyText = !result.residualKnown
    ? "no daily average until expected income and bills are tracked"
    : result.overBudget
      ? `${format(Math.abs(result.dailyCents))}/day over budget for ${result.daysRemaining} ${dayUnit}`
      : `${format(Math.abs(result.dailyCents))}/day for ${result.daysRemaining} ${dayUnit}`;

  const incomeNote = result.income.known
    ? `${format(result.income.cents)} expected income \u2014 ${result.income.occurrences} upcoming recurring income occurrence${result.income.occurrences === 1 ? "" : "s"} through ${result.monthEndLabel}, detected from your transaction history.`
    : "No recurring income detected, so expected income is not in the math. Connect accounts with regular paychecks or deposits and this line fills in.";
  const billsNote = result.bills.known
    ? `${format(result.bills.cents)} expected bills \u2014 ${result.bills.occurrences} upcoming recurring bill occurrence${result.bills.occurrences === 1 ? "" : "s"} through ${result.monthEndLabel}, detected from your transaction history.`
    : "No recurring bills detected, so expected bills are not in the math. Once regular bills are detected from your transactions, this line fills in.";
  const plannedNote = result.plannedSpending.known
    ? `${format(result.plannedSpending.cents)} planned spending \u2014 ${format(result.plannedSpending.cents)} of ${format(result.plannedSpending.totalPlannedCents)} planned is still unspent in your ${result.monthName} budget.`
    : `No budget plan for ${result.monthName}, so planned spending is not in the math. Set one on the budget screen and it feeds this widget.`;

  // Bills and budget lines can describe the same payment (e.g. a detected
  // monthly bill that is also a budget line). We sum both as reported and say
  // so, rather than silently double-counting or inventing an allocation.
  const overlapNote =
    result.bills.known && result.plannedSpending.known
      ? "A bill that is both a detected recurring payment and a budget line may be counted twice \u2014 bills and budget lines are summed separately."
      : null;

  return Object.freeze({
    equation,
    resultText,
    dailyText,
    incomeNote,
    billsNote,
    plannedNote,
    overlapNote,
  });
}
