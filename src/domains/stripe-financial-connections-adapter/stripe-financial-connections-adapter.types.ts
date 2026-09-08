import type {
  ConnectionProvider,
} from "../connection";

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

export type StripeFinancialConnectionsSessionCompleteResult = Readonly<{
  sessionId: string;
  accounts: readonly { accountId: string; displayName: string | null; institutionName: string | null }[];
}>;

export type StripeFinancialConnectionsAdapter = ConnectionProvider & Readonly<{
  createFinancialConnectionsSession(
    request: StripeFinancialConnectionsSessionCreateRequest,
  ): Promise<StripeFinancialConnectionsSessionCreateResult>;

  completeFinancialConnectionsSession(
    request: StripeFinancialConnectionsSessionCompleteRequest,
  ): Promise<StripeFinancialConnectionsSessionCompleteResult>;
}>;
