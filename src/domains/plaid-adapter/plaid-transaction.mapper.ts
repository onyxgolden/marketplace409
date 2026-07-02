import type {
  FinancialEvent,
} from "../financial-event";

import {
  financialEventFactory,
} from "../financial-event";

import type {
  KnowledgeRecord,
} from "../knowledge/knowledge.types";

import type {
  Property,
} from "../property";

import type {
  PlaidTransaction,
} from "./plaid-transaction.types";

export function mapPlaidTransactionToFinancialEvent(
  transaction: PlaidTransaction,
  property: Property,
  knowledge: KnowledgeRecord,
  ownerId: string | null = null,
): FinancialEvent {
  return financialEventFactory.fromResolvedInput(
    {
      date: transaction.date,
      description: transaction.name,
      amount: transaction.amount,
      resolvedProperty: property,
      knowledge,
      sourceSystem: "plaid",
      sourceRecordId: transaction.transactionId,
      metadata: {
        accountId: transaction.accountId,
        category: transaction.category ?? [],
        merchantName: transaction.merchantName ?? null,
        pending: transaction.pending ?? false,
        raw: transaction.raw ?? null,
      },
    },
    ownerId,
  );
}
