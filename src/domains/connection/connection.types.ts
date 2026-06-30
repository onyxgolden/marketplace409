export const CONNECTION_TYPES = [
  "bank",
  "credit_card",
  "stripe",
  "quickbooks",
  "rentec",
  "csv",
  "manual",
  "future_integration",
] as const;

export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_STATUSES = [
  "not_connected",
  "pending",
  "connected",
  "syncing",
  "needs_attention",
  "disconnected",
  "error",
] as const;

export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export type Connection = Readonly<{
  id: string;
  userId: string;
  name: string;
  type: ConnectionType;
  status: ConnectionStatus;
  provider: string;
  credentialReferenceId?: string;
  lastImportedAt?: string;
  createdAt: string;
  updatedAt: string;
}>;
