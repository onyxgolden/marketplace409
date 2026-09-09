import type {
  ConnectionProvider,
} from "../connection";

import type {
  StripeFinancialConnectionsCompletedAccount,
} from "./stripe-financial-connections-connection.mapper";

export type StripeFinancialConnectionsSessionCreateRequest = Readonly<{
  ownerId: string;
}>;

export type StripeFinancialConnectionsSessionCreateResult = Readonly<{
  sessionId: string;
  clientSecret: string;
}>;

export type StripeFinancialConnectionsSessionCompleteRequest = Readonly<{
  ownerId: string;
  sessionId: string;
}>;

// accounts carries every field completeFinancialConnectionsSession retrieved from the verified
// session -- enough for the caller to persist a real canonical FinancialAccount per account
// (durably, before subscribing) without a second Stripe call. See correction report item 5.
export type StripeFinancialConnectionsSessionCompleteResult = Readonly<{
  sessionId: string;
  accounts: readonly StripeFinancialConnectionsCompletedAccount[];
}>;

export type StripeFinancialConnectionsSubscribeAccountsRequest = Readonly<{
  accountIds: readonly string[];
}>;

export type StripeFinancialConnectionsAdapter = ConnectionProvider & Readonly<{
  createFinancialConnectionsSession(
    request: StripeFinancialConnectionsSessionCreateRequest,
  ): Promise<StripeFinancialConnectionsSessionCreateResult>;

  // Verification + retrieval ONLY -- never subscribes. See stripe-financial-connections.provider.ts's
  // own comment on this method and correction report item 5.
  completeFinancialConnectionsSession(
    request: StripeFinancialConnectionsSessionCompleteRequest,
  ): Promise<StripeFinancialConnectionsSessionCompleteResult>;

  // Must only be called once the caller has durably persisted a financial_accounts row for every
  // account id given here.
  subscribeFinancialConnectionsAccounts(
    request: StripeFinancialConnectionsSubscribeAccountsRequest,
  ): Promise<void>;
}>;
