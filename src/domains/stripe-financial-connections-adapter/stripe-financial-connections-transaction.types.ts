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
  // transaction, in cents (or local equivalent)."). Sign convention VERIFIED live (not from
  // documentation, which was self-contradictory across two official pages for this exact field --
  // see the mapper's own comment): positive = inflow/credit (money owed TO the account holder,
  // matching Account.Balance's documented convention), negative = outflow/debit. Confirmed against
  // a real Stripe test-mode Financial Connections session -- e.g. a real "Rocket Rides" (ride-hail
  // purchase, an unambiguous real-world expense) transaction had raw amount -1000, consistent
  // across all 275 real transactions sampled. See the mapper for the negation this requires to
  // match Plaid's opposite convention.
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
