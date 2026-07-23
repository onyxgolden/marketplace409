import type {
  Connection,
  ConnectionStatus,
  ConnectionType,
} from "./connection.types";

export type ConnectionRow = Readonly<{
  id: string;
  owner_id: string;
  name: string;
  type: ConnectionType;
  status: ConnectionStatus;
  provider: string;
  credential_reference_id: string | null;
  last_imported_at: string | null;
  created_at: string;
  updated_at: string;
}>;

export function mapConnectionRowToConnection(
  row: ConnectionRow,
): Connection {
  return {
    id: row.id,
    userId: row.owner_id,
    name: row.name,
    type: row.type,
    status: row.status,
    provider: row.provider,
    ...(row.credential_reference_id
      ? {
          credentialReferenceId:
            row.credential_reference_id,
        }
      : {}),
    ...(row.last_imported_at
      ? {
          lastImportedAt:
            row.last_imported_at,
        }
      : {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
