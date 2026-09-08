// Normalized shape of a Stripe Financial Connections Account object -- only the fields this
// adapter actually maps into a canonical FinancialAccount. Deliberately excludes
// account.ownership/ownership_refresh: the approved application scope does not include
// account-ownership data (see FORGE's Stripe application scope), so this adapter never requests
// or reads it, even though the raw Stripe object may carry it.
export type StripeFinancialConnectionsAccount = Readonly<{
  accountId: string;
  displayName: string | null;
  institutionName: string | null;
  last4: string | null;
  category: string; // Stripe: "cash" | "credit" | "investment" | "other"
  subcategory: string | null; // Stripe: "checking" | "savings" | "credit_card" | "mortgage" | "line_of_credit" | "other" | null
  status: string; // Stripe: "active" | "inactive" | "disconnected"
  currency: string | null;
}>;
