import { describe, expect, it } from "vitest";

import {
  toConnectionPersistenceResult,
  type ConnectionPersistenceInput,
} from "../connection-persistence.types";

describe("ConnectionPersistenceResult", () => {
  it("marks a provisioned connection as ready for import", () => {
    const input: ConnectionPersistenceInput = {
      connection: {
        id: "connection-1",
        provider: "plaid",
        externalConnectionId: "item-1",
        status: "connected",
        credentialReferenceId: "credential-1",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      credentialReference: {
        id: "credential-1",
        provider: "plaid",
        externalCredentialId: "item-1",
        status: "active",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      institutionReference: {
        id: "institution-1",
        connectionId: "connection-1",
        provider: "plaid",
        externalInstitutionId: "ins_1",
        name: "Sandbox Bank",
        type: "bank",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      provisionedAt: "2026-07-02T01:00:00.000Z",
      readyForPersistence: true,
    };

    const result = toConnectionPersistenceResult(
      input,
      "2026-07-02T02:00:00.000Z",
    );

    expect(result.provisionedAt).toBe("2026-07-02T01:00:00.000Z");
    expect(result.persistedAt).toBe("2026-07-02T02:00:00.000Z");
    expect(result.readyForImport).toBe(true);
  });
});
