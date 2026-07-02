import { describe, expect, it } from "vitest";

import {
  mapPlaidExchangeToConnection,
} from "../plaid-connection.mapper";

describe("mapPlaidExchangeToConnection", () => {
  it("creates provider-agnostic connection objects from a Plaid exchange", () => {
    const result = mapPlaidExchangeToConnection({
      userId: "user_123",
      now: "2026-07-02T00:00:00.000Z",
      exchange: {
        accessToken: "access-sandbox-123",
        itemId: "item-sandbox-123",
      },
    });

    expect(result.credentialReference).toEqual({
      id: "credential_plaid_item-sandbox-123",
      provider: "plaid",
      externalCredentialId: "item-sandbox-123",
      vaultReference: "vault://plaid/items/item-sandbox-123/access-token",
      status: "active",
      lastValidatedAt: "2026-07-02T00:00:00.000Z",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(result.connection).toEqual({
      id: "connection_plaid_item-sandbox-123",
      userId: "user_123",
      name: "Plaid Bank Connection",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_plaid_item-sandbox-123",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });

    expect(result.institutionReference).toEqual({
      id: "institution_plaid_item-sandbox-123",
      connectionId: "connection_plaid_item-sandbox-123",
      name: "Plaid Institution",
      type: "bank",
      provider: "plaid",
      externalInstitutionId: "item-sandbox-123",
      createdAt: "2026-07-02T00:00:00.000Z",
      updatedAt: "2026-07-02T00:00:00.000Z",
    });
  });
});
