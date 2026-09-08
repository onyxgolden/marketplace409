// Stripe Financial Connections balances are already integer cents (unlike Plaid, which returns
// decimal dollars) -- see stripe-financial-connections-balance.mapper.ts for why that mapper does
// NOT multiply by 100. `asOf` is Stripe's own `balance.as_of` (unix seconds), preserved so the
// canonical AccountBalance.asOf reflects the provider's own timestamp, not just "when FORGE
// happened to read it."
export type StripeFinancialConnectionsBalance = Readonly<{
  accountId: string;
  currentCents: number | null;
  availableCents: number | null;
  currency: string | null;
  asOf: string;
  refreshStatus: "succeeded" | "failed" | "pending" | null;
}>;
