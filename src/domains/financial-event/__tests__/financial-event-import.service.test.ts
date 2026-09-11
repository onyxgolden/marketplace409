import { describe, expect, it } from "vitest";
import { toTransactionImportResult, type Transaction } from "../../transaction";
import { InMemoryFinancialEventRepository } from "../InMemoryFinancialEventRepository";
import { FinancialWorkspaceQueryService } from "../../../application/financial/FinancialWorkspaceQueryService.js";
import { FinancialEventImportService } from "../financial-event-import.service";
import { PlaidTransactionMapper } from "../../plaid-adapter/plaid-transaction.mapper";
import { StripeFinancialConnectionsTransactionMapper } from "../../stripe-financial-connections-adapter/stripe-financial-connections-transaction.mapper";
import type { PlaidTransaction } from "../../plaid-adapter/plaid-transaction.types";
import type { StripeFinancialConnectionsTransaction } from "../../stripe-financial-connections-adapter/stripe-financial-connections-transaction.types";

function buildTransaction(overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: "transaction-1",
    financialAccountId: "financial-account-1",
    connectionId: "connection-1",
    provider: "canonical-provider",
    providerTransactionId: "provider-transaction-1",
    providerAccountId: "provider-account-1",
    amountCents: 12500,
    currencyCode: "USD",
    date: "2026-07-01",
    description: "Repairs (170 John)",
    merchantName: null,
    category: ["Service", "Repair"],
    pending: false,
    raw: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildTransactionImport(transactions: readonly Transaction[]) {
  return toTransactionImportResult(
    {
      connection: {
        id: "connection-1",
        userId: "user-1",
        name: "Canonical Connection",
        type: "bank",
        status: "connected",
        provider: "canonical-provider",
        credentialReferenceId: "credential-1",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      credentialReference: {
        id: "credential-1",
        provider: "canonical-provider",
        externalCredentialId: "credential-external-1",
        vaultReference:
          "vault://canonical/credentials/credential-1",
        status: "active",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      institutionReference: {
        id: "institution-1",
        connectionId: "connection-1",
        name: "Canonical Institution",
        type: "bank",
        provider: "canonical-provider",
        externalInstitutionId:
          "institution-external-1",
        createdAt: "2026-07-01T00:00:00.000Z",
        updatedAt: "2026-07-01T00:00:00.000Z",
      },
      provider: "canonical-provider",
      connectionId: "connection-1",
      success: true,
      financialAccounts: [],
      importedFinancialAccountCount: 0,
      skippedFinancialAccountCount: 0,
      failedFinancialAccountCount: 0,
      provisionedAt: "2026-07-01T00:00:00.000Z",
      persistedAt: "2026-07-01T00:01:00.000Z",
      importedAt: "2026-07-01T00:02:00.000Z",
      financialAccountsImportedAt:
        "2026-07-01T00:03:00.000Z",
      readyForBalanceImport: true,
    },
    transactions,
    "2026-07-01T00:04:00.000Z",
  );
}

describe("FinancialEventImportService", () => {
  it("imports canonical transactions as financial events", async () => {
    const repository = new InMemoryFinancialEventRepository();
    const service = new FinancialEventImportService({
      repository,
      ownerId: "owner-1",
    });

    const result = await service.import(
      buildTransactionImport([buildTransaction()]),
    );

    expect(result.readyForLedgerPosting).toBe(true);
    expect(result.importedFinancialEventCount).toBe(1);
    expect(repository.count()).toBe(1);

    const [event] = result.financialEvents;

    expect(event.owner_id).toBe("owner-1");
    expect(event.event_date).toBe("2026-07-01");
    expect(event.description).toBe("Repairs (170 John)");
    // 12500 minor units (amountCents) -> $125.00 decimal dollars -- the corrected conversion.
    expect(event.amount).toBe(125);
    expect(event.source_system).toBe("transaction");
    expect(event.source_record_id).toBe("transaction-1");
    expect(event.property_id).toBe("unknown-property");
    expect(event.normalized_category).toBe("property_repairs");
    expect(event.transaction_kind).toBe("expense");
    expect(event.metadata).toMatchObject({
      connectionId: "connection-1",
      financialAccountId: "financial-account-1",
      provider: "canonical-provider",
      providerAccountId: "provider-account-1",
      providerTransactionId: "provider-transaction-1",
      currencyCode: "USD",
      category: ["Service", "Repair"],
      pending: false,
      merchantName: null,
      raw: null,
    });
  });

  it("uses merchant name for knowledge normalization when available", async () => {
    const repository = new InMemoryFinancialEventRepository();
    const service = new FinancialEventImportService({
      repository,
    });

    const result = await service.import(
      buildTransactionImport([
        buildTransaction({
          description: "External Bank Description",
          merchantName: "Property Tax",
        }),
      ]),
    );

    const [event] = result.financialEvents;

    expect(event.description).toBe("External Bank Description");
    expect(event.normalized_category).toBe("property_tax");
  });

  it("projects imported financial events into the owner workspace", async () => {
    const repository = new InMemoryFinancialEventRepository();

    const importService = new FinancialEventImportService({
      repository,
      ownerId: "owner-1",
    });

    await importService.import(
      buildTransactionImport([buildTransaction()]),
    );

    const workspaceQueryService =
      new FinancialWorkspaceQueryService({
        financialEventRepository: repository,
      } as never);

    const workspace =
      await workspaceQueryService.buildWorkspace("owner-1");

    expect(repository.count()).toBe(1);

    expect(workspace.portfolio).toMatchObject({
      expenses: 125,
      cashFlow: -125,
      transactionCount: 1,
    });

    expect(workspace.transactions).toHaveLength(1);
    expect(workspace.transactions[0]).toMatchObject({
      description: "Repairs (170 John)",
      amount: 125,
      transactionKind: "expense",
      category: "property_repairs",
      sourceSystem: "transaction",
      sourceRecordId: "transaction-1",
    });

    const unrelatedOwnerWorkspace =
      await workspaceQueryService.buildWorkspace("owner-2");

    expect(unrelatedOwnerWorkspace.portfolio.transactionCount).toBe(0);
    expect(unrelatedOwnerWorkspace.transactions).toEqual([]);
  });

  // Provider-contract tests: these run the REAL provider mappers (not a hand-built Transaction
  // fixture) through the REAL import service, proving the whole Transaction-to-FinancialEvent
  // pipeline -- not just the conversion helper in isolation -- produces the correct canonical
  // dollar amount for both providers, with exactly one conversion applied, matching the production
  // regression this corrects (marketplace409 issue: 209 real Stripe Financial Connections rows
  // were persisted ~100x overstated because this exact boundary skipped the conversion).
  describe("provider-contract: Transaction.amountCents -> FinancialEvent.amount is dollars, applied exactly once", () => {
    async function importOneTransaction(transaction: Transaction) {
      const repository = new InMemoryFinancialEventRepository();
      const service = new FinancialEventImportService({ repository, ownerId: "owner-1" });
      const result = await service.import(buildTransactionImport([transaction]));
      return result.financialEvents[0];
    }

    it("Stripe: a real 'Rocket Rides' outflow (-1000 raw Stripe minor units) becomes exactly $10.00, expense direction", async () => {
      const mapper = new StripeFinancialConnectionsTransactionMapper();
      const stripeTransaction: StripeFinancialConnectionsTransaction = {
        transactionId: "fctxn_rocket_rides",
        accountId: "fca_test",
        amount: -1000, // Stripe's own raw amount -- verified live, negative = outflow.
        currency: "usd",
        description: "Rocket Rides",
        status: "posted",
        transactedAt: "2026-07-01T00:00:00.000Z",
        statusTransitionedAt: "2026-07-01T00:00:05.000Z",
        transactionRefreshId: "refresh_1",
      };
      const mappedTransaction = mapper.map(
        stripeTransaction, "connection-1", "stripe_financial_connections", "financial-account-1", "provider-account-1",
      );

      // The mapper's own contract: canonical amountCents is positive for an outflow/expense.
      expect(mappedTransaction.amountCents).toBe(1000);

      const event = await importOneTransaction(mappedTransaction);
      expect(event.amount).toBe(10);
      expect(event.transaction_kind).toBe("expense");
    });

    it("Plaid: an equivalent $10.00 outflow produces the SAME canonical FinancialEvent.amount as the Stripe case above", async () => {
      const mapper = new PlaidTransactionMapper();
      const plaidTransaction: PlaidTransaction = {
        transactionId: "plaid_txn_1",
        accountId: "plaid_account_1",
        date: "2026-07-01",
        name: "Rocket Rides",
        amount: 10.0, // Plaid's own documented convention: positive = outflow, already in dollars.
      };
      const mappedTransaction = mapper.map(
        plaidTransaction, "connection-1", "plaid", "financial-account-1", "provider-account-1",
      );

      expect(mappedTransaction.amountCents).toBe(1000);

      const event = await importOneTransaction(mappedTransaction);
      expect(event.amount).toBe(10);
      expect(event.transaction_kind).toBe("expense");
    });

    it("Stripe: a real inflow (positive raw Stripe amount) becomes a negative canonical dollar amount (income direction)", async () => {
      const mapper = new StripeFinancialConnectionsTransactionMapper();
      const stripeTransaction: StripeFinancialConnectionsTransaction = {
        transactionId: "fctxn_typographic",
        accountId: "fca_test",
        amount: 2500, // Positive raw Stripe amount = inflow, per the mapper's verified convention.
        currency: "usd",
        description: "Typographic",
        status: "posted",
        transactedAt: "2026-07-01T00:00:00.000Z",
        statusTransitionedAt: "2026-07-01T00:00:05.000Z",
        transactionRefreshId: "refresh_1",
      };
      const mappedTransaction = mapper.map(
        stripeTransaction, "connection-1", "stripe_financial_connections", "financial-account-1", "provider-account-1",
      );

      expect(mappedTransaction.amountCents).toBe(-2500);

      const event = await importOneTransaction(mappedTransaction);
      // transaction_kind is derived from category/description keyword matching (categoryNormalizer),
      // not from amount's sign -- so "direction" here is verified via the signed amount itself, the
      // actual value this fix corrects.
      expect(event.amount).toBe(-25);
      expect(event.amount).toBeLessThan(0);
    });

    it("preserves exact cent precision through the full pipeline for a non-round amount ($10.01)", async () => {
      const mapper = new StripeFinancialConnectionsTransactionMapper();
      const stripeTransaction: StripeFinancialConnectionsTransaction = {
        transactionId: "fctxn_precise",
        accountId: "fca_test",
        amount: -1001,
        currency: "usd",
        description: "Precise Amount Co",
        status: "posted",
        transactedAt: "2026-07-01T00:00:00.000Z",
        statusTransitionedAt: "2026-07-01T00:00:05.000Z",
        transactionRefreshId: "refresh_1",
      };
      const mappedTransaction = mapper.map(
        stripeTransaction, "connection-1", "stripe_financial_connections", "financial-account-1", "provider-account-1",
      );
      const event = await importOneTransaction(mappedTransaction);
      expect(event.amount).toBe(10.01);
    });

    it("preserves exact precision for a single cent", async () => {
      const event = await importOneTransaction(
        buildTransaction({ amountCents: 1 }),
      );
      expect(event.amount).toBe(0.01);
    });

    it("converts zero correctly", async () => {
      const event = await importOneTransaction(
        buildTransaction({ amountCents: 0 }),
      );
      expect(event.amount).toBe(0);
    });

    it("preserves exact precision for a large real-world amount matching the production regression's largest corrupted row ($3,000,000 stored, true value $30,000.00)", async () => {
      const event = await importOneTransaction(
        buildTransaction({ amountCents: 3_000_000 }), // 3,000,000 minor units = $30,000.00
      );
      expect(event.amount).toBe(30_000);
    });

    it("applies the conversion exactly once -- does not double-convert (the value is not additionally divided or multiplied by 100 anywhere else in the pipeline)", async () => {
      // If any other layer (factory, repository) also divided or multiplied by 100, this would be
      // 1.25 or 12500 instead of 125 -- this test exists specifically to catch that class of
      // regression, distinct from the "converts correctly" tests above.
      const event = await importOneTransaction(buildTransaction({ amountCents: 12_500 }));
      expect(event.amount).toBe(125);
      expect(event.amount).not.toBe(1.25);
      expect(event.amount).not.toBe(12_500);
    });
  });
});
