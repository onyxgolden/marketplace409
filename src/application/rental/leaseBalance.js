// Lease balance — the per-lease slice of the tenant ledger's running balance.
//
// DEFINITION (mirrors src/application/rental/tenantPaymentLedger.js, the
// tenant ledger's own read model — this is not a second formula):
//   balance = Σ open charges' remaining + Σ refunded amounts − Σ unapplied credits
// where:
//   - Open charges are the scheduled/due/partially_paid/overdue rent_charges for
//     the lease, each contributing (amount_cents − paid_amount_cents). Paid
//     charges net to zero with their payments, so excluding both is
//     balance-neutral. Schedule-less tenant charges (damage/fee/utility/other,
//     and proration) are included exactly like schedule-linked rent — they sit
//     on rent_charges with schedule_id NULL and count toward what is owed.
//   - Payments are NOT summed separately: the charge RPCs keep
//     paid_amount_cents in sync, so open remaining already nets every payment
//     applied to an open charge. Summing payments again would double-count.
//   - Refunds ARE added back: the Stripe refund RPC updates only the payment
//     row (refunded_amount_cents + status) and never touches the charge row,
//     so open remaining alone understates by the refunded amount. Only
//     partially_refunded/refunded payments count, deduplicated by provider key
//     with the ledger's FINALITY_RANK (most-final row wins).
//   - Credits subtract only their UNAPPLIED remainder (remaining_cents, void
//     credits excluded). Credit applications are memo-only in the ledger — the
//     payment that created the credit already moved the money, and the
//     charge's paid_amount_cents already reflects applications — so
//     applications are never summed here either.
//   - Deposits never enter: rental_security_deposits are custody money, never
//     rent, and the ledger keeps them in a dedicated section.
//
// DELIBERATE DIVERGENCE (disclosed, not an oversight): the ledger builder
// counts void charges at +amount (its charge loop has no status filter), so a
// voided charge inflates the tenant ledger's running balance. This display
// excludes void charges — a voided charge must never read as money owed.
// Every other case agrees with the ledger builder exactly (proven by the
// shared-fixture tests in RentalLeasePanel.balance.test.jsx, which run the
// same fixture through buildTenantPaymentLedger and this helper).

const OPEN_CHARGE_STATUSES = new Set(["scheduled", "due", "partially_paid", "overdue"]);

// Mirrors tenantPaymentLedger.js FINALITY_RANK (subset needed for the refund term).
const FINALITY_RANK = {
  succeeded: 6, partially_refunded: 5, refunded: 4, disputed: 3,
  processing: 2, created: 1, requires_action: 1, requires_payment_method: 1,
  failed: 0, cancelled: 0,
};

const signedCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : 0;
};

export function leaseBalanceCents(leaseId, { openCharges = [], credits = [], payments = [] } = {}) {
  if (!leaseId) return 0;
  let balance = 0;
  for (const charge of openCharges) {
    if (charge?.lease_id !== leaseId) continue;
    if (!OPEN_CHARGE_STATUSES.has(charge.status)) continue;
    balance += signedCents(charge.amount_cents) - signedCents(charge.paid_amount_cents);
  }
  // Refund term: deduplicate by provider key exactly like the ledger, so a
  // payment recorded twice (same provider_payment_id) never refunds twice.
  // Most-final row wins; on equal rank the later-created row wins — both
  // rules copied verbatim from buildTenantPaymentLedger.
  const paymentByProviderKey = new Map();
  for (const payment of payments) {
    if (payment?.lease_id !== leaseId) continue;
    const key = payment.provider && payment.provider_payment_id
      ? `${payment.provider}:${payment.provider_payment_id}`
      : `row:${payment.id}`;
    const rank = FINALITY_RANK[payment.status] ?? 0;
    const existing = paymentByProviderKey.get(key);
    if (!existing || rank > existing.rank
      || (rank === existing.rank && String(payment.created_at || "") > String(existing.payment.created_at || ""))) {
      paymentByProviderKey.set(key, { payment, rank });
    }
  }
  for (const { payment } of paymentByProviderKey.values()) {
    if (payment.status === "partially_refunded" || payment.status === "refunded") {
      balance += signedCents(payment.refunded_amount_cents);
    }
  }
  for (const credit of credits) {
    if (credit?.lease_id !== leaseId) continue;
    if (credit.status === "void") continue;
    balance -= signedCents(credit.remaining_cents);
  }
  return balance;
}
