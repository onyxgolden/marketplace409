import { describe, expect, it } from "vitest";
import {
  mapStripeFinancialConnectionsSessionToConnection,
  parseVaultedState,
  serializeVaultedState,
} from "../stripe-financial-connections-connection.mapper";

describe("mapStripeFinancialConnectionsSessionToConnection", () => {
  it("maps a completed session into connection/credentialReference/institutionReference, all namespaced by session id", () => {
    const result = mapStripeFinancialConnectionsSessionToConnection({
      userId: "owner_1",
      sessionId: "fcsess_1",
      accounts: [{ accountId: "fca_1", displayName: "Checking", institutionName: "Chase" }],
      now: "2026-01-01T00:00:00.000Z",
    });

    expect(result.connection).toMatchObject({
      id: "connection_stripe_financial_connections_fcsess_1",
      userId: "owner_1",
      type: "bank",
      status: "connected",
      provider: "stripe_financial_connections",
    });
    expect(result.credentialReference).toMatchObject({
      id: "credential_stripe_financial_connections_fcsess_1",
      provider: "stripe_financial_connections",
      externalCredentialId: "fcsess_1",
      status: "active",
    });
    expect(result.institutionReference).toMatchObject({ name: "Chase", provider: "stripe_financial_connections" });
    expect(result.connection.credentialReferenceId).toBe(result.credentialReference.id);
  });

  it("the vaulted credentialSecret carries the account ids and an empty cursor map -- round-trips through parse/serialize", () => {
    const result = mapStripeFinancialConnectionsSessionToConnection({
      userId: "owner_1",
      sessionId: "fcsess_1",
      accounts: [{ accountId: "fca_1", displayName: null, institutionName: null }, { accountId: "fca_2", displayName: null, institutionName: null }],
    });

    const parsed = parseVaultedState(result.credentialSecret);
    expect(parsed.accountIds).toEqual(["fca_1", "fca_2"]);
    expect(parsed.transactionRefreshCursors).toEqual({});
    expect(serializeVaultedState(parsed)).toBe(JSON.stringify(parsed));
  });

  it("falls back to a generic institution name when no account reports one", () => {
    const result = mapStripeFinancialConnectionsSessionToConnection({
      userId: "owner_1", sessionId: "fcsess_1", accounts: [{ accountId: "fca_1", displayName: null, institutionName: null }],
    });
    expect(result.institutionReference.name).toBe("Stripe Financial Connections institution");
  });
});

describe("parseVaultedState", () => {
  it("defaults to empty arrays/objects for a malformed or legacy-shaped stored value", () => {
    const parsed = parseVaultedState(JSON.stringify({}));
    expect(parsed.accountIds).toEqual([]);
    expect(parsed.transactionRefreshCursors).toEqual({});
  });
});
