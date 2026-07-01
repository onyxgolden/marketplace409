import type {
  Connection,
} from "./connection.types";

import type {
  ConnectionStatusDetails,
} from "./connection-status.types";

import type {
  ConnectionCapabilities,
} from "./connection-capabilities.types";

import type {
  InstitutionReference,
} from "./institution-reference.types";

import type {
  ConnectionHealth,
} from "./connection-health.types";

export type ConnectionSummary = Readonly<{
  connection: Connection;
  statusDetails: ConnectionStatusDetails;
  capabilities: ConnectionCapabilities;
  institution: InstitutionReference;
  health: ConnectionHealth;
  createdAt: string;
  updatedAt: string;
}>;
