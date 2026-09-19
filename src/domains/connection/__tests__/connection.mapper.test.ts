import { describe, expect, it } from "vitest";
import {
  mapConnectionRowToConnection,
  type ConnectionRow,
} from "../connection.mapper";

const connectionRow = (
  overrides: Partial<ConnectionRow> = {},
): ConnectionRow => ({
  id: "connection_1",
  owner_id: "owner_1",
  name: "Sandbox Bank",
  type: "bank",
  status: "connected",
  provider: "test_provider",
  credential_reference_id: "credential_ref_1",
  last_imported_at: "2026-09-01T12:00:00.000Z",
  created_at: "2026-08-01T00:00:00.000Z",
  updated_at: "2026-09-01T12:00:00.000Z",
  ...overrides,
});

describe("mapConnectionRowToConnection", () => {
  it("maps every snake_case column to its camelCase domain field", () => {
    const connection = mapConnectionRowToConnection(connectionRow());

    expect(connection).toEqual({
      id: "connection_1",
      userId: "owner_1",
      name: "Sandbox Bank",
      type: "bank",
      status: "connected",
      provider: "test_provider",
      credentialReferenceId: "credential_ref_1",
      lastImportedAt: "2026-09-01T12:00:00.000Z",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    });
  });

  it("omits credentialReferenceId when the row has no credential reference", () => {
    const connection = mapConnectionRowToConnection(
      connectionRow({ credential_reference_id: null }),
    );

    expect(connection).not.toHaveProperty("credentialReferenceId");
    expect(connection.credentialReferenceId).toBeUndefined();
  });

  it("omits lastImportedAt when the connection was never imported", () => {
    const connection = mapConnectionRowToConnection(
      connectionRow({ last_imported_at: null }),
    );

    expect(connection).not.toHaveProperty("lastImportedAt");
    expect(connection.lastImportedAt).toBeUndefined();
  });

  it("maps a never-imported connection with no credential reference", () => {
    const connection = mapConnectionRowToConnection(
      connectionRow({
        credential_reference_id: null,
        last_imported_at: null,
      }),
    );

    expect(connection).toEqual({
      id: "connection_1",
      userId: "owner_1",
      name: "Sandbox Bank",
      type: "bank",
      status: "connected",
      provider: "test_provider",
      createdAt: "2026-08-01T00:00:00.000Z",
      updatedAt: "2026-09-01T12:00:00.000Z",
    });
  });
});
