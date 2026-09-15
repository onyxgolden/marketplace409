// Allowlist the owner read model; no provider identifiers or receipt payloads enter guest UI.
export function reservationFinanceReadModel(row) {
  if (!row) return null;
  return Object.freeze({
    bookingBalanceCents: row.booking_balance_cents,
    bookingAppliedCents: row.booking_applied_cents,
    bookingAmountDueCents: row.booking_amount_due_cents,
    bookingPaymentStatus: row.finance_payment_status ?? row.booking_payment_status,
    securityDepositCents: row.security_deposit_cents,
    securityDepositStatus: row.security_deposit_status,
    currencyCode: row.currency_code,
    bookingRefundedCents: row.finance_refunded_cents,
    reversedCents: row.reversed_cents,
    refundStatus: row.refund_status,
    disputeStatus: row.dispute_status,
    disputedCents: row.disputed_cents,
    settlementStatus: row.finance_settlement_status,
    grossCents: row.gross_cents,
    feeCents: row.fee_cents,
    netCents: row.net_cents,
    payoutStatus: row.payout_status,
    paidOutAmountCents: row.historical_paid_out_cents,
    reconciliationStatus: row.reconciliation_status,
  });
}
