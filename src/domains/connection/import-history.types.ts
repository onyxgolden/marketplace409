export const IMPORT_HISTORY_TYPES = [
  "manual",
  "scheduled",
  "webhook",
  "csv_upload",
  "initial_sync",
  "refresh",
] as const;

export type ImportHistoryType = (typeof IMPORT_HISTORY_TYPES)[number];

export const IMPORT_HISTORY_STATUSES = [
  "pending",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
  "cancelled",
] as const;

export type ImportHistoryStatus = (typeof IMPORT_HISTORY_STATUSES)[number];

export type ImportHistory = Readonly<{
  id: string;
  connectionId: string;
  type: ImportHistoryType;
  status: ImportHistoryStatus;
  provider: string;
  recordsProcessed: number;
  recordsImported: number;
  recordsSkipped: number;
  recordsFailed: number;
  startedAt: string;
  completedAt?: string;
  durationMs?: number;
  errorMessage?: string;
  warningMessages?: readonly string[];
  createdAt: string;
  updatedAt: string;
}>;
