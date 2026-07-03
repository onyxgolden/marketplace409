export const FINANCIAL_ACCOUNT_TYPES = [
  "depository",
  "credit",
  "loan",
  "investment",
  "other",
] as const;

export type FinancialAccountType = typeof FINANCIAL_ACCOUNT_TYPES[number];

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
