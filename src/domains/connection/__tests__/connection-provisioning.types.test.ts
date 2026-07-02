import { describe, expect, it } from "vitest";

import {
  toConnectionProvisioningResult,
} from "../connection-provisioning.types";

describe("ConnectionProvisioningResult", () => {
  it("packages mapped connection objects for persistence", () => {
    const result = toConnectionProvisioningResult({
      provisionedAt: "2026-07-02T00:00:00.000Z",
      credentialReference: {
        id: "credential_1",
        provider: "plaid",
        externalCredentialId: "item_1",
        vaultReference: "vault://provider/items/item_1/access-token",
        status: "active",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      connection: {
        id: "connection_1",
        userId: "user_1",
        name: "Operating Bank",
        type: "bank",
        status: "connected",
        provider: "plaid",
        credentialReferenceId: "credential_1",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
      institutionReference: {
        id: "institution_1",
        connectionId: "connection_1",
        name: "Forge Bank",
        type: "bank",
        provider: "plaid",
        externalInstitutionId: "ins_1",
        createdAt: "2026-07-02T00:00:00.000Z",
        updatedAt: "2026-07-02T00:00:00.000Z",
      },
    });

    expect(result.readyForPersistence).toBe(true);
    expect(result.provisionedAt).toBe("2026-07-02T00:00:00.000Z");
    expect(result.connection.id).toBe("connection_1");
    expect(result.credentialReference.id).toBe("credential_1");
    expect(result.institutionReference.id).toBe("institution_1");
  });
});
