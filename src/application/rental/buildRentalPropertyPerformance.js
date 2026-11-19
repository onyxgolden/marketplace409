// Per-property performance read model for the Rental Manager Summary page.
//
// Buckets the owner-scoped financial_events history ONCE by canonical property
// slug and derives, per property, month-to-date / year-to-date / all-time
// operating profit, property tax paid, expense categories, capital
// improvements, and recorded cash invested. A separate Unassigned /
// unmatched reconciliation bucket holds every eligible event that cannot be
// attributed to a house, so no event is silently dropped or allocated.
//
// PROPERTY IDENTITY (proven live, not assumed):
// - The rental inventory is rental_units. rental_units.property_id is a TEXT
//   SLUG (e.g. "1218-wagner") and financial_events.property_id uses the same
//   slug convention. investor_properties is NOT the rental inventory (it holds
//   a single non-rental deal row) and must never be used as the property key.
// - Two historical import pipelines wrote the same house under different slugs
//   ("1900-west-decker" vs "1900-w-decker"). Raw slugs are therefore resolved
//   through canonicalPropertySlug (src/domains/property/propertyAliases.js),
//   the codebase's explicit, reviewable alias map — never fuzzy-matched, never
//   inferred from address fragments. Both the event slug and the unit slug are
//   canonicalized before comparison.
// - A property_financial_setups row is matched by EXACT property_id against
//   the unit's property_id (the save_property_financial_setup RPC itself
//   validates the id exists in rental_units), canonicalized the same way.
//
// INVESTMENT (proven from migration 20260824060000_add_property_financial_setup
// and the live rows — this is the double-counting trap the formula must avoid):
// - The setup RPC writes TWO capitalized asset_purchase events AND stores the
//   same figures on the setup row: a 'Property purchase' event for the FULL
//   purchase price and a 'Closing costs' event for the closing costs. The down
//   payment itself is not a separate event (it lives only in the purchase
//   event's metadata). Adding setup down_payment + closing_costs AND the sum
//   of all capitalized events would therefore double-count the closing costs
//   (and, for a cash purchase, the purchase price).
// - So: investment = (setup down_payment_cents + closing_costs_cents, when a
//   setup row matches) + capitalized events EXCLUDING the setup-written
//   purchase/closing-costs echo events (source_system =
//   'property_financial_setup' with normalized_category 'real_estate_purchase'
//   or 'closing_costs'). Setup-written renovation lines (':line:N',
//   'capital_improvement') are NOT echoes and stay in the sum, as do
//   capitalized events from other safe sources (e.g. legacy Rentec purchase /
//   rehab rows) — for properties with no setup row, those ARE the investment
//   record.
// - investor_properties.rehab_cost is deliberately NOT added: the only live
//   row (1053 Vincent st, $25,000) has no rental unit and no capitalized
//   events, so it is a non-rental deal record, not a rental investment.
//
// PROFIT (brief section 3.1): operating profit only — eligible rental income
// minus eligible operating expenses, using the SAME safe-source allowlist as
// buildRentalFinancialPerformance (reused, not re-implemented). Expenses must
// additionally have affects_noi = true and capitalized = false. Capitalized
// events are never operating expenses. Property tax
// (property_tax / taxes_property_tax) is a SUBSET of operating expenses, never
// an additional expense.
//
// WINDOWS (brief section 3.2): month-to-date, calendar year-to-date, and
// all-time since 2014-01-01 (the existing portfolio-history floor — pre-2014
// rows were investigated as stray pre-acquisition entries). Event dates are
// compared as ISO strings, never parsed through Date constructors, so the
// windows are timezone-safe. The reference date is passed in (the Summary
// page's single `today`) so server and browser cannot cross a month/year
// boundary mid-render.
//
// All sums are integer cents (toCents, the established absolute-dollar
// convention). Nothing here fetches, mutates, or trusts a client-supplied
// owner/property scope.
import { canonicalPropertySlug } from "@/domains/property/propertyAliases";
import {
  EARLIEST_PORTFOLIO_YEAR,
  isSafeRentalEvent,
  toCents,
} from "./buildRentalFinancialPerformance";

export const PROPERTY_TAX_CATEGORIES = Object.freeze(["property_tax", "taxes_property_tax"]);
export const ALL_TIME_START_DATE = `${EARLIEST_PORTFOLIO_YEAR}-01-01`;

// Sources whose capitalized rows count toward recorded cash invested: the
// operating safe sources plus the setup writer itself. Deliberately excludes
// bank-feed ("transaction") and QuickBooks rows, whose portfolio attribution
// is not guaranteed — the same conservative stance as operating profit.
const INVESTMENT_SOURCES = new Set([
  "rentec",
  "rentec_api",
  "manual",
  "forge_rental_payment_adjustment",
  "property_financial_setup",
]);

// Normalized categories of the two setup-written echo events (see the header
// comment). Within source_system 'property_financial_setup' the RPC writes
// exactly these two plus renovation lines ('capital_improvement' /
// 'repairs_maintenance'), so this pair identifies the echoes exactly.
const SETUP_ECHO_CATEGORIES = new Set(["real_estate_purchase", "closing_costs"]);

function displayCategory(category) {
  return String(category || "uncategorized")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function emptyPeriod() {
  return {
    incomeCents: 0,
    operatingExpensesCents: 0,
    profitCents: 0,
    propertyTaxCents: 0,
    capitalImprovementsCents: 0,
  };
}

function emptyPropertyAccumulator({ propertyId, unitId, label }) {
  return {
    propertyId,
    unitId,
    label,
    hasSetup: false,
    setupCashCents: 0,
    // Per-period aggregates, keyed by period name.
    periods: { monthToDate: emptyPeriod(), yearToDate: emptyPeriod(), allTime: emptyPeriod() },
    // Cumulative capital improvements (all dates, no 2014 floor) — the
    // capitalized-events component of recorded cash invested.
    capitalImprovementsCents: 0,
    // Per-period operating-expense category maps (category -> cents).
    expenseCategories: { monthToDate: new Map(), yearToDate: new Map(), allTime: new Map() },
    capitalCategories: { monthToDate: new Map(), yearToDate: new Map(), allTime: new Map() },
    eventCount: 0,
  };
}

function isOperatingExpense(event) {
  return (
    isSafeRentalEvent(event)
    && event.transaction_kind === "expense"
    && event.affects_noi === true
    && event.capitalized !== true
  );
}

function isCapitalImprovement(event) {
  if (!event || event.status === "inactive" || event.status === "deleted" || event.is_deleted === true) return false;
  if (!event.event_date) return false;
  if (event.business_scope === "personal") return false;
  if (event.capitalized !== true) return false;
  if (event.transaction_kind !== "expense" && event.transaction_kind !== "asset_purchase") return false;
  return INVESTMENT_SOURCES.has(event.source_system);
}

function isSetupEchoEvent(event) {
  return event.source_system === "property_financial_setup" && SETUP_ECHO_CATEGORIES.has(event.normalized_category);
}

function isPropertyTaxEvent(event) {
  return isOperatingExpense(event) && PROPERTY_TAX_CATEGORIES.includes(event.normalized_category);
}

function sortedCategories(map) {
  return [...map.entries()]
    .map(([category, cents]) => Object.freeze({ category, label: displayCategory(category), cents }))
    .sort((a, b) => b.cents - a.cents || a.label.localeCompare(b.label));
}

function freezePeriod(period) {
  return Object.freeze({
    incomeCents: period.incomeCents,
    operatingExpensesCents: period.operatingExpensesCents,
    profitCents: period.incomeCents - period.operatingExpensesCents,
    propertyTaxCents: period.propertyTaxCents,
    capitalImprovementsCents: period.capitalImprovementsCents,
  });
}

function freezeAccumulator(accumulator) {
  const monthToDate = freezePeriod(accumulator.periods.monthToDate);
  const yearToDate = freezePeriod(accumulator.periods.yearToDate);
  const allTime = freezePeriod(accumulator.periods.allTime);
  return Object.freeze({
    propertyId: accumulator.propertyId,
    unitId: accumulator.unitId,
    label: accumulator.label,
    hasSetup: accumulator.hasSetup,
    setupIncomplete: !accumulator.hasSetup,
    monthToDate,
    yearToDate,
    allTime,
    // Recorded cash invested = setup cash (down payment + closing costs)
    // plus cumulative capital improvements. The setup echo events are
    // excluded from capitalImprovementsCents, so this never double-counts.
    investmentCents: accumulator.setupCashCents + accumulator.capitalImprovementsCents,
    setupCashCents: accumulator.setupCashCents,
    capitalImprovementsCents: accumulator.capitalImprovementsCents,
    expenseCategories: Object.freeze({
      monthToDate: Object.freeze(sortedCategories(accumulator.expenseCategories.monthToDate)),
      yearToDate: Object.freeze(sortedCategories(accumulator.expenseCategories.yearToDate)),
      allTime: Object.freeze(sortedCategories(accumulator.expenseCategories.allTime)),
    }),
    capitalCategories: Object.freeze({
      monthToDate: Object.freeze(sortedCategories(accumulator.capitalCategories.monthToDate)),
      yearToDate: Object.freeze(sortedCategories(accumulator.capitalCategories.yearToDate)),
      allTime: Object.freeze(sortedCategories(accumulator.capitalCategories.allTime)),
    }),
    eventCount: accumulator.eventCount,
  });
}

function sumPeriods(accumulators) {
  const total = { monthToDate: emptyPeriod(), yearToDate: emptyPeriod(), allTime: emptyPeriod() };
  for (const accumulator of accumulators) {
    for (const key of ["monthToDate", "yearToDate", "allTime"]) {
      total[key].incomeCents += accumulator.periods[key].incomeCents;
      total[key].operatingExpensesCents += accumulator.periods[key].operatingExpensesCents;
      total[key].propertyTaxCents += accumulator.periods[key].propertyTaxCents;
      total[key].capitalImprovementsCents += accumulator.periods[key].capitalImprovementsCents;
    }
  }
  return Object.freeze({
    monthToDate: freezePeriod(total.monthToDate),
    yearToDate: freezePeriod(total.yearToDate),
    allTime: freezePeriod(total.allTime),
  });
}

// Builds the per-property performance read model. Returns null when the
// event projection is stale (rows carry no property_id field at all — the
// pre-change /api/rental shape), so the caller shows an explicit unavailable
// state instead of dumping every event into the unmatched bucket.
export function buildRentalPropertyPerformance({
  units = [],
  financialEvents = [],
  propertyFinancialSetups = [],
  today = new Date().toISOString().slice(0, 10),
} = {}) {
  const events = Array.isArray(financialEvents) ? financialEvents : [];
  // Stale-projection guard: the pre-change payload selected no property_id,
  // so every row lacks the field entirely. Attributing those rows would be
  // fabrication; the caller renders "unavailable" until the payload
  // revalidates with the extended projection.
  if (events.length > 0 && events.every((event) => event.property_id === undefined)) return null;

  const referenceDate = String(today || "").slice(0, 10);
  const monthStart = `${referenceDate.slice(0, 7)}-01`;
  const yearStart = `${referenceDate.slice(0, 4)}-01-01`;

  // Canonical property inventory: one accumulator per unit, keyed by the
  // canonical slug. Units are the inventory — a unit with zero events still
  // gets a row (with $0 figures), and a vacant unit is not dropped.
  const unitByCanonicalSlug = new Map();
  const propertyAccumulators = new Map();
  for (const unit of Array.isArray(units) ? units : []) {
    if (!unit || !unit.property_id) continue;
    const canonical = canonicalPropertySlug(unit.property_id);
    if (!unitByCanonicalSlug.has(canonical)) unitByCanonicalSlug.set(canonical, unit);
    if (!propertyAccumulators.has(canonical)) {
      propertyAccumulators.set(canonical, emptyPropertyAccumulator({
        propertyId: canonical,
        unitId: unit.id || null,
        label: unit.label || canonical,
      }));
    }
  }

  // Setup cash, matched by canonical slug (the setup row's property_id is the
  // unit's property_id by the RPC's own validation). Unknown setup values are
  // never treated as $0 — a property with no setup row keeps hasSetup false
  // and the UI shows "Setup incomplete".
  for (const setup of Array.isArray(propertyFinancialSetups) ? propertyFinancialSetups : []) {
    if (!setup || !setup.property_id) continue;
    const accumulator = propertyAccumulators.get(canonicalPropertySlug(setup.property_id));
    if (!accumulator) continue;
    const downPayment = Number(setup.down_payment_cents) || 0;
    const closingCosts = Number(setup.closing_costs_cents) || 0;
    accumulator.hasSetup = true;
    accumulator.setupCashCents += downPayment + closingCosts;
  }

  const unassigned = emptyPropertyAccumulator({ propertyId: null, unitId: null, label: "Unassigned / unmatched" });
  const unmatchedSlugs = new Set();
  const pre2014 = {
    eventCount: 0,
    incomeCents: 0,
    operatingExpensesCents: 0,
    propertyTaxCents: 0,
    capitalImprovementsCents: 0,
  };
  let ineligibleEventCount = 0;
  // Setup echo events are skipped by design (their figures live on the setup
  // row), so they are counted separately from genuinely ineligible rows.
  let setupEchoEventCount = 0;

  // Single pass: classify each event once, then add it to every period it
  // belongs to. No per-property scans, no re-reads of the raw list.
  for (const event of events) {
    if (!event || !event.event_date) {
      ineligibleEventCount += 1;
      continue;
    }
    const eventDate = String(event.event_date);
    const cents = toCents(event.amount);
    const isIncome = isSafeRentalEvent(event) && event.transaction_kind === "income";
    const isExpense = isOperatingExpense(event);
    const isTax = isIncome ? false : isPropertyTaxEvent(event);
    const isEcho = isSetupEchoEvent(event);
    const isCapital = isCapitalImprovement(event) && !isEcho;
    if (!isIncome && !isExpense && !isCapital) {
      if (isEcho) setupEchoEventCount += 1;
      else ineligibleEventCount += 1;
      continue;
    }

    const rawSlug = event.property_id || null;
    const canonical = rawSlug ? canonicalPropertySlug(rawSlug) : null;
    const accumulator = canonical && propertyAccumulators.get(canonical)
      ? propertyAccumulators.get(canonical)
      : unassigned;
    if (accumulator === unassigned && rawSlug) unmatchedSlugs.add(rawSlug);
    accumulator.eventCount += 1;

    const inMonth = eventDate >= monthStart && eventDate <= referenceDate;
    const inYear = eventDate >= yearStart && eventDate <= referenceDate;
    const inAllTime = eventDate >= ALL_TIME_START_DATE && eventDate <= referenceDate;
    const isPre2014 = eventDate < ALL_TIME_START_DATE;

    // Pre-2014 eligible activity is tracked as a diagnostic only — it never
    // enters the headline all-time totals.
    if (isPre2014) {
      pre2014.eventCount += 1;
      if (isIncome) pre2014.incomeCents += cents;
      if (isExpense) pre2014.operatingExpensesCents += cents;
      if (isTax) pre2014.propertyTaxCents += cents;
      if (isCapital) pre2014.capitalImprovementsCents += cents;
    }

    if (isCapital) {
      // Capital improvements are cumulative (all dates) for the investment
      // total, and windowed for the per-period detail.
      accumulator.capitalImprovementsCents += cents;
      const category = event.normalized_category || "uncategorized";
      if (inMonth) {
        accumulator.periods.monthToDate.capitalImprovementsCents += cents;
        accumulator.capitalCategories.monthToDate.set(
          category, (accumulator.capitalCategories.monthToDate.get(category) || 0) + cents,
        );
      }
      if (inYear) {
        accumulator.periods.yearToDate.capitalImprovementsCents += cents;
        accumulator.capitalCategories.yearToDate.set(
          category, (accumulator.capitalCategories.yearToDate.get(category) || 0) + cents,
        );
      }
      if (inAllTime) {
        accumulator.periods.allTime.capitalImprovementsCents += cents;
        accumulator.capitalCategories.allTime.set(
          category, (accumulator.capitalCategories.allTime.get(category) || 0) + cents,
        );
      }
    }

    if (isIncome || isExpense) {
      const periods = [];
      if (inMonth) periods.push("monthToDate");
      if (inYear) periods.push("yearToDate");
      if (inAllTime) periods.push("allTime");
      for (const key of periods) {
        const period = accumulator.periods[key];
        if (isIncome) period.incomeCents += cents;
        if (isExpense) {
          period.operatingExpensesCents += cents;
          const category = event.normalized_category || "uncategorized";
          const map = accumulator.expenseCategories[key];
          map.set(category, (map.get(category) || 0) + cents);
        }
        if (isTax) period.propertyTaxCents += cents;
      }
    }
  }

  const properties = [...propertyAccumulators.values()]
    .map((accumulator) => freezeAccumulator(accumulator))
    .sort((a, b) => a.label.localeCompare(b.label, "en-US"));
  const frozenUnassigned = freezeAccumulator(unassigned);
  const houseAccumulators = [...propertyAccumulators.values()];
  const portfolioTotals = sumPeriods(houseAccumulators);
  const portfolioInvestmentCents = houseAccumulators.reduce(
    (sum, accumulator) => sum + accumulator.setupCashCents + accumulator.capitalImprovementsCents, 0,
  );

  return Object.freeze({
    referenceDate,
    allTimeStart: ALL_TIME_START_DATE,
    properties: Object.freeze(properties),
    portfolioTotals: Object.freeze({
      ...portfolioTotals,
      investmentCents: portfolioInvestmentCents,
    }),
    unassigned: Object.freeze({
      ...frozenUnassigned,
      unmatchedSlugs: Object.freeze([...unmatchedSlugs].sort((a, b) => a.localeCompare(b, "en-US"))),
    }),
    pre2014: Object.freeze({
      ...pre2014,
      profitCents: pre2014.incomeCents - pre2014.operatingExpensesCents,
    }),
    diagnostics: Object.freeze({ ineligibleEventCount, setupEchoEventCount }),
  });
}
