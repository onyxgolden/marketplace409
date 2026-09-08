import {
  createTransaction,
} from "../transaction";

import type {
  Transaction,
  TransactionMapper,
} from "../transaction";

import type {
  StripeFinancialConnectionsTransaction,
} from "./stripe-financial-connections-transaction.types";

// --- Stripe-to-canonical sign mapping -- STATUS: UNVERIFIED, a live/test-mode-validation gate,
// not a confirmed fact. Documented here precisely so the open question is visible at the exact
// point it matters, not buried in a report. ---
//
// Canonical Transaction.amountCents' sign meaning is established by PlaidTransactionMapper, which
// passes Plaid's own amount through UNFLIPPED: Plaid's documented convention is positive = money
// leaving the account (an outflow/expense), negative = money entering it (an inflow/deposit).
// Because nothing else has ever normalized this field, that IS the canonical convention today.
//
// Stripe's installed SDK types (Transactions.d.ts) document Transaction.amount only as "in cents
// (or local equivalent)" -- no sign meaning stated. Checked two official Stripe doc pages for
// corroborating evidence: the API reference page's example shows `"amount": 300` for a "Rocket
// Rides" ride-hail purchase (an outflow, shown positive); the separate transactions guide page's
// example shows the SAME "Rocket Rides" purchase as `"amount": -1000` (shown negative). Two
// official pages disagree on the sign for the identical illustrative example -- proof these are
// generic placeholder JSON, not a documented rule, and neither can be trusted as evidence.
//
// This mapper currently negates Stripe's amount (assuming positive=credit/inflow, the opposite of
// Plaid), on the theory that Stripe's own convention elsewhere in its API tends to run this way --
// but this is this adapter author's best guess, not a verified fact. Do not treat this as settled.
// Before the first real production session, this needs actual validation: a Stripe test-mode
// Financial Connections session with a known real-world inflow (e.g. a payroll deposit) and a
// known real-world outflow (e.g. a card purchase), comparing their raw `amount` signs against
// what actually happened. See the correction report for this exact open item.
function toCanonicalAmountCents(stripeAmount: number): number {
  return -stripeAmount;
}

export class StripeFinancialConnectionsTransactionMapper
  implements TransactionMapper<StripeFinancialConnectionsTransaction> {
  map(
    transaction: StripeFinancialConnectionsTransaction,
    connectionId: string,
    provider: string,
    financialAccountId: string,
    providerAccountId: string,
  ): Transaction {
    const now = new Date().toISOString();

    // financial_events is a MUTABLE PROJECTION, not an immutable ledger: saveMany upserts by
    // (owner_id, source_system, source_record_id) -- see SupabaseFinancialEventRepository.js --
    // so re-importing the SAME Stripe transaction id after it posts, or after it's voided,
    // overwrites the existing row's fields in place. That is the actual, pre-existing invariant
    // this whole pipeline already has for every provider (Plaid included), not something this
    // adapter introduces -- see correction report item 8 for the full trace and why changing that
    // invariant (e.g. to a true append-only ledger with explicit reversal rows) is a larger,
    // cross-provider decision this PR does not make unilaterally.
    //
    // A void transaction is force-zeroed here (amountCents: 0) rather than left at its
    // pending/posted amount, so the overwritten row stops contributing to any total (as if it
    // never happened) while remaining present and auditable via raw.stripeStatus === "void". This
    // is "the transaction was attempted, then voided," represented as the row's current (mutable)
    // truth -- consistent with, not contradictory to, how a pending transaction already
    // overwrites itself on posting.
    const isVoid = transaction.status === "void";
    const amountCents = isVoid ? 0 : toCanonicalAmountCents(transaction.amount);

    return createTransaction({
      id: `transaction_${provider}_${transaction.transactionId}`,
      financialAccountId,
      connectionId,
      provider,
      providerTransactionId: transaction.transactionId,
      providerAccountId,
      amountCents,
      currencyCode: transaction.currency.toUpperCase(),
      date: transaction.transactedAt,
      description: transaction.description,
      merchantName: null, // Stripe Financial Connections transactions carry no merchant field
      category: [],
      pending: transaction.status === "pending",
      raw: {
        stripeStatus: transaction.status,
        statusTransitionedAt: transaction.statusTransitionedAt,
        transactionRefreshId: transaction.transactionRefreshId,
      },
      createdAt: now,
    });
  }

  mapMany(
    transactions: readonly StripeFinancialConnectionsTransaction[],
    connectionId: string,
    provider: string,
    financialAccountId: string,
    providerAccountId: string,
  ): readonly Transaction[] {
    return transactions.map((transaction) =>
      this.map(transaction, connectionId, provider, financialAccountId, providerAccountId),
    );
  }
}
