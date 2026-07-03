export type PlaidAccount = Readonly<{
  accountId: string;
  name: string;
  officialName: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  isoCurrencyCode: string | null;
  unofficialCurrencyCode: string | null;
}>;
