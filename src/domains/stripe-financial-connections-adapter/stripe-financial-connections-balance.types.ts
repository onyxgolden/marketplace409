import type Stripe from "stripe";

// Mirrors stripe-financial-connections.client.ts's StripeFinancialConnectionsAccountState.balance
// shape exactly (see extractCurrentBalance/resolveBalanceCurrency there for how these are
// derived). currentCents is Balance.current[currency] -- the authoritative "current balance"
// figure for BOTH cash and credit accounts (Accounts.d.ts) -- never null/defaulted, since the
// client throws rather than hand back an account state with a missing currency amount.
// availableCents is Balance.cash.available[currency], present only when type === "cash"; credit
// accounts' Balance.credit.used is intentionally NOT represented here (not negated into
// currentCents/availableCents, not invented a new field for) -- the canonical AccountBalance model
// has no place for "credit used" today, and adding one is a larger decision this PR does not make
// unilaterally. See the mapper's own comment and correction report item 2.
export type StripeFinancialConnectionsBalance = Readonly<{
  accountId: string;
  currentCents: number;
  availableCents: number | null;
  currency: string;
  asOf: string;
  type: Stripe.FinancialConnections.Account.Balance.Type;
  refreshStatus: "succeeded" | "failed" | "pending" | null;
}>;
