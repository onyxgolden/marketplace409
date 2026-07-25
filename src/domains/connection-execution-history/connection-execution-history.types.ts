export type ConnectionExecutionOperationType =
  | "import"
  | "review"
  | "repair";

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
}>;
