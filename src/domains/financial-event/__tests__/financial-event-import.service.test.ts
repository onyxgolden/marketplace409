import { describe, expect, it } from "vitest";
import { toTransactionImportResult, type Transaction } from "../../transaction";
import { InMemoryFinancialEventRepository } from "../InMemoryFinancialEventRepository";
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
      },
      credentialReference: {
        id: "credential-1",
      },
      institutionReference: {
        id: "institution-1",
      },
      provider: "canonical-provider",
      connectionId: "connection-1",
      success: true,
      financialAccounts: [],
      importedAccountCount: 0,
      skippedAccountCount: 0,
      failedAccountCount: 0,
      provisionedAt: "2026-07-01T00:00:00.000Z",
      persistedAt: "2026-07-01T00:01:00.000Z",
      importedAt: "2026-07-01T00:02:00.000Z",
      financialAccountsImportedAt: "2026-07-01T00:03:00.000Z",
      readyForBalanceImport: true,
    },
    transactions,
    "2026-07-01T00:04:00.000Z",
  );
}

describe("FinancialEventImportService", () => {
  it("imports canonical transactions as financial events", () => {
    const repository = new InMemoryFinancialEventRepository();
    const service = new FinancialEventImportService({
      repository,
      ownerId: "owner-1",
    });

    const result = service.import(
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

  it("uses merchant name for knowledge normalization when available", () => {
    const repository = new InMemoryFinancialEventRepository();
    const service = new FinancialEventImportService({
      repository,
    });

    const result = service.import(
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
});
