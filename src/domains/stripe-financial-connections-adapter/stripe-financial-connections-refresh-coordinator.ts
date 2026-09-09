// Owns the ONE place a Stripe Financial Connections webhook-triggered balance/transactions
// refresh is fetched and persisted -- fetch -> claim -> persist -> commit, end to end, per
// (financial_account_id, feature). Replaces the webhook route's previous always-full
// executeImport() call for the ongoing refreshed_balance/refreshed_transactions path; the manual
// "Execute" sync button is untouched and still goes through the always-full provider.
// importDataPayload(), which never reads or writes any of this state.
//
// The single governing rule: NEVER decide currency/ordering by comparing local timestamps or
// Stripe's opaque refresh ids. Every call here starts with a READ-ONLY retrieveFinancialConnections
// Account -- explicitly not a requested refresh -- and only ever acts on whatever refresh Stripe
// itself reports as current for the requested feature at that exact moment. This is what makes
// "different refresh ids with an identical last_attempted_at second" and "the local watermark was
// bootstrapped with an unknown timestamp" both safe without any special-case tie-breaking logic:
// there is no local ordering decision left to get wrong.
import {
  retrieveFinancialConnectionsAccount,
  listAllFinancialConnectionsTransactions,
} from "./stripe-financial-connections.client";

import type {
  StripeFinancialConnectionsClient,
} from "./stripe-financial-connections.client";

import {
  STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
} from "./stripe-financial-connections-connection.mapper";

import {
  StripeFinancialConnectionsBalanceMapper,
} from "./stripe-financial-connections-balance.mapper";

import {
  StripeFinancialConnectionsTransactionMapper,
} from "./stripe-financial-connections-transaction.mapper";

import type {
  Connection,
  CredentialReference,
  InstitutionReference,
} from "../connection";

export type StripeFinancialConnectionsRefreshFeature = "balance" | "transactions";

// Duck-typed against SupabaseFinancialAccountRefreshRepository -- kept as an interface here so
// tests can supply an in-memory double without importing the real Supabase-backed class.
export type FinancialAccountRefreshRepositoryLike = {
  getWatermark(input: { financialAccountId: string; feature: StripeFinancialConnectionsRefreshFeature }): Promise<{ committedRefreshId: string | null } | null>;
  claim(input: {
    financialAccountId: string;
    feature: StripeFinancialConnectionsRefreshFeature;
    ownerId: string;
    refreshId: string;
    refreshLastAttemptedAt: number;
    triggeringEventId: string | null;
  }): Promise<{ outcome: "claimed" | "already_committed" | "slot_busy"; workItemId: string }>;
  markImporting(input: { workItemId: string }): Promise<void>;
  markFailed(input: { workItemId: string; failureMessage: string }): Promise<void>;
  commit(input: {
    workItemId: string;
    financialAccountId: string;
    feature: StripeFinancialConnectionsRefreshFeature;
    ownerId: string;
    refreshId: string;
    refreshLastAttemptedAt: number;
  }): Promise<{ outcome: "committed" | "superseded"; supersededByRefreshId: string | null }>;
};

export type AccountBalanceRepositoryLike = {
  saveMany(balances: unknown[], context: { ownerId: string }): Promise<unknown>;
};

export type FinancialEventImportServiceLike = {
  import(input: unknown): Promise<{ importedFinancialEventCount: number; failedFinancialEventCount: number }>;
};

export type ProcessFinancialConnectionsRefreshInput = Readonly<{
  ownerId: string;
  connectionId: string;
  financialAccountId: string;
  providerAccountId: string;
  feature: StripeFinancialConnectionsRefreshFeature;
  triggeringEventId: string | null;
  connection: Connection;
  credentialReference: CredentialReference;
  institutionReference: InstitutionReference;
}>;

export type ProcessFinancialConnectionsRefreshOutcome =
  | Readonly<{ outcome: "committed"; importedCount: number }>
  | Readonly<{ outcome: "already_committed" }>
  | Readonly<{ outcome: "superseded"; supersededByRefreshId: string }>
  | Readonly<{ outcome: "slot_busy" }>
  | Readonly<{ outcome: "not_current" }>;

// BalanceRefresh has no `id` field at all (confirmed against the installed Stripe SDK types --
// Accounts.d.ts's Account.BalanceRefresh interface only has last_attempted_at/
// next_refresh_available_at/status), unlike TransactionRefresh, which does. last_attempted_at
// itself becomes the balance feature's identity key -- used ONLY for equality (claim/commit
// treat every refresh_id as an opaque string, per the standing rule against lexical comparison),
// never compared as a number anywhere in this file or the tables it writes to.
function syntheticBalanceRefreshId(lastAttemptedAt: number): string {
  return `balance_refresh_${lastAttemptedAt}`;
}

export function createStripeFinancialConnectionsRefreshCoordinator(deps: {
  stripeClient: StripeFinancialConnectionsClient;
  refreshRepository: FinancialAccountRefreshRepositoryLike;
  accountBalanceRepository: AccountBalanceRepositoryLike;
  financialEventImportService: FinancialEventImportServiceLike;
}) {
  async function processRefresh(
    input: ProcessFinancialConnectionsRefreshInput,
  ): Promise<ProcessFinancialConnectionsRefreshOutcome> {
    // Always read-only. Never requests a refresh -- see refreshFinancialConnectionsAccountBalance
    // (a genuinely different function, never called here) for the one place this adapter ever
    // asks Stripe to actually perform a new refresh.
    const state = await retrieveFinancialConnectionsAccount(deps.stripeClient, { accountId: input.providerAccountId });

    let currentRefreshId: string;
    let currentRefreshLastAttemptedAt: number;

    if (input.feature === "balance") {
      if (state.balanceRefreshStatus !== "succeeded" || state.balanceRefreshLastAttemptedAt === null || state.balance === null) {
        return { outcome: "not_current" };
      }
      currentRefreshLastAttemptedAt = state.balanceRefreshLastAttemptedAt;
      currentRefreshId = syntheticBalanceRefreshId(currentRefreshLastAttemptedAt);
    } else {
      if (state.transactionRefreshStatus !== "succeeded" || state.transactionRefreshId === null || state.transactionRefreshLastAttemptedAt === null) {
        return { outcome: "not_current" };
      }
      currentRefreshId = state.transactionRefreshId;
      currentRefreshLastAttemptedAt = state.transactionRefreshLastAttemptedAt;
    }

    // Read BEFORE claiming: this is the previously-committed refresh, used below as the
    // incremental transactionRefreshAfter filter. Nothing else can advance it between this read
    // and this work item's own commit -- the exclusivity lock (the partial unique index the
    // claim enforces) guarantees no other work item for this exact (account, feature) is
    // concurrently importing.
    const priorWatermark = await deps.refreshRepository.getWatermark({
      financialAccountId: input.financialAccountId,
      feature: input.feature,
    });

    const claimResult = await deps.refreshRepository.claim({
      financialAccountId: input.financialAccountId,
      feature: input.feature,
      ownerId: input.ownerId,
      refreshId: currentRefreshId,
      refreshLastAttemptedAt: currentRefreshLastAttemptedAt,
      triggeringEventId: input.triggeringEventId,
    });

    if (claimResult.outcome === "already_committed") {
      return { outcome: "already_committed" };
    }
    if (claimResult.outcome === "slot_busy") {
      return { outcome: "slot_busy" };
    }

    await deps.refreshRepository.markImporting({ workItemId: claimResult.workItemId });

    let importedCount = 0;
    let commitResult: { outcome: "committed" | "superseded"; supersededByRefreshId: string | null };
    try {
      if (input.feature === "balance") {
        importedCount = await persistBalance(deps, input, state);
      } else {
        importedCount = await persistTransactions(deps, input, state, priorWatermark?.committedRefreshId ?? undefined);
      }

      // The commit call is deliberately inside the SAME try/catch as persistence: a normal
      // exception from either step marks the work item 'failed' the same way, since both are
      // ordinary retryable failures from this coordinator's own perspective. A genuine process
      // crash between persistence succeeding and this call ever running is a DIFFERENT case this
      // catch block cannot see at all (nothing runs, not even this catch) -- that scenario's
      // safety comes from the persistence step's own idempotent upsert-by-source-id plus the
      // commit's atomic, monotonic compare-and-swap, proven at the database level, not here.
      commitResult = await deps.refreshRepository.commit({
        workItemId: claimResult.workItemId,
        financialAccountId: input.financialAccountId,
        feature: input.feature,
        ownerId: input.ownerId,
        refreshId: currentRefreshId,
        refreshLastAttemptedAt: currentRefreshLastAttemptedAt,
      });
    } catch (error) {
      await deps.refreshRepository.markFailed({
        workItemId: claimResult.workItemId,
        failureMessage: error instanceof Error ? error.message : "Refresh import failed.",
      });
      throw error;
    }

    if (commitResult.outcome === "superseded") {
      return { outcome: "superseded", supersededByRefreshId: commitResult.supersededByRefreshId! };
    }

    return { outcome: "committed", importedCount };
  }

  return { processRefresh };
}

async function persistBalance(
  deps: { accountBalanceRepository: AccountBalanceRepositoryLike },
  input: ProcessFinancialConnectionsRefreshInput,
  state: Awaited<ReturnType<typeof retrieveFinancialConnectionsAccount>>,
): Promise<number> {
  const balanceMapper = new StripeFinancialConnectionsBalanceMapper();
  const balance = balanceMapper.map(
    {
      accountId: input.providerAccountId,
      currentCents: state.balance!.currentCents,
      availableCents: state.balance!.availableCents,
      currency: state.balance!.currency,
      asOf: state.balance!.asOf,
      type: state.balance!.type,
      refreshStatus: "succeeded",
    },
    input.financialAccountId,
    input.connectionId,
    STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
  );

  await deps.accountBalanceRepository.saveMany([balance], { ownerId: input.ownerId });
  return 1;
}

async function persistTransactions(
  deps: { stripeClient: StripeFinancialConnectionsClient; financialEventImportService: FinancialEventImportServiceLike },
  input: ProcessFinancialConnectionsRefreshInput,
  state: Awaited<ReturnType<typeof retrieveFinancialConnectionsAccount>>,
  transactionRefreshAfter: string | undefined,
): Promise<number> {
  const rawTransactions = await listAllFinancialConnectionsTransactions(deps.stripeClient, {
    accountId: input.providerAccountId,
    transactionRefreshAfter,
  });

  const transactionMapper = new StripeFinancialConnectionsTransactionMapper();
  const transactions = transactionMapper.mapMany(
    rawTransactions,
    input.connectionId,
    STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
    input.financialAccountId,
    input.providerAccountId,
  );

  const now = new Date().toISOString();
  const financialEventImportInput = {
    connection: input.connection,
    credentialReference: input.credentialReference,
    institutionReference: input.institutionReference,
    provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
    connectionId: input.connectionId,
    success: true,
    transactions,
    importedTransactionCount: transactions.length,
    skippedTransactionCount: 0,
    failedTransactionCount: 0,
    provisionedAt: input.connection.createdAt,
    persistedAt: now,
    importedAt: now,
    financialAccountsImportedAt: now,
    transactionsImportedAt: now,
    readyForFinancialEventImport: true as const,
  };

  const result = await deps.financialEventImportService.import(financialEventImportInput);
  if (result.failedFinancialEventCount > 0) {
    throw new Error(`${result.failedFinancialEventCount} financial event(s) failed to import.`);
  }
  return result.importedFinancialEventCount;
}
