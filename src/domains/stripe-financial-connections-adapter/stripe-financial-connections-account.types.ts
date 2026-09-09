import type Stripe from "stripe";

// Normalized shape of a Stripe Financial Connections Account object -- only the fields this
// adapter actually maps into a canonical FinancialAccount. Deliberately excludes
// account.ownership/ownership_refresh: the approved application scope does not include
// account-ownership data (see FORGE's Stripe application scope), so this adapter never requests
// or reads it, even though the raw Stripe object may carry it.
//
// category/subcategory/status are aliased to the real installed SDK types (Accounts.d.ts) rather
// than hand-typed string literals, per correction report item 1 -- see
// stripe-financial-connections.client.ts's StripeFinancialConnectionsAccountState, which is the
// only place these values are ever produced.
export type StripeFinancialConnectionsAccount = Readonly<{
  accountId: string;
  displayName: string | null;
  institutionName: string | null;
  last4: string | null;
  category: Stripe.FinancialConnections.Account.Category;
  subcategory: Stripe.FinancialConnections.Account.Subcategory;
  status: Stripe.FinancialConnections.Account.Status;
  currency: string | null;
}>;
