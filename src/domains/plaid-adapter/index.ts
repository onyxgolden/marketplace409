export type {
  PlaidAdapter,
} from "./plaid-adapter.types";

export type {
  PlaidAccount,
} from "./plaid-account.types";

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
  PlaidFinancialAccountMapper,
} from "./plaid-financial-account.mapper";

export {
  mapPlaidTransactionToFinancialEvent,
} from "./plaid-transaction.mapper";

export type {
  PlaidConnectionMappingInput,
  PlaidConnectionMappingResult,
} from "./plaid-connection.mapper";

export {
  mapPlaidExchangeToConnection,
} from "./plaid-connection.mapper";
