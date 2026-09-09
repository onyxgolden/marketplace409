export type ConnectionExecutionOperationType =
  | "import"
  | "review"
  | "repair"
  | "connect"
  | "disconnect";

export type ConnectionExecutionStatus =
  | "success"
  | "failed"
  | "completed";

export type ConnectionExecutionHistory = Readonly<{
  id: string;
  ownerId: string;
  connectionId: string;
  operationType: ConnectionExecutionOperationType;
  status: ConnectionExecutionStatus;
  provider: string | null;
  startedAt: string;
  completedAt: string;
  metrics: Readonly<Record<string, unknown>>;
  errorDetails: unknown | null;
  createdAt: string;
  // The authenticated user who actually triggered this execution -- distinct from ownerId, which
  // is the shared workspace it ran for (a co-owner and the primary owner share the same ownerId
  // but must remain distinguishable here). Optional/nullable: existing Plaid rows predate this
  // field and are never backfilled.
  actorUserId?: string | null;
}>;
