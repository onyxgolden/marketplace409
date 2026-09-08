import type Stripe from "stripe";

// Aliased directly to the real installed SDK type (Transactions.d.ts: `type Status = 'pending' |
// 'posted' | 'void' | OtherString`, where OtherString is Stripe's own forward-compatibility
// escape hatch for values it may add later) rather than a hand-narrowed `"posted"|"pending"|"void"`
// literal union -- a hand-narrowed union does not structurally accept the real field's type (it
// fails to compile against a live `Stripe.FinancialConnections.Transaction`) and would also break
// silently the day Stripe adds a new status. A transaction can move pending->posted, or
// posted->void, always addressed by the SAME stable transaction id. See
// stripe-financial-connections-transaction.mapper.ts for exactly how a status change is persisted
// -- financial_events is a MUTABLE PROJECTION keyed by stable source record id (upserted on
// (owner_id, source_system, source_record_id), not an append-only ledger; see
// SupabaseFinancialEventRepository.saveMany and the correction report item 8 for the full trace),
// so a status change updates the existing row in place rather than creating a new one.
export type StripeFinancialConnectionsTransactionStatus = Stripe.FinancialConnections.Transaction.Status;

export type StripeFinancialConnectionsTransaction = Readonly<{
  transactionId: string;
  accountId: string;
  // Stripe's own signed integer, smallest currency unit (Transactions.d.ts: "The amount of this
  // transaction, in cents (or local equivalent)."). UNVERIFIED sign convention -- Stripe's
  // installed SDK types and live public API reference/guide pages do not state whether positive
  // means a credit (inflow) or a debit (outflow); the two official doc pages this adapter's
  // author checked show the SAME illustrative "Rocket Rides" purchase example with opposite signs
  // (+300 on the API reference page, -1000 on the transactions guide page), which is not
  // authoritative either way. See the mapper for the negation currently applied and the
  // correction report for why this remains an open, live/test-mode-validation-required gate, not
  // a verified fact.
  amount: number;
  currency: string;
  description: string;
  status: StripeFinancialConnectionsTransactionStatus;
  transactedAt: string; // ISO date, Stripe's transacted_at
  statusTransitionedAt: string | null; // Stripe's status_transitions.posted_at or .void_at, whichever applies
  // The id of the transaction_refresh that most recently created or updated this transaction
  // (Transactions.d.ts: transaction.transaction_refresh) -- distinct from the transactionId
  // itself. Used as the incremental-sync watermark once a full page of transactions for one
  // refresh has been successfully persisted; see the provider and webhook route.
  transactionRefreshId: string;
}>;
