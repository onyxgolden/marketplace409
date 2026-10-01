// Reconciliation assist — deterministic matching of receipts/unpaid bills to
// bank-side ledger rows. Rentec parity R26 (free layer).
//
// "Bank transactions" here are financial_events rows carrying a
// bank_account_id (the register the bank-ledger and R4 payments post to).
// A receipt/bill MATCHES a bank row when the amounts are equal to the cent
// and the dates fall inside a ±windowDays window. Everything that matches
// nothing is surfaced on BOTH sides: unmatched receipts, unmatched unpaid
// bills, and unmatched bank rows — so nothing silently disappears.
//
// Deterministic: no AI, no network, pure function. The routes own querying.

export const RECONCILE_DEFAULT_WINDOW_DAYS = 5;
const MS_PER_DAY = 86_400_000;

const toCents = (dollars) => Math.round(Number(dollars) * 100);

function daysBetween(a, b) {
  if (!a || !b) return null;
  const da = Date.parse(`${a}T00:00:00.000Z`);
  const db = Date.parse(`${b}T00:00:00.000Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return null;
  return Math.round(Math.abs(da - db) / MS_PER_DAY);
}

// Bank rows already accounted for by a recorded R4 vendor payment carry the
// payment id in metadata.vendor_payment_id — they are matched by
// construction and must NOT appear as "unmatched bank rows".
export function bankEventIsSettled(event) {
  return Boolean(event?.metadata && typeof event.metadata === "object" && event.metadata.vendor_payment_id);
}

function eligibleBankEvents(events) {
  return (events || []).filter(
    (event) =>
      event &&
      event.status !== "deleted" &&
      event.is_deleted !== true &&
      event.bank_account_id &&
      Number.isFinite(Number(event.amount)) &&
      !bankEventIsSettled(event)
  );
}

// Each bank row matches AT MOST one target (first eligible target in receipt-
// then-bill order wins); targets are receipts first, then unpaid bills, so an
// expense evidence row binds to the paper receipt before the payable.
export function matchReceiptsToBankEvents(
  { receipts = [], bills = [], bankEvents = [] } = {},
  { windowDays = RECONCILE_DEFAULT_WINDOW_DAYS } = {}
) {
  const events = eligibleBankEvents(bankEvents);
  const usedEventIds = new Set();
  const matches = [];

  const targets = [
    ...receipts.map((receipt) => ({
      kind: "receipt",
      id: receipt.id,
      amountCents: Number(receipt.amount_cents),
      date: receipt.receipt_date,
      label: receipt.vendor_name_hint || receipt.vendor_id || receipt.id,
    })),
    ...bills.map((bill) => ({
      kind: "bill",
      id: bill.id,
      amountCents: Number(bill.amount_cents) - Number(bill.paid_amount_cents || 0),
      date: bill.bill_date,
      label: bill.vendor_id,
    })),
  ].filter((target) => Number.isSafeInteger(target.amountCents) && target.amountCents > 0);

  for (const target of targets) {
    const event = events.find((candidate) => {
      if (usedEventIds.has(candidate.id)) return false;
      if (toCents(candidate.amount) !== target.amountCents) return false;
      const gap = daysBetween(target.date, candidate.event_date);
      return gap !== null && gap <= windowDays;
    });
    if (event) {
      usedEventIds.add(event.id);
      matches.push({
        targetKind: target.kind,
        targetId: target.id,
        bankEventId: event.id,
        amountCents: target.amountCents,
        daysApart: daysBetween(target.date, event.event_date),
      });
    }
  }

  const matchedTargetIds = new Set(matches.map((match) => `${match.targetKind}:${match.targetId}`));
  return {
    windowDays,
    matches,
    unmatchedReceipts: receipts.filter((receipt) => !matchedTargetIds.has(`receipt:${receipt.id}`)),
    unmatchedBills: bills.filter((bill) => !matchedTargetIds.has(`bill:${bill.id}`)),
    unmatchedBankEvents: events.filter((event) => !usedEventIds.has(event.id)),
  };
}
