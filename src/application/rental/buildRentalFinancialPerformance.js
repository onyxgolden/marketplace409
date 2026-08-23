// Reuses Financial FORGE's own authoritative income/expense classification
// (financial_events.transaction_kind / normalized_category — see
// src/domains/knowledge/category-map.ts and buildIncomeExpenseStatement.js) rather than
// reinventing categorization here.
//
// SCOPE (deliberately conservative — see the Rental Summary rollout report for the full
// investigation): financial_events.property_id is NOT reliably joinable to rental_units /
// rental_leases — two independent import pipelines canonicalize property names differently
// (PropertyId.fromSourceName vs. the rental-migration slug() helper strip different substrings),
// so per-property attribution across historical Rentec data cannot be safely derived from
// property_id alone. Portfolio-wide inclusion is instead scoped by source_system, which IS
// reliable and deterministic (never guessed, never fuzzy-matched):
//   - "rentec"              — the one-time historical Rentec CSV bulk import. Rentec is
//                              exclusively a property-management platform, so every row it
//                              produced is rental-portfolio activity by construction.
//   - "forge_rental_payment"— posted automatically (DB trigger) from every succeeded
//                              rental_payments row, already scoped via rental_leases.property_id.
//                              Income only — there is no equivalent trigger for expenses.
//   - "manual"               — written exclusively by /api/rental/manual-financial-event (grep
//                              confirms no other route uses this source_system), i.e. entered by
//                              the landlord from within the Rental Manager itself.
// Deliberately EXCLUDED: "transaction" (Plaid bank-feed imports, resolved by owner-configurable
// rules with no guarantee they target this rental portfolio) and "quickbooks" (same property-
// resolution uncertainty as the historical Rentec import, without Rentec's platform-scoping
// justification). Transfers, asset purchases/sales, and liability (loan) payments are excluded
// by transaction_kind, matching buildIncomeExpenseStatement's own exclusions — this also removes
// tenant security deposits (transaction_kind "transfer") and loan proceeds/principal
// ("liability_payment") without any extra filtering logic.
const SAFE_INCOME_SOURCES = new Set(["rentec", "forge_rental_payment"]);
const SAFE_EXPENSE_SOURCES = new Set(["rentec", "manual"]);

function isSafeRentalEvent(event) {
  if (!event || event.status === "inactive" || event.status === "deleted" || event.is_deleted === true) return false;
  if (!event.event_date) return false;
  if (event.transaction_kind === "income") return SAFE_INCOME_SOURCES.has(event.source_system);
  if (event.transaction_kind === "expense") return SAFE_EXPENSE_SOURCES.has(event.source_system);
  return false;
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
  return { collectedCents: 0, expensesCents: 0 };
}

// Buckets every safe event once, by both month and year, so any period view can be derived from
// a single pass without re-scanning the raw event list.
function bucketSafeEvents(financialEvents) {
  const byMonth = new Map();
  const byYear = new Map();
  for (const event of financialEvents) {
    if (!isSafeRentalEvent(event)) continue;
    const mKey = monthKey(event.event_date);
    const yKey = yearKey(event.event_date);
    if (!byMonth.has(mKey)) byMonth.set(mKey, emptyBucket());
    if (!byYear.has(yKey)) byYear.set(yKey, emptyBucket());
    const cents = toCents(event.amount);
    const field = event.transaction_kind === "income" ? "collectedCents" : "expensesCents";
    byMonth.get(mKey)[field] += cents;
    byYear.get(yKey)[field] += cents;
  }
  return { byMonth, byYear };
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
    key, collectedCents: b.collectedCents, expensesCents: b.expensesCents, netCents: b.collectedCents - b.expensesCents,
  });
}

const PERIOD_TYPES = Object.freeze(["sixMonths", "ytd", "year", "allTime"]);

export function buildRentalFinancialPerformance(financialEvents = [], { today = new Date().toISOString().slice(0, 10), period = { type: "sixMonths" } } = {}) {
  const { byMonth, byYear } = bucketSafeEvents(financialEvents);
  const availableYears = Object.freeze([...byYear.keys()].filter((key) => key.length === 4).map(Number).sort((a, b) => a - b));

  const [todayYear, todayMonth] = today.slice(0, 7).split("-").map(Number);
  const periodType = PERIOD_TYPES.includes(period?.type) ? period.type : "sixMonths";

  let granularity = "monthly";
  let keys = [];

  if (periodType === "sixMonths") {
    keys = monthsInRange(todayYear, todayMonth - 5, 6);
  } else if (periodType === "ytd") {
    keys = monthsInRange(todayYear, 1, todayMonth);
  } else if (periodType === "year") {
    const year = Number.isInteger(period.year) ? period.year : todayYear;
    keys = monthsInRange(year, 1, 12);
  } else if (periodType === "allTime") {
    granularity = "yearly";
    const earliest = availableYears.length > 0 ? availableYears[0] : todayYear;
    for (let year = earliest; year <= todayYear; year += 1) keys.push(String(year));
  }

  const source = granularity === "yearly" ? byYear : byMonth;
  const series = Object.freeze(keys.map((key) => seriesPoint(key, source.get(key))));
  const totals = series.reduce((acc, point) => Object.freeze({
    collectedCents: acc.collectedCents + point.collectedCents,
    expensesCents: acc.expensesCents + point.expensesCents,
    netCents: acc.netCents + point.netCents,
  }), { collectedCents: 0, expensesCents: 0, netCents: 0 });

  return Object.freeze({
    basis: "cash",
    granularity,
    periodType,
    series,
    totals: Object.freeze(totals),
    availableYears,
  });
}
