// Owner statements / disbursement / contributions — pure domain logic
// (Rentec-parity R9).
//
// The running balance due to an owner is:
//   income collected (financial_events, transaction_kind='income')
//   - expenses paid (financial_events, transaction_kind='expense')
//   - active owner disbursements
//   + active owner contributions
//
// Disbursements and contributions are EQUITY movements held in
// owner_cash_movements — deliberately NOT in financial_events — so a
// contribution can never appear as income on any report, and a disbursement
// can never appear as an operating expense. The Rentec "Other"-type guarantee
// is structural, not a category flag a report could forget to filter.
//
// All money math is whole cents; financial_events.amount is a decimal, so it
// is rounded deliberately to cents before it enters any sum.

const EXCLUDED_STATUSES = new Set(["inactive", "deleted"]);

const toCents = (decimalAmount) => {
  const cents = Math.round(Number(decimalAmount) * 100);
  return Number.isSafeInteger(cents) ? cents : 0;
};

const asDate = (value) => (value ? String(value).slice(0, 10) : null);

// A movement with property_id null is portfolio/workspace level: it always
// counts (an owner draw against the operating account isn't property-specific
// unless tagged). A movement tagged to a property counts only for that
// property's view.
const movementInScope = (movement, propertyId) =>
  !propertyId || !movement.property_id || movement.property_id === propertyId;

const eventInScope = (event, propertyId) =>
  !propertyId || !event.property_id || event.property_id === propertyId;

const isLiveEvent = (event) => event.is_deleted !== true && !EXCLUDED_STATUSES.has(event.status);

const isLiveMovement = (movement) => movement.status === "active";

const dateOnOrBefore = (date, asOf) => asDate(date) !== null && asDate(date) <= asOf;

const dateInPeriod = (date, start, end) => {
  const d = asDate(date);
  return d !== null && d >= start && d <= end;
};

export const emptyBalance = () =>
  Object.freeze({ incomeCents: 0, expenseCents: 0, disbursementCents: 0, contributionCents: 0, balanceCents: 0 });

// The running balance due to the owner: income - expenses - disbursements +
// contributions, optionally as of a date and scoped to one property.
export function buildOwnerBalance({ financialEvents = [], cashMovements = [], propertyId = null, asOfDate = null } = {}) {
  let incomeCents = 0;
  let expenseCents = 0;
  for (const event of financialEvents) {
    if (!isLiveEvent(event)) continue;
    if (!eventInScope(event, propertyId)) continue;
    if (asOfDate && !dateOnOrBefore(event.event_date, asOfDate)) continue;
    const cents = Math.abs(toCents(event.amount));
    if (event.transaction_kind === "income") incomeCents += cents;
    else if (event.transaction_kind === "expense") expenseCents += cents;
    // Every other kind (transfer, asset_purchase, ...) is neither income nor
    // an expense against the owner balance: transfers wash out, asset
    // purchases are balance-sheet, not operating.
  }

  let disbursementCents = 0;
  let contributionCents = 0;
  for (const movement of cashMovements) {
    if (!isLiveMovement(movement)) continue;
    if (!movementInScope(movement, propertyId)) continue;
    if (asOfDate && !dateOnOrBefore(movement.movement_date, asOfDate)) continue;
    const cents = Math.abs(toCents(movement.amount));
    if (movement.kind === "disbursement") disbursementCents += cents;
    else if (movement.kind === "contribution") contributionCents += cents;
  }

  return Object.freeze({
    incomeCents,
    expenseCents,
    disbursementCents,
    contributionCents,
    balanceCents: incomeCents - expenseCents - disbursementCents + contributionCents,
  });
}

// Gate for recording a disbursement: positive, finite, and never more than
// the available balance (an over-disbursement is a bookkeeping error, not a
// feature). Returns null when the amount is acceptable, else the reason.
export function validateNewDisbursement({ amountCents, balanceCents }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return "Enter an amount greater than zero.";
  }
  if (!Number.isSafeInteger(balanceCents)) {
    return "The current owner balance could not be determined.";
  }
  if (amountCents > balanceCents) {
    return "The disbursement exceeds the amount due to the owner.";
  }
  return null;
}

export function validateNewContribution({ amountCents }) {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    return "Enter an amount greater than zero.";
  }
  return null;
}

const toLine = (event) =>
  Object.freeze({
    id: `event:${event.id}`,
    date: asDate(event.event_date),
    description: event.description || "—",
    category: String(event.normalized_category ?? "—").replaceAll("_", " "),
    propertyId: event.property_id || null,
    amountCents: Math.abs(toCents(event.amount)),
  });

const toMovementLine = (movement) =>
  Object.freeze({
    id: `movement:${movement.id}`,
    date: asDate(movement.movement_date),
    description: movement.memo || (movement.kind === "disbursement" ? "Owner disbursement" : "Owner contribution"),
    method: movement.method || null,
    propertyId: movement.property_id || null,
    status: movement.status || "active",
    amountCents: Math.abs(toCents(movement.amount)),
  });

const byDateThenId = (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : String(a.id).localeCompare(String(b.id)));

// A printable monthly owner statement: period totals, beginning/ending
// balance due to the owner, and the running balance through the period.
export function buildOwnerStatement({ financialEvents = [], cashMovements = [], periodStart, periodEnd, propertyId = null, ownerLabel = "Owner" } = {}) {
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    throw new Error("A valid periodStart/periodEnd (YYYY-MM-DD) is required.");
  }

  const liveEvents = (financialEvents || []).filter((event) => isLiveEvent(event) && eventInScope(event, propertyId));
  const liveMovements = (cashMovements || []).filter((movement) => isLiveMovement(movement) && movementInScope(movement, propertyId));

  const beginning = buildOwnerBalance({
    financialEvents: liveEvents,
    cashMovements: liveMovements,
    propertyId,
    asOfDate: decrementDate(periodStart),
  });

  const incomeLines = liveEvents
    .filter((event) => event.transaction_kind === "income" && dateInPeriod(event.event_date, periodStart, periodEnd))
    .map(toLine)
    .sort(byDateThenId);
  const expenseLines = liveEvents
    .filter((event) => event.transaction_kind === "expense" && dateInPeriod(event.event_date, periodStart, periodEnd))
    .map(toLine)
    .sort(byDateThenId);
  const disbursementLines = liveMovements
    .filter((movement) => movement.kind === "disbursement" && dateInPeriod(movement.movement_date, periodStart, periodEnd))
    .map(toMovementLine)
    .sort(byDateThenId);
  const contributionLines = liveMovements
    .filter((movement) => movement.kind === "contribution" && dateInPeriod(movement.movement_date, periodStart, periodEnd))
    .map(toMovementLine)
    .sort(byDateThenId);

  const periodIncomeCents = incomeLines.reduce((sum, line) => sum + line.amountCents, 0);
  const periodExpenseCents = expenseLines.reduce((sum, line) => sum + line.amountCents, 0);
  const periodDisbursementCents = disbursementLines.reduce((sum, line) => sum + line.amountCents, 0);
  const periodContributionCents = contributionLines.reduce((sum, line) => sum + line.amountCents, 0);
  const endingBalanceCents =
    beginning.balanceCents + periodIncomeCents - periodExpenseCents - periodDisbursementCents + periodContributionCents;

  // Running balance through the period: each dated activity in chronological
  // order, cumulatively applied to the beginning balance.
  const datedActivity = [
    ...incomeLines.map((line) => ({ ...line, sign: 1 })),
    ...contributionLines.map((line) => ({ ...line, sign: 1 })),
    ...expenseLines.map((line) => ({ ...line, sign: -1 })),
    ...disbursementLines.map((line) => ({ ...line, sign: -1 })),
  ].sort(byDateThenId);
  const runningBalance = [];
  let running = beginning.balanceCents;
  for (const activity of datedActivity) {
    running += activity.sign * activity.amountCents;
    runningBalance.push(Object.freeze({ date: activity.date, description: activity.description, amountCents: activity.sign * activity.amountCents, balanceCents: running }));
  }

  return Object.freeze({
    ownerLabel,
    periodStart,
    periodEnd,
    propertyId: propertyId || null,
    beginningBalanceCents: beginning.balanceCents,
    incomeLines: Object.freeze(incomeLines),
    expenseLines: Object.freeze(expenseLines),
    disbursementLines: Object.freeze(disbursementLines),
    contributionLines: Object.freeze(contributionLines),
    periodIncomeCents,
    periodExpenseCents,
    periodDisbursementCents,
    periodContributionCents,
    endingBalanceCents,
    runningBalance: Object.freeze(runningBalance),
  });
}

// Decrement a YYYY-MM-DD date by one day without timezone surprises.
function decrementDate(isoDate) {
  const [year, month, day] = String(isoDate).split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}
