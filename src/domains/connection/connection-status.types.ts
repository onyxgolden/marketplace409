import type { ConnectionStatus } from "./connection.types";

export type ConnectionStatusSeverity =
  | "neutral"
  | "healthy"
  | "in_progress"
  | "warning"
  | "critical";

export type ConnectionStatusDetails = Readonly<{
  status: ConnectionStatus;
  label: string;
  severity: ConnectionStatusSeverity;
  requiresUserAction: boolean;
  allowsImport: boolean;
}>;

export const CONNECTION_STATUS_DETAILS: Record<
  ConnectionStatus,
  ConnectionStatusDetails
> = {
  not_connected: {
    status: "not_connected",
    label: "Not Connected",
    severity: "neutral",
    requiresUserAction: true,
    allowsImport: false,
  },
  pending: {
    status: "pending",
    label: "Pending",
    severity: "in_progress",
    requiresUserAction: false,
    allowsImport: false,
  },
  connected: {
    status: "connected",
    label: "Connected",
    severity: "healthy",
    requiresUserAction: false,
    allowsImport: true,
  },
  syncing: {
    status: "syncing",
    label: "Syncing",
    severity: "in_progress",
    requiresUserAction: false,
    allowsImport: true,
  },
  needs_attention: {
    status: "needs_attention",
    label: "Needs Attention",
    severity: "warning",
    requiresUserAction: true,
    allowsImport: false,
  },
  disconnected: {
    status: "disconnected",
    label: "Disconnected",
    severity: "warning",
    requiresUserAction: true,
    allowsImport: false,
  },
  error: {
    status: "error",
    label: "Error",
    severity: "critical",
    requiresUserAction: true,
    allowsImport: false,
  },
};

export function getConnectionStatusDetails(
  status: ConnectionStatus,
): ConnectionStatusDetails {
  return CONNECTION_STATUS_DETAILS[status];
}
