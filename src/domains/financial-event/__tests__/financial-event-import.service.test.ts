import { describe, expect, it } from "vitest";
import { toTransactionImportResult, type Transaction } from "../../transaction";
import { InMemoryFinancialEventRepository } from "../InMemoryFinancialEventRepository";
import { FinancialWorkspaceQueryService } from "../../../application/financial/FinancialWorkspaceQueryService.js";
import { FinancialEventImportService } from "../financial-event-import.service";

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
    expect(event.amount).toBe(12500);
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
      });

    const workspace =
      await workspaceQueryService.buildWorkspace("owner-1");

    expect(repository.count()).toBe(1);

    expect(workspace.portfolio).toMatchObject({
      expenses: 12500,
      cashFlow: -12500,
      transactionCount: 1,
    });

    expect(workspace.transactions).toHaveLength(1);
    expect(workspace.transactions[0]).toMatchObject({
      description: "Repairs (170 John)",
      amount: 12500,
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
});
