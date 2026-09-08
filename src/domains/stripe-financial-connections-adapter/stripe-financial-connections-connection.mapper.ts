import type {
  Connection,
  CredentialReference,
  InstitutionReference,
} from "../connection";

import type Stripe from "stripe";

export const STRIPE_FINANCIAL_CONNECTIONS_PROVIDER = "stripe_financial_connections";

// The vaulted "credential" for a Stripe Financial Connections connection: not a bearer secret the
// way Plaid's access_token is (Stripe FC accounts are read using FORGE's own platform secret key
// plus these account ids -- the ids are references, not credentials on their own) -- vaulted
// anyway, for defense-in-depth and to reuse the exact same storage/RLS/retrieval mechanism Plaid
// already uses rather than inventing a second, less-protected path for "the durable per-connection
// state a provider needs to keep syncing."
//
// transactionRefreshCursors maps accountId -> the last SUCCESSFULLY persisted Stripe
// transaction_refresh.id for that account (Account.transaction_refresh.id -- the SAME id Stripe
// reports back on the financial_connections.account.refreshed_transactions webhook event's
// data.object). Owned exclusively by the webhook route (see its refreshed_transactions handler),
// which advances it ONLY after every page of that refresh has been fetched AND every canonical
// persistence operation for it has succeeded; a failed import leaves the previous value untouched,
// and it is never advanced to a wall-clock time. The provider's own importDataPayload (the
// manual/coordinator-invoked sync path) deliberately does NOT read or write this cursor at all --
// see its comment for why. An earlier draft of this adapter also stored a `lastProcessedTransactedAt`
// watermark and used it as a fallback filter; that was exactly the unsafe mechanism this design
// replaces (see the client's own header comment on listAllFinancialConnectionsTransactions and
// correction report item 3).
export type StripeFinancialConnectionsVaultedState = Readonly<{
  accountIds: readonly string[];
  transactionRefreshCursors: Readonly<Record<string, string>>;
}>;

// Immutable update helper shared by the webhook route so cursor advancement is always a full
// state replace-and-store through credentialVaultService, never a partial in-place mutation.
export function withUpdatedTransactionRefreshCursor(
  state: StripeFinancialConnectionsVaultedState,
  accountId: string,
  transactionRefreshId: string,
): StripeFinancialConnectionsVaultedState {
  return {
    ...state,
    transactionRefreshCursors: {
      ...state.transactionRefreshCursors,
      [accountId]: transactionRefreshId,
    },
  };
}

// Carries every field the completion route needs to durably persist a real canonical
// FinancialAccount for this account BEFORE subscribing to it -- see correction report item 5. All
// of these are already present on session.accounts (StripeFinancialConnectionsSessionAccount in
// client.ts), so building this requires no extra Stripe API call.
export type StripeFinancialConnectionsCompletedAccount = Readonly<{
  accountId: string;
  displayName: string | null;
  institutionName: string | null;
  last4: string | null;
  category: Stripe.FinancialConnections.Account.Category;
  subcategory: Stripe.FinancialConnections.Account.Subcategory;
  status: Stripe.FinancialConnections.Account.Status;
}>;

export type StripeFinancialConnectionsConnectionMappingInput = Readonly<{
  userId: string;
  sessionId: string;
  accounts: readonly StripeFinancialConnectionsCompletedAccount[];
  now?: string;
}>;

export type StripeFinancialConnectionsConnectionMappingResult = Readonly<{
  credentialReference: CredentialReference;
  connection: Connection;
  institutionReference: InstitutionReference;
  credentialSecret: string;
}>;

export function mapStripeFinancialConnectionsSessionToConnection(
  input: StripeFinancialConnectionsConnectionMappingInput,
): StripeFinancialConnectionsConnectionMappingResult {
  const now = input.now ?? new Date().toISOString();
  const credentialReferenceId = `credential_${STRIPE_FINANCIAL_CONNECTIONS_PROVIDER}_${input.sessionId}`;
  const connectionId = `connection_${STRIPE_FINANCIAL_CONNECTIONS_PROVIDER}_${input.sessionId}`;
  const institutionReferenceId = `institution_${STRIPE_FINANCIAL_CONNECTIONS_PROVIDER}_${input.sessionId}`;

  const vaultedState: StripeFinancialConnectionsVaultedState = {
    accountIds: input.accounts.map((account) => account.accountId),
    transactionRefreshCursors: {},
  };

  const institutionName = input.accounts.find((account) => account.institutionName)?.institutionName
    ?? "Stripe Financial Connections institution";

  return {
    credentialSecret: JSON.stringify(vaultedState),
    credentialReference: {
      id: credentialReferenceId,
      provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
      externalCredentialId: input.sessionId,
      vaultReference: `vault://${STRIPE_FINANCIAL_CONNECTIONS_PROVIDER}/sessions/${input.sessionId}/state`,
      status: "active",
      lastValidatedAt: now,
      createdAt: now,
      updatedAt: now,
    },
    connection: {
      id: connectionId,
      userId: input.userId,
      name: "Stripe Financial Connections",
      type: "bank",
      status: "connected",
      provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
      credentialReferenceId,
      createdAt: now,
      updatedAt: now,
    },
    institutionReference: {
      id: institutionReferenceId,
      connectionId,
      name: institutionName,
      type: "bank",
      provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
      externalInstitutionId: input.sessionId,
      createdAt: now,
      updatedAt: now,
    },
  };
}

export function parseVaultedState(secret: string): StripeFinancialConnectionsVaultedState {
  const parsed = JSON.parse(secret);
  return {
    accountIds: Array.isArray(parsed.accountIds) ? parsed.accountIds : [],
    transactionRefreshCursors: parsed.transactionRefreshCursors ?? {},
  };
}

export function serializeVaultedState(state: StripeFinancialConnectionsVaultedState): string {
  return JSON.stringify(state);
}
