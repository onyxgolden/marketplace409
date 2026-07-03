export type PlaidAccountBalance = Readonly<{
  accountId: string;
  current: number;
  available: number | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
}>;
