import { describe, expect, it } from "vitest";

import {
  ConnectionImportOrchestrator,
} from "../connection-import-orchestrator.service";

import {
  createPlaidAdapter,
} from "../../plaid-adapter";

describe("ConnectionImportOrchestrator", () => {
  it("imports through the configured provider contract", async () => {
    const orchestrator = new ConnectionImportOrchestrator({
      provider: createPlaidAdapter(),
    });

    const result = await orchestrator.importConnection({
      connection: {
        id: "connection_1",
        userId: "user_1",
        name: "Checking",
        type: "bank",
        status: "connected",
        provider: "plaid",
        credentialReferenceId: "credential_1",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    });

    expect(result).toMatchObject({
      provider: "plaid",
      connectionId: "connection_1",
      success: true,
      importedRecordCount: 0,
      skippedRecordCount: 0,
      failedRecordCount: 0,
    });
  });

  it("rejects connections that do not match the configured provider", async () => {
    const orchestrator = new ConnectionImportOrchestrator({
      provider: createPlaidAdapter(),
    });

    await expect(
      orchestrator.importConnection({
        connection: {
          id: "connection_2",
          userId: "user_1",
          name: "Stripe",
          type: "stripe",
          status: "connected",
          provider: "stripe",
          credentialReferenceId: "credential_2",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      }),
    ).rejects.toThrow("Connection provider does not match orchestrator provider.");
  });
});
