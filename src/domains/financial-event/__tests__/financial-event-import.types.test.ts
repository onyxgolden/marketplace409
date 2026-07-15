import { describe, expect, it } from "vitest";
import { toTransactionImportResult } from "../../transaction";
import { toFinancialEventImportResult } from "../financial-event-import.types";

describe("FinancialEventImportResult", () => {
  it("marks imported financial events ready for ledger posting", () => {
    const transactionImport = toTransactionImportResult(
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
      [],
      "2026-07-01T00:04:00.000Z",
    );

    const result = toFinancialEventImportResult(
      transactionImport,
      [],
      "2026-07-01T00:05:00.000Z",
    );

    expect(result.provider).toBe("canonical-provider");
    expect(result.connectionId).toBe("connection-1");
    expect(result.importedFinancialEventCount).toBe(0);
    expect(result.skippedFinancialEventCount).toBe(0);
    expect(result.failedFinancialEventCount).toBe(0);
    expect(result.transactionsImportedAt).toBe("2026-07-01T00:04:00.000Z");
    expect(result.financialEventsImportedAt).toBe("2026-07-01T00:05:00.000Z");
    expect(result.readyForLedgerPosting).toBe(true);
  });
});
