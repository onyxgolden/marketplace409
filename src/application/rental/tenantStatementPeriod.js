// Tenant statement period slice — pure read model for Rentec parity R14.
//
// Takes the chronological entries from buildTenantPaymentLedger (which carry
// balanceAfterCents computed from a zero opening) and re-slices them into one
// statement period: the opening balance, the in-period entries with their
// running balances rebased from that opening, and the closing balance. It is
// the same data the owner sees in the tenant ledger — just the monthly window
// a tenant selects in the portal.
const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

function pad2(value) {
  return String(value).padStart(2, "0");
}

function firstOfNextMonth(year, month) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function monthRange(year, month) {
  const next = firstOfNextMonth(year, month);
  const end = new Date(year, month, 0); // last day of the month
  return Object.freeze({
    year,
    month,
    start: `${year}-${pad2(month)}-01`,
    end: `${end.getFullYear()}-${pad2(end.getMonth() + 1)}-${pad2(end.getDate())}`,
    endExclusive: `${next.year}-${pad2(next.month)}-01`,
    label: new Date(year, month - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" }),
  });
}

// Normalizes the portal's period selector value. Defaults to the current
// month; throws on anything that is not YYYY-MM.
export function normalizeStatementPeriod(value, now = new Date()) {
  if (value === undefined || value === null || value === "") {
    return monthRange(now.getFullYear(), now.getMonth() + 1);
  }
  const match = PERIOD_RE.exec(String(value).trim());
  if (!match) throw new Error("period must be YYYY-MM.");
  return monthRange(Number(match[1]), Number(match[2]));
}

function entryDateValue(entry) {
  return entry.date || "0000-00-00";
}

// Debit/credit split for the statement table: charges, fees and refunds
// increase what the tenant owes (debit); payments decrease it (credit).
// Overpayment credits and their applications are balance-neutral memo rows —
// the money already moved in the payment that created the credit.
function debitCreditSplit(entry) {
  if (entry.kind === "charge" || entry.kind === "refund") {
    return { debitCents: entry.amountCents, creditCents: 0 };
  }
  if (entry.kind === "payment") return { debitCents: 0, creditCents: entry.amountCents };
  return { debitCents: 0, creditCents: 0 };
}

function sortChronological(entries) {
  return [...entries].sort((a, b) => {
    const byDate = entryDateValue(a).localeCompare(entryDateValue(b));
    if (byDate !== 0) return byDate;
    return String(a.id).localeCompare(String(b.id));
  });
}

const asCents = (value) => (Number.isSafeInteger(Number(value)) ? Number(value) : 0);

export function buildTenantStatementPeriod({ entries = [], periodStart, periodEndExclusive } = {}) {
  if (!periodStart || !periodEndExclusive) throw new Error("periodStart and periodEndExclusive are required.");
  const rows = sortChronological(Array.isArray(entries) ? entries : []);
  // Opening balance: the ledger balance immediately before the period starts.
  // Entries carry balanceAfterCents from the zero-opening ledger, so the last
  // entry dated before the period defines it (0 when there are none).
  let openingBalanceCents = 0;
  const inPeriod = [];
  for (const entry of rows) {
    const entryDate = entryDateValue(entry);
    if (entryDate < periodStart) openingBalanceCents = asCents(entry.balanceAfterCents);
    else if (entryDate < periodEndExclusive) inPeriod.push(entry);
  }
  let runningCents = openingBalanceCents;
  const lines = inPeriod.map((entry) => {
    runningCents += asCents(entry.balanceEffectCents);
    return Object.freeze({ ...entry, ...debitCreditSplit(entry), balanceAfterCents: runningCents });
  });
  const totals = lines.reduce((sum, line) => {
    if (line.kind === "charge") sum.chargedCents += asCents(line.amountCents);
    if (line.kind === "payment" && asCents(line.balanceEffectCents) !== 0) sum.paidCents += asCents(line.amountCents);
    if (line.kind === "refund") sum.refundedCents += asCents(line.amountCents);
    return sum;
  }, { chargedCents: 0, paidCents: 0, refundedCents: 0 });
  return Object.freeze({
    openingBalanceCents,
    entries: Object.freeze(lines),
    closingBalanceCents: runningCents,
    totals: Object.freeze(totals),
  });
}
