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

  it("mapMany maps every transaction in order, independently", () => {
    const transactions = mapper.mapMany(
      [stripeTransaction({ transactionId: "a", amount: -100 }), stripeTransaction({ transactionId: "b", amount: 200 })],
      "connection_1", "stripe_financial_connections", "financial_account_1", "fca_test_1",
    );
    expect(transactions.map((t) => t.providerTransactionId)).toEqual(["a", "b"]);
    expect(transactions.map((t) => t.amountCents)).toEqual([100, -200]);
  });
});
