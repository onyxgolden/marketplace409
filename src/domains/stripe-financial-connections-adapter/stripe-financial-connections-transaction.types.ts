// Stripe Financial Connections Transaction.status: "posted" | "pending" | "void". A transaction
// can move posted<->pending (rare, but Stripe allows a posted transaction to later be voided) or
// pending->posted->void over its lifetime, always addressed by the SAME stable transaction id --
// see stripe-financial-connections-transaction.mapper.ts for how a status change is represented
// as a new immutable FinancialEvent rather than a mutation of history.
export type StripeFinancialConnectionsTransactionStatus = "posted" | "pending" | "void";

export type StripeFinancialConnectionsTransaction = Readonly<{
  transactionId: string;
  accountId: string;
  // Stripe's own signed integer, smallest currency unit. Positive = credit (inflow) per Stripe's
  // Financial Connections Transactions documentation -- the OPPOSITE of Plaid's convention. See
  // the mapper for the negation this adapter applies to keep the canonical field's sign meaning
  // provider-independent.
  amount: number;
  currency: string;
  description: string;
  status: StripeFinancialConnectionsTransactionStatus;
  transactedAt: string; // ISO date, Stripe's transacted_at
  statusTransitionedAt: string | null; // Stripe's status_transitions.posted_at or .void_at, whichever applies
}>;
