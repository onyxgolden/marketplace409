import type {
  Connection,
  ConnectionHealth,
  ConnectionProviderHealth,
  ConnectionProviderImportContext,
  ConnectionProviderImportResult,
  ConnectionProviderResult,
  ConnectionStatus,
  CredentialReference,
} from "../connection";

import type {
  StripeFinancialConnectionsAdapter,
} from "./stripe-financial-connections-adapter.types";

import type {
  StripeFinancialConnectionsClient,
} from "./stripe-financial-connections.client";

import type Stripe from "stripe";

import {
  createFinancialConnectionsSession,
  createStripeCustomerForOwner,
  listAllFinancialConnectionsTransactions,
  retrieveFinancialConnectionsAccount,
  retrieveFinancialConnectionsSession,
  subscribeFinancialConnectionsAccount,
} from "./stripe-financial-connections.client";

import {
  STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
  parseVaultedState,
} from "./stripe-financial-connections-connection.mapper";

import {
  StripeFinancialConnectionsAccountMapper,
} from "./stripe-financial-connections-account.mapper";

import {
  StripeFinancialConnectionsBalanceMapper,
} from "./stripe-financial-connections-balance.mapper";

import {
  StripeFinancialConnectionsTransactionMapper,
} from "./stripe-financial-connections-transaction.mapper";

const OWNER_STRIPE_CUSTOMER_VAULT_REFERENCE = "stripe_financial_connections_customer_id";

function providerResult(
  operation: ConnectionProviderResult["operation"],
  success: boolean,
): ConnectionProviderResult {
  return {
    provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
    operation,
    success,
    message: success
      ? "Stripe Financial Connections adapter operation accepted."
      : "Invalid provider for Stripe Financial Connections adapter.",
    occurredAt: new Date().toISOString(),
  };
}

export function createStripeFinancialConnectionsAdapter({
  credentialVaultService,
  stripeClient,
}: {
  credentialVaultService?: {
    retrieveCredential(ownerId: string, vaultReference: string): Promise<string | null>;
    storeCredential(input: { ownerId: string; vaultReference: string; secret: string }): Promise<unknown>;
  };
  stripeClient?: StripeFinancialConnectionsClient;
} = {}): StripeFinancialConnectionsAdapter {
  // Lazy, mirroring PlaidAdapter's own resolvePlaidClient -- resolveStripeClient() is only ever
  // called from inside a method that's actually being invoked, never at adapter-construction
  // time. This matters because createConnectionPlatformSuite constructs this adapter
  // unconditionally (alongside Plaid's) even in contexts (most existing tests) that never
  // configure Stripe env vars at all -- eagerly resolving a client here would make every one of
  // those call sites start failing for a reason that has nothing to do with what they're testing.
  // Reuses StripeBillingProvider's already-configured SDK instance rather than constructing a
  // second one -- see the client module's own header comment.
  const resolveStripeClient = async (): Promise<StripeFinancialConnectionsClient> => {
    if (stripeClient) return stripeClient;
    const { createStripeBillingProvider } = await import("@/infrastructure/billing/StripeBillingProvider");
    // StripeBillingProvider.js is plain untyped JS (no checkJs), so `.stripe` is inferred `any` --
    // an `any` would satisfy StripeFinancialConnectionsClient with zero real type-checking,
    // silently defeating the whole point of typing that interface against the real SDK (item 1).
    // Casting through the real `Stripe` type FIRST forces this assignment to actually be checked
    // structurally: if a future stripe SDK upgrade changes a method signature this interface
    // relies on, this line (not a runtime surprise inside the adapter) is where it breaks.
    return createStripeBillingProvider().stripe as Stripe;
  };

  const requireCredentialVaultService = () => {
    if (credentialVaultService === undefined) {
      throw new Error("Credential vault service is required for the Stripe Financial Connections adapter.");
    }
    return credentialVaultService;
  };

  // Reuses an owner's existing platform-level Stripe Customer (created for a prior Financial
  // Connections session) if one is vaulted, rather than minting a new orphan Customer on every
  // session -- this is deliberately NOT the same Customer createStripeBillingProvider creates for
  // tenants/borrowers (those live inside a connected account via `stripeAccount`, representing a
  // different party entirely; reusing one would be the wrong identity).
  const resolveOwnerStripeCustomerId = async (ownerId: string): Promise<string> => {
    const vault = requireCredentialVaultService();
    const existing = await vault.retrieveCredential(ownerId, OWNER_STRIPE_CUSTOMER_VAULT_REFERENCE);
    if (existing !== null && existing.trim().length > 0) return existing;

    const client = await resolveStripeClient();
    const created = await createStripeCustomerForOwner(client, { ownerId });
    await vault.storeCredential({
      ownerId,
      vaultReference: OWNER_STRIPE_CUSTOMER_VAULT_REFERENCE,
      secret: created.customerId,
    });
    return created.customerId;
  };

  const resolveVaultedAccessToken = async (
    context?: ConnectionProviderImportContext,
  ): Promise<ReturnType<typeof parseVaultedState>> => {
    if (context === undefined) {
      throw new Error("Stripe Financial Connections import context is required.");
    }
    const vault = requireCredentialVaultService();
    const secret = await vault.retrieveCredential(context.ownerId, context.credentialReference.vaultReference);
    if (secret === null || secret.trim().length === 0) {
      throw new Error("Stripe Financial Connections state was not found in the credential vault.");
    }
    return parseVaultedState(secret);
  };

  return {
    provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
    displayName: "Stripe Financial Connections",

    // --- Bespoke connection-initiation methods (not part of the generic ConnectionProvider
    // interface -- mirrors Plaid's own createLinkToken/exchangePublicToken split) ---

    async createFinancialConnectionsSession(request) {
      const customerId = await resolveOwnerStripeCustomerId(request.ownerId);
      const client = await resolveStripeClient();
      const session = await createFinancialConnectionsSession(client, { customerId });
      return { sessionId: session.id, clientSecret: session.clientSecret };
    },

    // Verification + retrieval ONLY -- does NOT subscribe. Per correction report item 5, FORGE
    // must durably persist the connection-to-Stripe-account association before subscribing to
    // anything, so the caller (the /complete route) persists financial_accounts rows from this
    // method's returned account list FIRST, and only then calls
    // subscribeFinancialConnectionsAccounts below. An earlier version of this adapter subscribed
    // as this method's own side effect, before the route had persisted anything durable -- the
    // exact race this split closes.
    async completeFinancialConnectionsSession(request) {
      // Server-side retrieval only -- the browser is never trusted to report which accounts were
      // authorized. accountHolderCustomerId is checked against the SAME vaulted customer id this
      // owner's session would have been created with, proving the session actually belongs to
      // this owner's workspace and was not substituted/guessed.
      const expectedCustomerId = await resolveOwnerStripeCustomerId(request.ownerId);
      const client = await resolveStripeClient();
      const session = await retrieveFinancialConnectionsSession(client, { sessionId: request.sessionId });

      if (session.accountHolderCustomerId !== expectedCustomerId) {
        throw new Error("Stripe Financial Connections session does not belong to the expected owner workspace.");
      }

      const usAccounts = session.accounts; // filters.countries already restricted this session to US at creation

      return {
        sessionId: session.id,
        accounts: usAccounts.map((account) => ({
          accountId: account.accountId,
          displayName: account.displayName,
          institutionName: account.institutionName,
          last4: account.last4,
          category: account.category,
          subcategory: account.subcategory,
          status: account.status,
        })),
      };
    },

    // Called by the /complete route ONLY after it has durably persisted a financial_accounts row
    // for every one of these account ids -- see completeFinancialConnectionsSession's comment and
    // correction report item 5. Subscribing enables Stripe's daily automatic transaction refresh,
    // which is the moment refreshed_transactions/refreshed_balance webhooks can first arrive; by
    // then, the webhook route's account -> connection/owner lookup can always succeed.
    async subscribeFinancialConnectionsAccounts(request) {
      const client = await resolveStripeClient();
      await Promise.all(
        request.accountIds.map((accountId) => subscribeFinancialConnectionsAccount(client, { accountId })),
      );
    },

    // --- Generic ConnectionProvider interface ---

    capabilities() {
      const now = new Date().toISOString();
      return {
        connectionId: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
        capabilities: [
          "import_accounts",
          "import_transactions",
          "import_balances",
          "manual_sync",
          "webhook_updates",
        ],
        supportsAutomaticSync: true,
        supportsManualSync: true,
        supportsWebhooks: true,
        supportsRealtimeUpdates: false,
        createdAt: now,
        updatedAt: now,
      };
    },

    async validateCredentials(credentialReference: CredentialReference): Promise<ConnectionProviderResult> {
      return providerResult("validate_credentials", credentialReference.provider === STRIPE_FINANCIAL_CONNECTIONS_PROVIDER);
    },

    // Not part of the live connection flow (session creation/completion is) -- present only for
    // interface completeness, at the same shallow level Plaid's own connect() already is (Plaid's
    // real connection creation goes through exchangePublicToken + mapPlaidExchangeToConnection,
    // never through connect() either).
    async connect(credentialReference: CredentialReference): Promise<Connection> {
      const now = new Date().toISOString();
      return {
        id: credentialReference.externalCredentialId,
        userId: "pending_user",
        name: "Stripe Financial Connections",
        type: "bank",
        status: "connected",
        provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
        credentialReferenceId: credentialReference.id,
        createdAt: now,
        updatedAt: now,
      };
    },

    // The real, functional disconnect (unsubscribe + Stripe-side disconnect for every vaulted
    // account) lives in the dedicated /api/stripe/financial-connections/disconnect route, which
    // has direct access to the credential vault and connection repository this thin interface
    // method does not receive (ConnectionProvider.disconnect(connection) has no context param).
    async disconnect(connection: Connection): Promise<ConnectionProviderResult> {
      return providerResult("disconnect", connection.provider === STRIPE_FINANCIAL_CONNECTIONS_PROVIDER);
    },

    async refreshStatus(connection: Connection): Promise<ConnectionStatus> {
      return connection.provider === STRIPE_FINANCIAL_CONNECTIONS_PROVIDER ? "connected" : "error";
    },

    async synchronize(connection: Connection): Promise<ConnectionProviderResult> {
      return providerResult("synchronize", connection.provider === STRIPE_FINANCIAL_CONNECTIONS_PROVIDER);
    },

    async importData(
      connection: Connection,
      context?: ConnectionProviderImportContext,
    ): Promise<ConnectionProviderImportResult> {
      void context;
      return {
        provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
        connectionId: connection.id,
        importedRecordCount: 0,
        skippedRecordCount: 0,
        failedRecordCount: connection.provider === STRIPE_FINANCIAL_CONNECTIONS_PROVIDER ? 0 : 1,
        occurredAt: new Date().toISOString(),
      };
    },

    // The manual/user-requested sync path (via the existing provider-neutral
    // ConnectionImportExecutionCoordinator, e.g. the connections page's "Execute" button).
    // Deliberately simple and always-full, like Plaid's own importDataPayload: no transacted_at
    // watermark, no cursor read or write. The cursor-based incremental sync required for ongoing
    // updates lives in the Financial Connections webhook route instead, which owns its own
    // persistence sequencing end to end (fetch -> map -> persist -> only then advance the cursor)
    // -- something this generic payload-only method cannot guarantee, since whatever calls it
    // persists the result afterward, outside this method's control. Idempotent upsert-by-id in
    // the financial event ledger is what makes this always-full refetch safe to repeat.
    async importDataPayload(
      connection: Connection,
      context?: ConnectionProviderImportContext,
    ) {
      const vaultedState = await resolveVaultedAccessToken(context);
      const occurredAt = new Date().toISOString();
      const client = await resolveStripeClient();

      const accountMapper = new StripeFinancialConnectionsAccountMapper();
      const balanceMapper = new StripeFinancialConnectionsBalanceMapper();
      const transactionMapper = new StripeFinancialConnectionsTransactionMapper();

      const accountStates = await Promise.all(
        vaultedState.accountIds.map((accountId) => retrieveFinancialConnectionsAccount(client, { accountId })),
      );

      // Inactive/disconnected accounts are skipped entirely -- never refreshed, matching "do not
      // refresh inactive accounts." Their FinancialAccount row (if already imported) is left as
      // last-known state; disconnection is reflected at the Connection level by the webhook
      // handler, not by this manual-sync path.
      const activeAccountStates = accountStates.filter((state) => state.status === "active");

      const stripeAccounts = activeAccountStates.map((state) => ({
        accountId: state.accountId,
        displayName: state.displayName,
        institutionName: state.institutionName,
        last4: state.last4,
        category: state.category,
        subcategory: state.subcategory,
        status: state.status,
        currency: state.balance?.currency ?? null,
      }));

      const accounts = accountMapper.mapMany(
        stripeAccounts,
        connection.id,
        STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
        context!.institutionReference.id,
      );

      const financialAccountIdByProviderAccountId = new Map(
        accounts.map((account) => [account.providerAccountId, account.id]),
      );

      const balances = activeAccountStates
        .filter((state) => state.balance !== null && state.balanceRefreshStatus === "succeeded")
        .map((state) => {
          const financialAccountId = financialAccountIdByProviderAccountId.get(state.accountId);
          if (financialAccountId === undefined) {
            throw new Error(`Stripe Financial Connections balance references unknown account: ${state.accountId}`);
          }
          return balanceMapper.map(
            {
              accountId: state.accountId,
              currentCents: state.balance!.currentCents,
              availableCents: state.balance!.availableCents,
              currency: state.balance!.currency,
              asOf: state.balance!.asOf,
              type: state.balance!.type,
              refreshStatus: "succeeded",
            },
            financialAccountId,
            connection.id,
            STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
          );
        });

      // Deliberately always-full, no cursor read or write: this generic payload-only method's
      // caller (ConnectionImportExecutionCoordinator) persists the returned transactions
      // afterward, outside this method's control, so it cannot itself guarantee "advance the
      // cursor only after persistence succeeds" -- the one invariant item 3 requires. Ongoing
      // incremental sync via transaction_refresh.after therefore lives ONLY in the webhook route,
      // which owns fetch -> map -> persist -> advance-cursor end to end itself. Idempotent
      // upsert-by-transaction-id downstream (financial_events) makes this manual path's full
      // refetch safe to repeat as often as a user clicks "Execute."
      const transactionsByAccount = await Promise.all(
        activeAccountStates.map(async (state) => {
          const financialAccountId = financialAccountIdByProviderAccountId.get(state.accountId);
          if (financialAccountId === undefined) {
            throw new Error(`Stripe Financial Connections transaction sync references unknown account: ${state.accountId}`);
          }
          const rawTransactions = await listAllFinancialConnectionsTransactions(client, { accountId: state.accountId });
          return transactionMapper.mapMany(rawTransactions, connection.id, STRIPE_FINANCIAL_CONNECTIONS_PROVIDER, financialAccountId, state.accountId);
        }),
      );

      return {
        provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
        connectionId: connection.id,
        accounts,
        balances,
        transactions: transactionsByAccount.flat(),
        occurredAt,
      };
    },

    async reportHealth(connection: Connection): Promise<ConnectionHealth> {
      const now = new Date().toISOString();
      const isStripeFcConnection = connection.provider === STRIPE_FINANCIAL_CONNECTIONS_PROVIDER;

      if (!isStripeFcConnection) {
        return {
          connectionId: connection.id,
          state: "critical",
          severity: "critical",
          label: "Invalid provider",
          allowsImport: false,
          requiresUserAction: true,
          issueCount: 1,
          warningCount: 0,
          checkedAt: now,
        };
      }

      if (connection.status === "connected") {
        return {
          connectionId: connection.id,
          state: "healthy",
          severity: "healthy",
          label: "Stripe Financial Connections ready",
          allowsImport: true,
          requiresUserAction: false,
          issueCount: 0,
          warningCount: 0,
          checkedAt: now,
        };
      }

      // "disconnected" is set in exactly two places: this provider's own /disconnect route (a
      // deliberate, user-initiated retirement -- see the production incident this fixes: an
      // orphaned empty connection was left as "critical, repair this connection" purely because it
      // was not literally "connected", even though it required no action from anyone) and the
      // webhook route's financial_connections.account.disconnected handler (the holder or Stripe
      // fully revoked access). Neither case is "broken" the way "needs_attention" (deactivated,
      // temporarily unrefreshable, relink offered) or any other non-connected status is -- both
      // mean "this connection is done, its financial history stays exactly as imported, and no
      // action is expected." Treated as historical, not as an issue: allowsImport/
      // requiresUserAction both false, issueCount/warningCount both 0, so it never inflates the
      // platform's health score, the "Needs Attention" tile, or the priority-action queue.
      if (connection.status === "disconnected") {
        return {
          connectionId: connection.id,
          state: "retired",
          severity: "neutral",
          label: "Stripe Financial Connections disconnected (historical)",
          allowsImport: false,
          requiresUserAction: false,
          issueCount: 0,
          warningCount: 0,
          checkedAt: now,
        };
      }

      // Every other status ("needs_attention", "error", "pending", "not_connected", "syncing")
      // genuinely requires user action -- unchanged from before this fix.
      return {
        connectionId: connection.id,
        state: "critical",
        severity: "critical",
        label: "Stripe Financial Connections requires attention",
        allowsImport: false,
        requiresUserAction: true,
        issueCount: 1,
        warningCount: 0,
        checkedAt: now,
      };
    },

    async providerHealth(): Promise<ConnectionProviderHealth> {
      return {
        provider: STRIPE_FINANCIAL_CONNECTIONS_PROVIDER,
        status: "available",
        label: "Stripe Financial Connections adapter available",
        checkedAt: new Date().toISOString(),
      };
    },
  };
}
