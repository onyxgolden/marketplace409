export type PlaidTransaction = Readonly<{
  transactionId: string;
  accountId: string;
  date: string;
  name: string;
  amount: number;
  category?: readonly string[];
  merchantName?: string | null;
  pending?: boolean;
  raw?: Record<string, unknown>;
}>;
