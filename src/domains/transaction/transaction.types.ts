export type Transaction = Readonly<{
  id: string;
  financialAccountId: string;
  connectionId: string;
  provider: string;
  providerTransactionId: string;
  providerAccountId: string;
  // CANONICAL UNIT CONTRACT: signed INTEGER minor units (cents), never decimal dollars. Every
  // TransactionMapper (PlaidTransactionMapper, StripeFinancialConnectionsTransactionMapper) is
  // responsible for producing this field in minor units regardless of what unit its own provider's
  // raw payload uses -- Plaid's raw amount is decimal dollars and gets multiplied by 100; Stripe
  // Financial Connections' raw amount is already minor units and only needs its sign corrected. See
  // FinancialEvent.amount in financial-event.types.ts for the DIFFERENT contract on the other side
  // of the Transaction-to-FinancialEvent boundary, and financial-event/minorUnitsToDecimalDollars.ts
  // for the single place that crosses it.
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
