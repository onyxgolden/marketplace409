// Deposit state — the received-vs-deposited money distinction (Slice D).
//
// rental_payments.status describes the provider payment lifecycle (succeeded /
// failed / refunded / ...). That conflates "cash in hand" with "money in the
// bank": an offline payment was recorded as succeeded the moment the cash was
// handed over. deposit_state answers the separate, honest question — is this
// money deposited yet?
//
//   received  — collected but not yet deposited (cash in hand, check received,
//               Stripe payout still pending). Never shown as settled money.
//   deposited — the money has reached the bank / the Stripe payout landed.
//
// Sensible defaults for rows that predate the column (the migration backfills
// completed rows to 'deposited', but API rows can also arrive without the field):
// a paid-out settlement means the money reached the bank; anything else is
// treated as received so un-deposited money is never silently claimed as settled.

export const DEPOSIT_STATE_RECEIVED = "received";
export const DEPOSIT_STATE_DEPOSITED = "deposited";

export const DEPOSIT_STATE_LABELS = Object.freeze({
  [DEPOSIT_STATE_RECEIVED]: "Awaiting deposit",
  [DEPOSIT_STATE_DEPOSITED]: "Deposited",
});

// Payment statuses where money actually moved into the landlord's hands. Only
// these can carry a meaningful deposit state — a failed or still-processing
// payment has no money to deposit.
export const MONEY_MOVED_STATUSES = Object.freeze(
  new Set(["succeeded", "paid", "settled", "refunded", "partially_refunded"]),
);

export function normalizeDepositState(value) {
  return value === DEPOSIT_STATE_DEPOSITED ? DEPOSIT_STATE_DEPOSITED : DEPOSIT_STATE_RECEIVED;
}

export function resolveDepositState(payment = {}, settlement = null) {
  if (payment.deposit_state === DEPOSIT_STATE_DEPOSITED) return DEPOSIT_STATE_DEPOSITED;
  if (payment.deposit_state === DEPOSIT_STATE_RECEIVED) return DEPOSIT_STATE_RECEIVED;
  // Pre-migration rows: a paid-out settlement is the only evidence the money
  // reached the bank. Default to received so money is never claimed as
  // deposited without evidence.
  if (settlement && settlement.status === "paid_out") return DEPOSIT_STATE_DEPOSITED;
  return DEPOSIT_STATE_RECEIVED;
}

export function depositStateLabel(payment = {}, settlement = null) {
  return DEPOSIT_STATE_LABELS[resolveDepositState(payment, settlement)];
}

// True when the payment moved money AND that money is still awaiting deposit —
// the "collected but not cleared" queue the dashboard and ledgers must surface.
export function isAwaitingDeposit(payment = {}, settlement = null) {
  return MONEY_MOVED_STATUSES.has(payment.status)
    && resolveDepositState(payment, settlement) === DEPOSIT_STATE_RECEIVED;
}

// Net cents that moved (amount less any refunded portion), for deposit-state
// subtotals. Mirrors the ledger's netting discipline: refunds are separate
// compensating entries, so the subtotal nets them here.
export function paymentNetCents(payment = {}) {
  return Number(payment.amount_cents || 0) - Number(payment.refunded_amount_cents || 0);
}
