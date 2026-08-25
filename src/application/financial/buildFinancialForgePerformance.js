// Financial FORGE's own income/expense-by-period view, built the same way
// buildRentalFinancialPerformance.js builds the rental portfolio's — bucket once by month and by
// year, then slice whichever period the caller asked for. The difference: rental scopes inclusion
// by a source_system allowlist (only genuine rental-portfolio sources), while Financial FORGE
// scopes inclusion by business_scope, because its whole purpose is to show an owner's full
// business OR personal activity, never both blended into one number.
const PERIOD_TYPES = Object.freeze(["sixMonths", "ytd", "year", "allTime"]);

function isScopedActivity(event, scope) {
  if (!event) return false;
  if (event.businessScope !== scope) return false;
  return event.transactionKind === "income" || event.transactionKind === "expense";
}

function toCents(amount) {
  return Math.round(Math.abs(Number(amount || 0)) * 100);
}

function monthKey(dateLike) {
  return String(dateLike || "").slice(0, 7);
}

function yearKey(dateLike) {
  return String(dateLike || "").slice(0, 4);
}

function emptyBucket() {
  return { incomeCents: 0, expensesCents: 0 };
}

function monthsInRange(startYear, startMonth, count) {
  const keys = [];
  for (let offset = 0; offset < count; offset += 1) {
    const date = new Date(Date.UTC(startYear, startMonth - 1 + offset, 1));
    keys.push(`${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`);
  }
  return keys;
}

function seriesPoint(key, bucket) {
  const b = bucket || emptyBucket();
  return Object.freeze({
    key, incomeCents: b.incomeCents, expensesCents: b.expensesCents, netCents: b.incomeCents - b.expensesCents,
  });
}

function scopedCoverage(financialEvents, scope) {
  let earliest = null;
  let latest = null;
  for (const event of financialEvents) {
    if (event?.businessScope !== scope || !event.eventDate) continue;
    if (earliest === null || event.eventDate < earliest) earliest = event.eventDate;
    if (latest === null || event.eventDate > latest) latest = event.eventDate;
  }
  return Object.freeze({ earliest, latest });
}

export function buildFinancialForgePerformance(financialEvents = [], {
  today = new Date().toISOString().slice(0, 10),
  period = { type: "sixMonths" },
  scope = "business",
  accountsById = {},
} = {}) {
  if (scope !== "business" && scope !== "personal") {
    throw new Error(`Financial FORGE performance scope must be "business" or "personal", got: ${scope}`);
  }

  const scopedEvents = financialEvents.filter((event) => isScopedActivity(event, scope));

  const byMonth = new Map();
  const byYear = new Map();
  for (const event of scopedEvents) {
    const mKey = monthKey(event.eventDate);
    const yKey = yearKey(event.eventDate);
    if (!byMonth.has(mKey)) byMonth.set(mKey, emptyBucket());
    if (!byYear.has(yKey)) byYear.set(yKey, emptyBucket());
    const cents = toCents(event.amount);
    const field = event.transactionKind === "income" ? "incomeCents" : "expensesCents";
    byMonth.get(mKey)[field] += cents;
    byYear.get(yKey)[field] += cents;
  }

  const availableYears = Object.freeze(
    [...byYear.keys()].filter((key) => key.length === 4).map(Number).sort((a, b) => a - b),
  );

  const [todayYear, todayMonth] = today.slice(0, 7).split("-").map(Number);
  const periodType = PERIOD_TYPES.includes(period?.type) ? period.type : "sixMonths";

  let granularity = "monthly";
  let keys = [];
  let periodStart = null;
  let periodEnd = null;

  if (periodType === "sixMonths") {
    keys = monthsInRange(todayYear, todayMonth - 5, 6);
    periodStart = `${keys[0]}-01`;
    periodEnd = today;
  } else if (periodType === "ytd") {
    keys = monthsInRange(todayYear, 1, todayMonth);
    periodStart = `${todayYear}-01-01`;
    periodEnd = today;
  } else if (periodType === "year") {
    const year = Number.isInteger(period.year) ? period.year : todayYear;
    keys = monthsInRange(year, 1, 12);
    periodStart = `${year}-01-01`;
    periodEnd = `${year}-12-31`;
  } else if (periodType === "allTime") {
    granularity = "yearly";
    const earliestWithData = availableYears.length > 0 ? availableYears[0] : todayYear;
    for (let year = earliestWithData; year <= todayYear; year += 1) keys.push(String(year));
    periodStart = null;
    periodEnd = null;
  }

  const source = granularity === "yearly" ? byYear : byMonth;
  const series = Object.freeze(keys.map((key) => seriesPoint(key, source.get(key))));
  const totals = series.reduce((acc, point) => Object.freeze({
    incomeCents: acc.incomeCents + point.incomeCents,
    expensesCents: acc.expensesCents + point.expensesCents,
    netCents: acc.netCents + point.netCents,
  }), { incomeCents: 0, expensesCents: 0, netCents: 0 });

  const periodEvents = scopedEvents.filter((event) => {
    if (!periodStart || !periodEnd) return true;
    return event.eventDate >= periodStart && event.eventDate <= periodEnd;
  });

  const categoryTotals = new Map();
  const accountTotals = new Map();
  let transactionCount = 0;

  for (const event of periodEvents) {
    transactionCount += 1;
    const cents = toCents(event.amount);
    const signed = event.transactionKind === "income" ? cents : -cents;

    const category = event.category || "uncategorized";
    if (!categoryTotals.has(category)) {
      categoryTotals.set(category, { category, incomeCents: 0, expensesCents: 0, netCents: 0 });
    }
    const categorySummary = categoryTotals.get(category);
    if (event.transactionKind === "income") categorySummary.incomeCents += cents;
    else categorySummary.expensesCents += cents;
    categorySummary.netCents += signed;

    const accountId = event.financialAccountId || "unassigned";
    if (!accountTotals.has(accountId)) {
      accountTotals.set(accountId, {
        accountId,
        accountName: accountsById[accountId] || (accountId === "unassigned" ? "Unassigned" : accountId),
        netCents: 0,
        transactionCount: 0,
      });
    }
    const accountSummary = accountTotals.get(accountId);
    accountSummary.netCents += signed;
    accountSummary.transactionCount += 1;
  }

  const categories = Object.freeze(
    [...categoryTotals.values()].sort((left, right) => right.expensesCents - left.expensesCents).map(Object.freeze),
  );
  const accounts = Object.freeze(
    [...accountTotals.values()].sort((left, right) => right.transactionCount - left.transactionCount).map(Object.freeze),
  );

  return Object.freeze({
    basis: "cash",
    granularity,
    periodType,
    scope,
    series,
    totals: Object.freeze({ ...totals, transactionCount }),
    availableYears,
    categories,
    accounts,
    coverage: scopedCoverage(financialEvents, scope),
  });
}
