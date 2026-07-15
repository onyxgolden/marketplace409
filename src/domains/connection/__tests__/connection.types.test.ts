import {
  describe,
  expect,
  it,
} from "vitest";

import {
  CONNECTION_STATUSES,
  CONNECTION_TYPES,
  type Connection,
} from "../connection.types";

describe("Connection domain types", () => {
  it("supports the first FORGE connection sources", () => {
    expect(CONNECTION_TYPES).toContain("bank");
    expect(CONNECTION_TYPES).toContain("credit_card");
    expect(CONNECTION_TYPES).toContain("stripe");
    expect(CONNECTION_TYPES).toContain("quickbooks");
    expect(CONNECTION_TYPES).toContain("rentec");
    expect(CONNECTION_TYPES).toContain("csv");
  });

  it("supports lifecycle statuses for future integrations", () => {
    expect(CONNECTION_STATUSES).toContain("not_connected");
    expect(CONNECTION_STATUSES).toContain("pending");
    expect(CONNECTION_STATUSES).toContain("connected");
    expect(CONNECTION_STATUSES).toContain("syncing");
    expect(CONNECTION_STATUSES).toContain("needs_attention");
    expect(CONNECTION_STATUSES).toContain("disconnected");
    expect(CONNECTION_STATUSES).toContain("error");
  });

  it("represents an immutable external financial connection", () => {
    const connection: Connection = {
      id: "connection_001",
      userId: "user_001",
      name: "Operating Bank Account",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_001",
      lastImportedAt: "2026-06-30T22:00:00.000Z",
      createdAt: "2026-06-30T21:00:00.000Z",
      updatedAt: "2026-06-30T22:00:00.000Z",
    };

    expect(connection).toEqual({
      id: "connection_001",
      userId: "user_001",
      name: "Operating Bank Account",
      type: "bank",
      status: "connected",
      provider: "plaid",
      credentialReferenceId: "credential_001",
      lastImportedAt: "2026-06-30T22:00:00.000Z",
      createdAt: "2026-06-30T21:00:00.000Z",
      updatedAt: "2026-06-30T22:00:00.000Z",
    });
  });
});
