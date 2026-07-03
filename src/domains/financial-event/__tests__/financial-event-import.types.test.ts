import { describe, expect, it } from "vitest";
import { toTransactionImportResult } from "../../transaction";
import { toFinancialEventImportResult } from "../financial-event-import.types";

describe("FinancialEventImportResult", () => {
  it("marks imported financial events ready for ledger posting", () => {
    const transactionImport = toTransactionImportResult(
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
