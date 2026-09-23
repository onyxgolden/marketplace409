// Tenant payment ledger — pure read model for the tenant card "Payment History" slice.
//
// Sources (authoritative only; no new tables, no copies):
//   rent_charges                       charges/fees/credits owed by the tenant's leases
//   rental_payments                    cash/check/Stripe/offline payments (tenant-scoped)
//   rental_settlements                 attached as evidence on their payment, never extra rows
//   rentec_transaction_imports         attached via charge_id/payment_id links, never new rows;
//                                      applied rows linked only to this tenant's lease land in
//                                      `unassigned`; rows linked elsewhere are ignored here —
//                                      the tenant is never guessed from rentec_renter_id
//   rental_security_deposits +         a dedicated Deposits section — deposits are never
//     rental_security_deposit_transactions  labeled as rent and never mixed into the ledger
//
// Deliberately NOT read: financial_events. The ledger stays structurally incapable of
// showing a Stripe payment twice (once from rental_payments, once from the accounting
// feed), which is the duplicate class the spec calls out.
//
// Running balance: chronological, starting at 0 before the oldest entry. Charges, fees,
// and refunds increase the balance owed; payments and credits decrease it. The balance is
// the ledger-period balance, not a lifetime account balance.

const CHARGE_LABELS = {
  rent: "Rent charge",
  proration: "Prorated rent",
  late_fee: "Late fee",
};

// Payment statuses with a direct balance effect: money the tenant actually paid in.
// Failed/cancelled/processing/etc. payments stay visible in the ledger with their
// status, but contribute nothing to the balance.
function paymentHasBalanceEffect(payment) {
  return ["succeeded", "paid", "settled"].includes(payment.status);
}
// A partially/fully refunded payment is a completed payment whose returned portion is
// modeled as a separate compensating refund entry — the payment entry keeps its
// balance effect so the two net to amount − refunded and the tenant is never
// double-charged. The refund entry itself is added below.
const REFUNDED_PAYMENT_STATUSES = new Set(["partially_refunded", "refunded"]);
const FINALITY_RANK = {
  succeeded: 6, partially_refunded: 5, refunded: 4, disputed: 3,
  processing: 2, created: 1, requires_action: 1, requires_payment_method: 1,
  failed: 0, cancelled: 0,
};

const signedCents = (value) => {
  const cents = Number(value);
  return Number.isSafeInteger(cents) ? cents : 0;
};

function entryDate(entry) {
  return entry.date || "0000-00-00";
}

function sortChronological(entries) {
  return [...entries].sort((a, b) => {
    const byDate = entryDate(a).localeCompare(entryDate(b));
    if (byDate !== 0) return byDate;
    return String(a.id).localeCompare(String(b.id));
  });
}

function unitContext(unit) {
  if (!unit) return { propertyLabel: "Unknown property", unitLabel: "Unknown unit" };
  return {
    propertyLabel: unit.property_id || "Unknown property",
    unitLabel: unit.label || unit.id || "Unknown unit",
  };
}

export function buildTenantPaymentLedger({
  tenantId,
  charges = [],
  payments = [],
  settlements = [],
  leases = [],
  leaseMemberships = [],
  units = [],
  rentecImports = [],
} = {}) {
  const unitById = new Map(units.map((unit) => [unit.id, unit]));
  const leaseById = new Map(leases.map((lease) => [lease.id, lease]));
  const tenantLeaseIds = new Set(
    leaseMemberships.filter((m) => m.tenant_id === tenantId).map((m) => m.lease_id),
  );
  const settlementByPaymentId = new Map(settlements.map((s) => [s.payment_id, s]));

  // --- Charges: every lease this tenant was ever a member of (moved-out tenants keep
  // their history; unit changes keep each entry's original property/unit context).
  const chargeEntries = [];
  const chargeById = new Map();
  for (const charge of charges) {
    if (!tenantLeaseIds.has(charge.lease_id)) continue;
    const lease = leaseById.get(charge.lease_id) || null;
    const context = unitContext(lease ? unitById.get(lease.unit_id) : null);
    const entry = {
      id: `charge:${charge.id}`,
      sourceId: charge.id,
      kind: "charge",
      date: charge.due_date || null,
      amountCents: signedCents(charge.amount_cents),
      balanceEffectCents: signedCents(charge.amount_cents),
      label: CHARGE_LABELS[charge.charge_type] || `Charge (${String(charge.charge_type || "rent").replaceAll("_", " ")})`,
      status: charge.status || "unknown",
      method: null,
      period: charge.period || null,
      leaseId: charge.lease_id,
      propertyLabel: context.propertyLabel,
      unitLabel: context.unitLabel,
      reference: charge.id,
      rentecEvidence: [],
    };
    chargeEntries.push(entry);
    chargeById.set(charge.id, entry);
  }

  // --- Payments: tenant-scoped only. Duplicate provider rows (same provider_payment_id)
  // display once — the most final record wins.
  const paymentByProviderKey = new Map();
  for (const payment of payments) {
    if (payment.tenant_id !== tenantId) continue;
    const key = payment.provider && payment.provider_payment_id
      ? `${payment.provider}:${payment.provider_payment_id}`
      : `row:${payment.id}`;
    const rank = FINALITY_RANK[payment.status] ?? 0;
    const existing = paymentByProviderKey.get(key);
    if (!existing || rank > existing.rank || (rank === existing.rank && String(payment.created_at || "") > String(existing.payment.created_at || ""))) {
      paymentByProviderKey.set(key, { payment, rank });
    }
  }
  const paymentEntries = [];
  const paymentById = new Map();
  for (const { payment } of paymentByProviderKey.values()) {
    const lease = leaseById.get(payment.lease_id) || null;
    const context = unitContext(lease ? unitById.get(lease.unit_id) : null);
    const status = payment.status || "unknown";
    const amountCents = signedCents(payment.amount_cents);
    const refundedCents = signedCents(payment.refunded_amount_cents);
    const movedMoney = paymentHasBalanceEffect(payment) || REFUNDED_PAYMENT_STATUSES.has(status);
    const settlement = settlementByPaymentId.get(payment.id) || null;
    const entry = {
      id: `payment:${payment.id}`,
      sourceId: payment.id,
      kind: "payment",
      date: payment.received_at || payment.succeeded_at || payment.created_at || null,
      amountCents,
      // A payment reduces what the tenant owes; a failed/cancelled one moves nothing.
      balanceEffectCents: movedMoney ? -amountCents : 0,
      label: "Payment",
      status,
      method: payment.payment_method || payment.provider || null,
      period: null,
      leaseId: payment.lease_id,
      chargeId: payment.charge_id,
      propertyLabel: context.propertyLabel,
      unitLabel: context.unitLabel,
      reference: payment.receipt_reference || payment.provider_payment_id || payment.id,
      refundedAmountCents: refundedCents,
      // Carried for the transaction-detail view (memo line). Additive only.
      notes: payment.notes || null,
      settlement: settlement ? {
        status: settlement.status,
        netAmountCents: signedCents(settlement.net_amount_cents),
        providerPayoutId: settlement.provider_payout_id || null,
      } : null,
      rentecEvidence: [],
    };
    paymentEntries.push(entry);
    paymentById.set(payment.id, entry);

    // Refunds are compensating entries linked to their payment — never a duplicate payment.
    if (refundedCents > 0) {
      const refundStatus = status === "refunded" ? "refunded" : "partially_refunded";
      paymentEntries.push({
        id: `refund:${payment.id}`,
        sourceId: payment.id,
        kind: "refund",
        date: payment.received_at || payment.succeeded_at || payment.created_at || null,
        amountCents: refundedCents,
        balanceEffectCents: refundedCents,
        label: refundStatus === "refunded" ? "Refund (full)" : "Refund (partial)",
        status: refundStatus,
        method: payment.payment_method || payment.provider || null,
        period: null,
        leaseId: payment.lease_id,
        chargeId: payment.charge_id,
        propertyLabel: context.propertyLabel,
        unitLabel: context.unitLabel,
        reference: `refund of ${payment.provider_payment_id || payment.id}`,
        refundedAmountCents: 0,
        settlement: null,
        rentecEvidence: [],
        refundOfPaymentId: payment.id,
      });
    }
  }

  // --- Rentec imports: applied rows link onto this tenant's charge/payment entries as
  // evidence. A row linked to another tenant's charge/payment is ignored here — it
  // surfaces on that tenant's own ledger, never redundantly on every ledger. A row
  // with no charge/payment link but a lease_id on one of this tenant's leases is
  // surfaced unassigned (plausibly this tenant's, needs review — never guessed from
  // rentec_renter_id). Property/workspace-level rows belong to the property expense
  // ledger or the import review queue, not to a tenant ledger.
  const unassigned = [];
  let rejectedCount = 0;
  for (const row of rentecImports) {
    if (row.status === "rejected") { rejectedCount += 1; continue; }
    if (row.status !== "applied") continue;
    const evidence = {
      rentecTransactionId: row.rentec_transaction_id,
      category: row.category_name || null,
      amountCents: signedCents(row.amount_cents),
      transactionDate: row.transaction_date || null,
    };
    const chargeEntry = row.charge_id ? chargeById.get(row.charge_id) : null;
    const paymentEntry = row.payment_id ? paymentById.get(row.payment_id) : null;
    if (chargeEntry) chargeEntry.rentecEvidence.push(evidence);
    else if (paymentEntry) paymentEntry.rentecEvidence.push(evidence);
    else if (row.lease_id && tenantLeaseIds.has(row.lease_id)) {
      unassigned.push({
        id: `rentec:${row.id}`,
        rentecTransactionId: row.rentec_transaction_id,
        amountCents: signedCents(row.amount_cents),
        transactionDate: row.transaction_date || null,
        category: row.category_name || null,
        leaseId: row.lease_id || null,
        reason: "Applied Rentec import linked to this tenant's lease but not to a charge or payment — needs review, not guessed onto the ledger.",
      });
    }
    // Otherwise: linked elsewhere or unlinked entirely — not this tenant's ledger.
  }

  // --- Chronological ledger with running balance.
  const entries = sortChronological([...chargeEntries, ...paymentEntries]);
  let runningCents = 0;
  for (const entry of entries) {
    runningCents += entry.balanceEffectCents;
    entry.balanceAfterCents = runningCents;
  }

  const paymentOnly = entries.filter((entry) => entry.kind === "payment");
  const last3 = paymentOnly.slice(-3).reverse();

  const totals = entries.reduce((sum, entry) => {
    if (entry.kind === "charge") sum.chargedCents += entry.amountCents;
    if (entry.kind === "payment") sum.paidCents += (paymentHasBalanceEffect(entry) || REFUNDED_PAYMENT_STATUSES.has(entry.status) ? entry.amountCents : 0);
    if (entry.kind === "refund") sum.refundedCents += entry.amountCents;
    return sum;
  }, { chargedCents: 0, paidCents: 0, refundedCents: 0 });

  return Object.freeze({
    tenantId,
    entries: Object.freeze(entries),
    last3: Object.freeze(last3),
    unassigned: Object.freeze(unassigned),
    rejectedRentecCount: rejectedCount,
    totals: Object.freeze(totals),
    balanceCents: runningCents,
  });
}

// Deposits live in their own section: a security deposit is never rent. Same chronological
// running-balance discipline, scoped to this tenant's deposits only.
export function buildTenantDepositHistory({ tenantId, deposits = [], depositTransactions = [] } = {}) {
  const depositById = new Map(deposits.map((d) => [d.id, d]));
  const rows = depositTransactions
    .filter((txn) => {
      const deposit = depositById.get(txn.deposit_id);
      return deposit && deposit.tenant_id === tenantId;
    })
    .map((txn) => {
      const deposit = depositById.get(txn.deposit_id);
      const amountCents = signedCents(txn.amount_cents);
      const type = txn.transaction_type;
      // Deposit balance from the landlord's custody view: received/adjustment_increase raise
      // what is held; deductions/refunds/adjustment_decrease lower it.
      const effect = type === "received" || type === "adjustment_increase" ? amountCents : -amountCents;
      const label = {
        received: "Deposit received",
        deduction: "Deposit deduction",
        refunded: "Deposit refunded",
        adjustment_increase: "Deposit adjustment (increase)",
        adjustment_decrease: "Deposit adjustment (decrease)",
      }[type] || `Deposit ${String(type || "").replaceAll("_", " ")}`;
      return {
        id: `deposit-txn:${txn.id}`,
        sourceId: txn.id,
        depositId: txn.deposit_id,
        leaseId: deposit.lease_id,
        date: txn.occurred_at || null,
        amountCents,
        balanceEffectCents: effect,
        label,
        status: "recorded",
        description: txn.description || null,
      };
    });
  const entries = sortChronological(rows);
  let heldCents = 0;
  for (const entry of entries) {
    heldCents += entry.balanceEffectCents;
    entry.balanceAfterCents = heldCents;
  }
  const requiredCents = deposits
    .filter((d) => d.tenant_id === tenantId)
    .reduce((sum, d) => sum + signedCents(d.required_amount_cents), 0);
  return Object.freeze({
    tenantId,
    entries: Object.freeze(entries),
    heldCents,
    requiredCents,
  });
}
