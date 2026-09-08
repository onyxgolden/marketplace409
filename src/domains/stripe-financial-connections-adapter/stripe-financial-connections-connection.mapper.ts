import type {
  Connection,
  CredentialReference,
  InstitutionReference,
} from "../connection";

export const STRIPE_FINANCIAL_CONNECTIONS_PROVIDER = "stripe_financial_connections";

// Per-account cursor for SCHED-style incremental transaction sync: the transacted_at watermark
// (Unix seconds) of the newest transaction successfully imported for this account, plus the
// Stripe transaction_refresh.id that produced it -- advanced only after a full paginated import
// for that refresh succeeds (see the provider's importDataPayload and the webhook route's
// refreshed_transactions handler, both of which persist this same shape via the SAME
// credentialVaultService.storeCredential upsert, never a partial/interrupted write).
export type StripeTransactionRefreshCursor = Readonly<{
  lastProcessedTransactionRefreshId: string | null;
  lastProcessedTransactedAt: number | null;
}>;

// The vaulted "credential" for a Stripe Financial Connections connection: not a bearer secret the
// way Plaid's access_token is (Stripe FC accounts are read using FORGE's own platform secret key
// plus these account ids -- the ids are references, not credentials on their own) -- vaulted
// anyway, for defense-in-depth and to reuse the exact same storage/RLS/retrieval mechanism Plaid
// already uses rather than inventing a second, less-protected path for "the durable per-connection
// state a provider needs to keep syncing."
export type StripeFinancialConnectionsVaultedState = Readonly<{
  accountIds: readonly string[];
  transactionRefreshCursors: Readonly<Record<string, StripeTransactionRefreshCursor>>;
}>;

export type StripeFinancialConnectionsCompletedAccount = Readonly<{
  accountId: string;
  displayName: string | null;
  institutionName: string | null;
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
