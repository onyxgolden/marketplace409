export type Transaction = Readonly<{
  id: string;
  financialAccountId: string;
  connectionId: string;
  provider: string;
  providerTransactionId: string;
  providerAccountId: string;
  amountCents: number;
  currencyCode: string;
  date: string;
  description: string;
  merchantName: string | null;
  category: readonly string[];
  pending: boolean;
  raw: Record<string, unknown> | null;
  createdAt: string;
}>;

export function createTransaction(
  transaction: Transaction,
): Transaction {
  return Object.freeze({
    ...transaction,
    category: Object.freeze([...transaction.category]),
  });
}
