import { describe, expect, it } from "vitest";
import { StripeFinancialConnectionsTransactionMapper } from "../stripe-financial-connections-transaction.mapper";
import type { StripeFinancialConnectionsTransaction } from "../stripe-financial-connections-transaction.types";

// Fixtures shaped after Stripe's own documented Financial Connections Transaction object
// (id "fcxtxn_...", amount signed integer cents, status "posted"|"pending"|"void").
function stripeTransaction(overrides: Partial<StripeFinancialConnectionsTransaction> = {}): StripeFinancialConnectionsTransaction {
  return {
    transactionId: "fcxtxn_test_1",
    accountId: "fca_test_1",
    amount: -1250,
    currency: "usd",
    description: "AMAZON.COM PURCHASE",
    status: "posted",
    transactedAt: "2026-01-15",
    statusTransitionedAt: "2026-01-15T00:00:00.000Z",
    transactionRefreshId: "fctxnref_1",
    ...overrides,
  };
}

describe("StripeFinancialConnectionsTransactionMapper", () => {
  const mapper = new StripeFinancialConnectionsTransactionMapper();

  it("maps an external-bank card purchase (Stripe negative/debit) to a positive canonical outflow, matching Plaid's sign convention", () => {
    const transaction = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_purchase", amount: -1250, description: "AMAZON.COM PURCHASE" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transaction.amountCents).toBe(1250);
    expect(transaction.pending).toBe(false);
    expect(transaction.id).toBe("transaction_stripe_financial_connections_fcxtxn_purchase");
  });

  // Real fixture, not a hand-typed guess: captured directly from a live Stripe test-mode
  // Financial Connections session (Stripe's own "Test (Non-OAuth)" institution). This is the
  // exact evidence that settled the sign-convention question -- see correction report item 9 and
  // the mapper's own header comment. "Rocket Rides" is Stripe's own named example for a ride-hail
  // purchase, an unambiguous real-world outflow/expense; its raw Stripe amount was -1000.
  // Retrieved directly via GET /v1/financial_connections/transactions/fctxn_1UDRfiF3Krk1yqTDjKVJirSo.
  it("VERIFIED against live Stripe test-mode data: a real 'Rocket Rides' transaction (raw amount -1000, an unambiguous real-world expense) maps to canonical +1000, confirming Stripe negative = outflow", () => {
    const transaction = mapper.map(
      stripeTransaction({
        transactionId: "fctxn_1UDRfiF3Krk1yqTDjKVJirSo",
        amount: -1000,
        description: "Rocket Rides",
        status: "posted",
        transactedAt: "2026-09-08",
      }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transaction.amountCents).toBe(1000);
  });

  it("maps a deposit (Stripe positive/credit) to a negative canonical inflow", () => {
    const transaction = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_deposit", amount: 500000, description: "PAYROLL DEPOSIT" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transaction.amountCents).toBe(-500000);
  });

  it("marks a pending transaction as pending, preserving its (still Stripe-signed-then-negated) amount", () => {
    const transaction = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_pending", amount: -899, status: "pending", statusTransitionedAt: null }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transaction.pending).toBe(true);
    expect(transaction.amountCents).toBe(899);
    expect(transaction.raw).toMatchObject({ stripeStatus: "pending" });
  });

  it("represents a pending-to-posted transition as the same transaction id with pending now false -- an upsert, not a new ledger row", () => {
    const pending = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_lifecycle", amount: -2000, status: "pending", statusTransitionedAt: null }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    const posted = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_lifecycle", amount: -2000, status: "posted", statusTransitionedAt: "2026-01-16T00:00:00.000Z" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(pending.id).toBe(posted.id); // same canonical id -- financial_events upserts on this
    expect(pending.pending).toBe(true);
    expect(posted.pending).toBe(false);
    expect(pending.amountCents).toBe(posted.amountCents);
  });

  it("zeroes a void transaction's amount so it never contributes to a total, while keeping the row and marking it void for audit", () => {
    const voided = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_void", amount: -4400, status: "void", statusTransitionedAt: "2026-01-17T00:00:00.000Z" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(voided.amountCents).toBe(0);
    expect(voided.pending).toBe(false);
    expect(voided.raw).toMatchObject({ stripeStatus: "void", statusTransitionedAt: "2026-01-17T00:00:00.000Z" });
    // Same canonical id as it would have had while posted -- a later void re-import overwrites
    // the same financial_events row (upsert by source_record_id), it does not duplicate it.
    expect(voided.id).toBe("transaction_stripe_financial_connections_fcxtxn_void");
  });

  it("represents a posted transaction later voided by a SUBSEQUENT refresh as the same row, now zeroed, carrying the newer transaction_refresh id", () => {
    const posted = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_updated", amount: -3000, status: "posted", transactionRefreshId: "fctxnref_1" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    const voidedByLaterRefresh = mapper.map(
      stripeTransaction({ transactionId: "fcxtxn_updated", amount: -3000, status: "void", statusTransitionedAt: "2026-01-20T00:00:00.000Z", transactionRefreshId: "fctxnref_2" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(posted.id).toBe(voidedByLaterRefresh.id);
    expect(posted.amountCents).toBe(3000);
    expect(voidedByLaterRefresh.amountCents).toBe(0);
    expect(voidedByLaterRefresh.raw).toMatchObject({ stripeStatus: "void", transactionRefreshId: "fctxnref_2" });
  });

  it("carries the raw transactionRefreshId through for audit, separate from the cursor-advancement mechanism (which uses the account-level refresh id, not this per-transaction one)", () => {
    const transaction = mapper.map(
      stripeTransaction({ transactionRefreshId: "fctxnref_abc" }),
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transaction.raw).toMatchObject({ transactionRefreshId: "fctxnref_abc" });
  });

  it("mapMany maps every transaction in order, independently", () => {
    const transactions = mapper.mapMany(
      [stripeTransaction({ transactionId: "a", amount: -100 }), stripeTransaction({ transactionId: "b", amount: 200 })],
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transactions.map((t) => t.providerTransactionId)).toEqual(["a", "b"]);
    expect(transactions.map((t) => t.amountCents)).toEqual([100, -200]);
  });
});
