import { describe, expect, it } from "vitest";

import {
  ConnectionProvisioningService,
} from "../connection-provisioning.service";

describe("ConnectionProvisioningService", () => {
  const service = new ConnectionProvisioningService();

  function makeInput() {
    return {
      credentialReference: {
        id: "credential_1",
        provider: "plaid",
        externalCredentialId: "item_1",
        vaultReference: "vault://provider/items/item_1/access-token",
        status: "active" as const,
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      connection: {
        id: "connection_1",
        userId: "user_1",
        name: "Operating Bank",
        type: "bank" as const,
        status: "connected" as const,
        provider: "plaid",
        credentialReferenceId: "credential_1",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      institutionReference: {
        id: "institution_1",
        connectionId: "connection_1",
        name: "Forge Bank",
        type: "bank" as const,
        provider: "plaid",
        externalInstitutionId: "ins_1",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      provisionedAt: "2026-07-02T00:00:00.000Z",
    };
  }

  it("returns a persistence-ready provisioning result", () => {
    const result = service.provision(makeInput());

    expect(result.readyForPersistence).toBe(true);
    expect(result.connection.id).toBe("connection_1");
    expect(result.credentialReference.id).toBe("credential_1");
    expect(result.institutionReference.id).toBe("institution_1");
  });

  it("throws when the credential reference does not match the connection", () => {
    const input = makeInput();

    input.connection.credentialReferenceId = "credential_2";

    expect(() => service.provision(input)).toThrow(
      "Connection credential reference does not match credential reference.",
    );
  });

  it("throws when the institution belongs to another connection", () => {
    const input = makeInput();

    input.institutionReference.connectionId = "connection_2";

    expect(() => service.provision(input)).toThrow(
      "Institution reference does not belong to the connection.",
    );
  });
});
