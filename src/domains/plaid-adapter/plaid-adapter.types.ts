import type {
  ConnectionProvider,
} from "../connection";

import type {
  PlaidLinkTokenRequest,
} from "./plaid.client";

export type PlaidAdapter = ConnectionProvider & Readonly<{
  createLinkToken(request: PlaidLinkTokenRequest): Promise<string>;
}>;
