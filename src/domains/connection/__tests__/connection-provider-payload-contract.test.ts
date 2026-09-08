import { describe, expect, it, vi } from "vitest";

import {
  ConnectionImportExecutionCoordinator,
} from "../../../application/connection/ConnectionImportExecutionCoordinator.js";

import {
  AccountImportService,
  createConnectionProviderRegistry,
  InMemoryConnectionRepository,
  InMemoryCredentialReferenceRepository,
  InMemoryInstitutionReferenceRepository,
} from "../index";

import {
  FinancialAccountImportService,
  InMemoryFinancialAccountRepository,
} from "../../financial-account";

import {
  AccountBalanceImportService,
  InMemoryAccountBalanceRepository,
} from "../../account-balance";

import {
  InMemoryTransactionRepository,
  TransactionImportService,
} from "../../transaction";

import {
  FinancialEventImportService,
  InMemoryFinancialEventRepository,
} from "../../financial-event";

import {
  PlaidAccountBalanceMapper,
  PlaidFinancialAccountMapper,
  PlaidTransactionMapper,
  createPlaidAdapter,
} from "../../plaid-adapter";
import {
  createStripeFinancialConnectionsAdapter,
} from "../../stripe-financial-connections-adapter";

// This is the standing regression test for the double-mapping bug found while wiring the Stripe
// Financial Connections adapter into ConnectionImportExecutionCoordinator: payload.accounts/
// balances/transactions (from provider.importDataPayload()) are already canonical, and must
// reach persistence exactly once -- never re-mapped through a second, provider-specific mapper.
// Runs BOTH real adapters' real importDataPayload output through the REAL coordinator, wired
// with real (in-memory) repositories and the real import services, and inspects what actually
// lands in each repository -- not a mock of the coordinator's own orchestration.

function fakeCredentialVaultService(secrets: Record<string, string>) {
  return {
    retrieveCredential: vi.fn(async (ownerId: string, vaultReference: string) => secrets[`${ownerId}:${vaultReference}`] ?? null),
    storeCredential: vi.fn(async () => ({ stored: true as const, storedAt: new Date().toISOString() })),
  };
}

function buildHarness() {
  const connectionRepository = new InMemoryConnectionRepository();
  const credentialReferenceRepository = new InMemoryCredentialReferenceRepository();
  const institutionReferenceRepository = new InMemoryInstitutionReferenceRepository();
  const financialAccountRepository = new InMemoryFinancialAccountRepository();
  const accountBalanceRepository = new InMemoryAccountBalanceRepository();
  const transactionRepository = new InMemoryTransactionRepository();
  const financialEventRepository = new InMemoryFinancialEventRepository();

  return {
    connectionRepository,
    credentialReferenceRepository,
    institutionReferenceRepository,
    financialAccountRepository,
    accountBalanceRepository,
    transactionRepository,
    financialEventRepository,
  };
}

async function seed(harness: ReturnType<typeof buildHarness>, { connection, credentialReference, institutionReference, ownerId }: any) {
  const context = { ownerId };
  await harness.connectionRepository.save(connection, context);
  await harness.credentialReferenceRepository.save(credentialReference, context);
  await harness.institutionReferenceRepository.save(institutionReference, context);
}

// The mapper instances below are DELIBERATELY always the Plaid ones, even in the Stripe test
// case below -- and the Stripe case still has to pass. That's the point: importCanonicalAccounts/
// importCanonicalBalances/importCanonicalTransactionsForAccount never call this.mapper at all, so
// which mapper is wired here is irrelevant to the canonical path. If the old (bugged)
// importAccounts/importBalances/importTransactionsForAccount were called instead, the Stripe case
// would fail immediately (PlaidFinancialAccountMapper reading Stripe's canonical object's
// nonexistent .accountId/.isoCurrencyCode fields) -- proving this is a real regression guard, not
// a tautology.
function buildCoordinator(harness: ReturnType<typeof buildHarness>, provider: any) {
  const registry = createConnectionProviderRegistry([provider]);
  const accountImportService = new AccountImportService(registry);
  const financialAccountImportService = new FinancialAccountImportService(harness.financialAccountRepository, new PlaidFinancialAccountMapper());
  const accountBalanceImportService = new AccountBalanceImportService(harness.accountBalanceRepository, new PlaidAccountBalanceMapper());
  const transactionImportService = new TransactionImportService(harness.transactionRepository, new PlaidTransactionMapper());
  const financialEventImportService = new FinancialEventImportService({ repository: harness.financialEventRepository });

  return new ConnectionImportExecutionCoordinator({
    connectionRepository: harness.connectionRepository,
    credentialReferenceRepository: harness.credentialReferenceRepository,
    institutionReferenceRepository: harness.institutionReferenceRepository,
    accountImportService,
    financialAccountImportService,
    accountBalanceImportService,
    transactionImportService,
    financialEventImportService,
  });
}

describe("provider.importDataPayload() -> ConnectionImportExecutionCoordinator contract", () => {
  it("Plaid: persists accounts/balances/transactions with every canonical field intact, exactly once", async () => {
    const ownerId = "owner_plaid_1";
    const connection = {
      id: "connection_plaid_1", userId: ownerId, name: "Checking", type: "bank" as const, status: "connected" as const,
      provider: "plaid", credentialReferenceId: "credential_plaid_1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const credentialReference = {
      id: "credential_plaid_1", provider: "plaid", externalCredentialId: "item_1", vaultReference: "vault://plaid/items/item_1/access-token",
      status: "active" as const, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const institutionReference = {
      id: "institution_plaid_1", connectionId: "connection_plaid_1", name: "Sandbox Bank", type: "bank" as const, provider: "plaid",
      externalInstitutionId: "ins_1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const harness = buildHarness();
    await seed(harness, { connection, credentialReference, institutionReference, ownerId });

    const plaidClient = {
      accountsGet: vi.fn().mockResolvedValue({ data: { accounts: [{ account_id: "plaid_account_1", name: "Checking", official_name: "Business Checking", mask: "1234", type: "depository", subtype: "checking", balances: { iso_currency_code: "USD", unofficial_currency_code: null } }], item: { item_id: "item_1" }, request_id: "r1" } }),
      accountsBalanceGet: vi.fn().mockResolvedValue({ data: { accounts: [{ account_id: "plaid_account_1", balances: { current: 1250.55, available: 1000.25, iso_currency_code: "USD", unofficial_currency_code: null } }], item: { item_id: "item_1" }, request_id: "r2" } }),
      transactionsSync: vi.fn().mockResolvedValue({ data: { added: [{ transaction_id: "plaid_txn_1", account_id: "plaid_account_1", date: "2026-01-15", name: "Home Depot", amount: 125.5, category: ["Shops", "Hardware"], merchant_name: "Home Depot", pending: false, payment_channel: "in store", authorized_date: "2026-01-14", pending_transaction_id: null }], modified: [], removed: [], next_cursor: "cursor_1", has_more: false } }),
    };
    const credentialVaultService = fakeCredentialVaultService({ [`${ownerId}:vault://plaid/items/item_1/access-token`]: "access-token-1" });
    const provider = createPlaidAdapter({ credentialVaultService, plaidClient });

    const coordinator = buildCoordinator(harness, provider);
    const result = await coordinator.executeImport({ connectionId: connection.id, ownerId });

    expect(result.success).toBe(true);
    expect(result.failedRecordCount).toBe(0);

    const persistedAccounts = await harness.financialAccountRepository.findByConnection(connection.id);
    expect(persistedAccounts).toHaveLength(1);
    expect(persistedAccounts[0]).toMatchObject({
      providerAccountId: "plaid_account_1", // NOT undefined -- proves no double-mapping
      provider: "plaid", currencyCode: "USD", type: "depository", subtype: "checking", mask: "1234",
    });

    const persistedBalances = await harness.accountBalanceRepository.findByConnection(connection.id);
    expect(persistedBalances).toHaveLength(1);
    expect(persistedBalances[0]).toMatchObject({ currentBalanceCents: 125055, availableBalanceCents: 100025, currencyCode: "USD" });

    const persistedTransactions = await harness.transactionRepository.findByConnection(connection.id);
    expect(persistedTransactions).toHaveLength(1);
    expect(persistedTransactions[0]).toMatchObject({
      providerTransactionId: "plaid_txn_1", amountCents: 12550, date: "2026-01-15", pending: false, description: "Home Depot",
    });
  });

  it("Stripe Financial Connections: persists accounts/balances/transactions with every canonical field intact, exactly once", async () => {
    const ownerId = "owner_stripe_1";
    const connection = {
      id: "connection_stripe_1", userId: ownerId, name: "Stripe Financial Connections", type: "bank" as const, status: "connected" as const,
      provider: "stripe_financial_connections", credentialReferenceId: "credential_stripe_1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const credentialReference = {
      id: "credential_stripe_1", provider: "stripe_financial_connections", externalCredentialId: "fcsess_1",
      vaultReference: "vault://stripe_financial_connections/sessions/fcsess_1/state", status: "active" as const,
      createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const institutionReference = {
      id: "institution_stripe_1", connectionId: "connection_stripe_1", name: "Chase", type: "bank" as const, provider: "stripe_financial_connections",
      externalInstitutionId: "fcsess_1", createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z",
    };

    const harness = buildHarness();
    await seed(harness, { connection, credentialReference, institutionReference, ownerId });

    const stripeClient = {
      financialConnections: {
        sessions: { create: vi.fn(), retrieve: vi.fn() },
        accounts: {
          subscribe: vi.fn(), unsubscribe: vi.fn(), disconnect: vi.fn(),
          retrieve: vi.fn().mockResolvedValue({
            id: "fca_1", status: "active", category: "cash", subcategory: "checking",
            display_name: null, institution_name: "Chase", last4: null,
            balance: { as_of: 1768000000, type: "cash", current: { usd: 154302 }, cash: { available: { usd: 154302 } } },
            balance_refresh: { status: "succeeded", next_refresh_available_at: null },
          }),
          refresh: vi.fn(),
        },
        transactions: {
          list: vi.fn().mockResolvedValue({
            data: [{ id: "fcxtxn_1", account: "fca_1", amount: -1250, currency: "usd", description: "AMAZON.COM PURCHASE", status: "posted", transacted_at: 1768000000, status_transitions: { posted_at: 1768000000 }, transaction_refresh: "fctxnref_1" }],
            has_more: false,
          }),
        },
      },
      customers: { create: vi.fn() },
    };
    const vaultedState = JSON.stringify({ accountIds: ["fca_1"], transactionRefreshCursors: {} });
    const credentialVaultService = fakeCredentialVaultService({ [`${ownerId}:vault://stripe_financial_connections/sessions/fcsess_1/state`]: vaultedState });
    const provider = createStripeFinancialConnectionsAdapter({ credentialVaultService, stripeClient });

    const coordinator = buildCoordinator(harness, provider);
    const result = await coordinator.executeImport({ connectionId: connection.id, ownerId });

    expect(result.success).toBe(true);
    expect(result.failedRecordCount).toBe(0);

    const persistedAccounts = await harness.financialAccountRepository.findByConnection(connection.id);
    expect(persistedAccounts).toHaveLength(1);
    expect(persistedAccounts[0]).toMatchObject({
      providerAccountId: "fca_1", // NOT undefined -- proves no double-mapping through PlaidFinancialAccountMapper
      provider: "stripe_financial_connections", currencyCode: "USD", type: "depository",
    });

    const persistedBalances = await harness.accountBalanceRepository.findByConnection(connection.id);
    expect(persistedBalances).toHaveLength(1);
    expect(persistedBalances[0]).toMatchObject({ currentBalanceCents: 154302, currencyCode: "USD" });

    const persistedTransactions = await harness.transactionRepository.findByConnection(connection.id);
    expect(persistedTransactions).toHaveLength(1);
    expect(persistedTransactions[0]).toMatchObject({
      providerTransactionId: "fcxtxn_1",
      amountCents: 1250, // Stripe -1250 (debit) negated to canonical +1250 (outflow) -- survived the pipeline unflipped a second time
      date: "2026-01-09", pending: false, description: "AMAZON.COM PURCHASE",
    });
  });
});
