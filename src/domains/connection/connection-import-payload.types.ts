export type ConnectionImportPayload = Readonly<{
  provider: string;
  connectionId: string;

  accounts: readonly unknown[];
  balances: readonly unknown[];
  transactions: readonly unknown[];

  occurredAt: string;
}>;
