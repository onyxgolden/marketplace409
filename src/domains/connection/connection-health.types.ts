import type { ConnectionStatusSeverity } from "./connection-status.types";

export const CONNECTION_HEALTH_STATES = [
  "healthy",
  "syncing",
  "stale",
  "needs_attention",
  "critical",
  "not_ready",
] as const;

export type ConnectionHealthState =
  (typeof CONNECTION_HEALTH_STATES)[number];

export type ConnectionHealth = Readonly<{
  connectionId: string;
  state: ConnectionHealthState;
  severity: ConnectionStatusSeverity;
  label: string;
  allowsImport: boolean;
  requiresUserAction: boolean;
  lastSuccessfulImportAt?: string;
  lastFailedImportAt?: string;
  issueCount: number;
  warningCount: number;
  checkedAt: string;
}>;
