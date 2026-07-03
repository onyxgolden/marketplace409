export type AccountBalance = Readonly<{
  id: string;
  financialAccountId: string;
  connectionId: string;
  provider: string;
  providerAccountId: string;
  currencyCode: string;
  currentBalanceCents: number;
  availableBalanceCents: number | null;
  asOf: string;
  createdAt: string;
}>;

export function createAccountBalance(
  balance: AccountBalance,
): AccountBalance {
  return Object.freeze({
    ...balance,
  });
}
