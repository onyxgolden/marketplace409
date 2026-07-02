export type {
  PlaidAdapter,
} from "./plaid-adapter.types";

export type {
  PlaidTransaction,
} from "./plaid-transaction.types";

export type {
  PlaidConfig,
  PlaidEnvironment,
} from "./plaid.config";

export {
  getPlaidConfig,
} from "./plaid.config";

export {
  createPlaidClient,
} from "./plaid.client";

export {
  createPlaidAdapter,
} from "./plaid-adapter.provider";

export {
  mapPlaidTransactionToFinancialEvent,
} from "./plaid-transaction.mapper";
