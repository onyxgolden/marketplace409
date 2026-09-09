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

// --- Stripe-to-canonical sign mapping -- STATUS: VERIFIED against a real Stripe test-mode
// Financial Connections session (not documentation, which was previously found self-contradictory
// -- see below). ---
//
// Canonical Transaction.amountCents' sign meaning is established by PlaidTransactionMapper, which
// passes Plaid's own amount through UNFLIPPED: Plaid's documented convention is positive = money
// leaving the account (an outflow/expense), negative = money entering it (an inflow/deposit).
// Because nothing else has ever normalized this field, that IS the canonical convention today.
//
// Stripe's installed SDK types (Transactions.d.ts) document Transaction.amount only as "in cents
// (or local equivalent)" -- no sign meaning stated, and two official Stripe doc pages were found
// to disagree on the sign of the identical illustrative "Rocket Rides" example (proof that
// generic placeholder JSON in docs cannot be trusted as evidence either way).
//
// Resolved with live evidence instead: a real Stripe test-mode Financial Connections session
// (Stripe's own "Test (Non-OAuth)" institution) was connected, and its real transactions retrieved
// directly via the Financial Connections Transactions API. Transaction fctxn_1UDRfiF3Krk1yqTDjKVJirSo,
// description "Rocket Rides" -- Stripe's own named example for a ride-hail purchase, an
// unambiguous real-world OUTFLOW/expense -- has raw Stripe amount -1000 (negative). Across all 275
// real transactions retrieved from that session (3 merchant scenarios x multiple accounts), the
// sign was 100% consistent: "Rocket Rides"/"Rocket Deliveries" (outflow-themed) were always
// negative raw; "Typographic" (the mirror case) was always positive raw. This matches Stripe's own
// documented Account.Balance sign convention applied consistently to Transaction.amount (positive
// = money owed TO the account holder, i.e. an inflow) -- the OPPOSITE of Plaid's convention, which
// is exactly why this mapper negates it. No exceptions found across the live sample.
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
