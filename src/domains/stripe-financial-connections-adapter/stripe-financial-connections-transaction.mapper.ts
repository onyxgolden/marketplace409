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

// --- Stripe-to-canonical sign mapping (documented here, not just asserted in a comment
// elsewhere -- see stripe-financial-connections-transaction.mapper.test.ts for fixture-backed
// proof of every case below) ---
//
// Canonical Transaction.amountCents' sign meaning is established by PlaidTransactionMapper, which
// passes Plaid's own amount through UNFLIPPED: Plaid's documented convention is positive = money
// leaving the account (an outflow/expense), negative = money entering it (an inflow/deposit).
// Because nothing else has ever normalized this field, that IS the canonical convention today.
//
// Stripe Financial Connections' Transaction.amount uses the OPPOSITE, documented convention:
// positive = a credit (inflow/deposit), negative = a debit (outflow/expense). This mapper negates
// Stripe's amount so amountCents keeps the SAME provider-independent meaning Plaid already
// established -- positive canonical amountCents always means "money left the account," regardless
// of which provider produced the row.
//
//   Stripe amount   Real-world event         Canonical amountCents
//   +5000            $50.00 deposit           -5000  (inflow)
//   -1250             $12.50 card purchase     +1250  (outflow)
//
// This rests on Stripe's documented Financial Connections Transactions sign convention as
// understood at the time this adapter was written -- worth a final check against Stripe's live
// docs before the first real production session (already gated separately; not initiated by this
// change).
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

    // A void transaction is force-zeroed rather than removed: financial_events upserts by
    // (owner_id, source_system, source_record_id) -- see SupabaseFinancialEventRepository -- so
    // re-importing the SAME Stripe transaction id after it posts, or after it's voided, updates
    // the existing ledger row in place rather than creating a duplicate. Zeroing a void
    // transaction's amount means it stops contributing to any total (as if it never happened)
    // while the row itself, and its audit trail (raw.stripeStatus === "void"), still exists --
    // this is "the transaction was attempted, then voided," not "this transaction never existed,"
    // and it is never contradictory: the row always reflects Stripe's current truth for that one
    // transaction id, the same way a pending transaction later posting already overwrites itself.
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
