/**
 * comparativePeriods
 *
 * Pure helpers for multi-period reporting: expand a list of calendar-month keys
 * ("YYYY-MM") into concrete, inclusive accounting periods.
 */

const MONTH_KEY_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
const MAX_PERIODS = 12;

const monthLabelFormatter = new Intl.DateTimeFormat("en-US", {
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function pad2(value) {
  return String(value).padStart(2, "0");
}

function toPeriod(monthKey) {
  const key = String(monthKey ?? "").trim();
  const match = MONTH_KEY_PATTERN.exec(key);

  if (!match) {
    throw new Error(
      `Invalid month key "${monthKey}": expected YYYY-MM with a month from 01 to 12`,
    );
  }

  const year = Number(match[1]);
  const month = Number(match[2]);

  // Date.UTC rolls day 0 of the (1-based) next month back to the last day of this one --
  // correct for every month length, including February in leap years.
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();

  return Object.freeze({
    key: `${year}-${pad2(month)}`,
    label: monthLabelFormatter.format(new Date(Date.UTC(year, month - 1, 1))),
    startDate: `${year}-${pad2(month)}-01`,
    endDate: `${year}-${pad2(month)}-${pad2(lastDay)}`,
  });
}

/**
 * Expands month keys like ["2026-06", "2026-07"] into inclusive accounting periods.
 * Throws on anything that is not a strict YYYY-MM key; capped at 12 periods.
 */
export function expandMonths(monthKeys) {
  if (!Array.isArray(monthKeys) || monthKeys.length === 0) {
    throw new Error("expandMonths requires a non-empty array of YYYY-MM month keys");
  }

  if (monthKeys.length > MAX_PERIODS) {
    throw new Error(
      `expandMonths supports at most ${MAX_PERIODS} periods (received ${monthKeys.length})`,
    );
  }

  return Object.freeze(monthKeys.map(toPeriod));
}
