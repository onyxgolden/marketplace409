import type {
  ConnectionProvider,
} from "../connection";

import type {
  PlaidLinkTokenRequest,
  PlaidPublicTokenExchangeRequest,
  PlaidPublicTokenExchangeResult,
} from "./plaid.client";

export type PlaidAdapter = ConnectionProvider & Readonly<{
  createLinkToken(request: PlaidLinkTokenRequest): Promise<string>;
  exchangePublicToken(
    request: PlaidPublicTokenExchangeRequest,
  ): Promise<PlaidPublicTokenExchangeResult>;
}>;
