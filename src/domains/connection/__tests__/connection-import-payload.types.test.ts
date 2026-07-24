import { describe, expect, it } from "vitest";

import type {
  ConnectionImportPayload,
} from "../connection-import-payload.types";

describe("ConnectionImportPayload", () => {
  it("supports the canonical provider import payload shape", () => {
    const payload: ConnectionImportPayload = {
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
