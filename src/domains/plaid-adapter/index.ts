export type {
  PlaidAdapter,
} from "./plaid-adapter.types";

export type {
  PlaidTransaction,
} from "./plaid-transaction.types";

export {
  createPlaidAdapter,
} from "./plaid-adapter.provider";

export {
  mapPlaidTransactionToFinancialEvent,
} from "./plaid-transaction.mapper";
