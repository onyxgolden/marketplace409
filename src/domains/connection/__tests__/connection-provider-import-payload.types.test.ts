import { describe, expect, it } from "vitest";

import type {
  ConnectionProviderImportPayload,
} from "../connection-provider.types";

describe("ConnectionProviderImportPayload", () => {
  it("supports the canonical provider payload contract", () => {
    const payload: ConnectionProviderImportPayload = {
      provider: "plaid",
      connectionId: "connection_1",
      accounts: [],
      balances: [],
      transactions: [],
      occurredAt: "2026-01-01T00:00:00.000Z",
    };

    expect(payload.provider).toBe("plaid");
    expect(payload.connectionId).toBe("connection_1");
    expect(payload.accounts).toEqual([]);
    expect(payload.balances).toEqual([]);
    expect(payload.transactions).toEqual([]);
  });
});
