import type { ConnectionStatusSeverity } from "./connection-status.types";

export const CONNECTION_HEALTH_STATES = [
  "healthy",
  "syncing",
  "stale",
  "needs_attention",
  "critical",
  "not_ready",
  // Deliberately disconnected/retired -- historical, not broken. Distinct from "critical"/
  // "needs_attention" (which both mean "requires user action") and from "not_ready" (which means
  // "not yet set up"): a retired connection needs no action at all, it is simply no longer active.
  "retired",
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
