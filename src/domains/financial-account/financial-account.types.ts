export const FINANCIAL_ACCOUNT_TYPES = [
  "depository",
  "credit",
  "loan",
  "investment",
  "other",
] as const;

export type FinancialAccountType = typeof FINANCIAL_ACCOUNT_TYPES[number];

// Heuristic classification, not authoritative -- see classifyAccountBusinessScope.ts. Null only for
// legacy rows from before this column existed and haven't been backfilled/re-synced yet.
export type FinancialAccountBusinessScope = "business" | "personal";

export type FinancialAccount = Readonly<{
  id: string;
  connectionId: string;
  provider: string;
  providerAccountId: string;
  institutionId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: FinancialAccountType;
  subtype: string | null;
  currencyCode: string;
  active: boolean;
  // Optional on the canonical object itself -- a provider mapper never sets this (providers have no
  // concept of business vs. personal), so it stays absent/null until
  // FinancialAccountImportService.persistFinancialAccounts classifies it just before persisting.
  businessScope?: FinancialAccountBusinessScope | null;
  createdAt: string;
  updatedAt: string;
}>;

export function createFinancialAccount(
  account: FinancialAccount,
): FinancialAccount {
  return Object.freeze({
    ...account,
  });
}
