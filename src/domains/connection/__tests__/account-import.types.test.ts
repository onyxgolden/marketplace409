import {
  describe,
  expect,
  it,
} from "vitest";

import {
  toAccountImportResult,
  type AccountImportInput,
} from "../account-import.types";

describe("AccountImportResult", () => {
  it("marks persisted connection accounts as ready for transaction import", () => {
    const input: AccountImportInput = {
      connection: {
        id: "connection-1",
        userId: "user-1",
        name: "Sandbox Bank Connection",
        type: "bank",
        provider: "plaid",
        status: "connected",
        credentialReferenceId:
          "credential-1",
        createdAt:
          "2026-07-02T00:00:00.000Z",
        updatedAt:
          "2026-07-02T00:00:00.000Z",
      },
      credentialReference: {
        id: "credential-1",
        provider: "plaid",
        externalCredentialId: "item-1",
        vaultReference:
          "vault://provider/items/item-1/access-token",
        status: "active",
        createdAt:
          "2026-07-02T00:00:00.000Z",
        updatedAt:
          "2026-07-02T00:00:00.000Z",
      },
      institutionReference: {
        id: "institution-1",
        connectionId: "connection-1",
        provider: "plaid",
        externalInstitutionId: "ins_1",
        name: "Sandbox Bank",
        type: "bank",
        createdAt:
          "2026-07-02T00:00:00.000Z",
        updatedAt:
          "2026-07-02T00:00:00.000Z",
      },
      provisionedAt:
        "2026-07-02T01:00:00.000Z",
      persistedAt:
        "2026-07-02T02:00:00.000Z",
      readyForImport: true,
    };

    const result =
      toAccountImportResult(input, {
        provider: "plaid",
        connectionId: "connection-1",
        importedRecordCount: 3,
        skippedRecordCount: 1,
        failedRecordCount: 0,
        occurredAt:
          "2026-07-02T03:00:00.000Z",
      });

    expect(result.provider).toBe("plaid");
    expect(result.connectionId).toBe(
      "connection-1",
    );
    expect(result.success).toBe(true);
    expect(
      result.importedAccountCount,
    ).toBe(3);
    expect(
      result.skippedAccountCount,
    ).toBe(1);
    expect(
      result.failedAccountCount,
    ).toBe(0);
    expect(result.provisionedAt).toBe(
      "2026-07-02T01:00:00.000Z",
    );
    expect(result.persistedAt).toBe(
      "2026-07-02T02:00:00.000Z",
    );
    expect(result.importedAt).toBe(
      "2026-07-02T03:00:00.000Z",
    );
    expect(
      result.readyForTransactionImport,
    ).toBe(true);
  });
});
