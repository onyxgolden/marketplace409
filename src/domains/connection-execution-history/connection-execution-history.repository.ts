import type {
  ConnectionExecutionHistory,
} from "./connection-execution-history.types";

export type ConnectionExecutionHistoryPersistenceContext =
  Readonly<{
    ownerId: string;
  }>;

export interface ConnectionExecutionHistoryRepository {
  save(
    executionHistory: ConnectionExecutionHistory,
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<ConnectionExecutionHistory>;

  findByConnectionId(
    connectionId: string,
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<readonly ConnectionExecutionHistory[]>;

  findByOwnerId(
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<readonly ConnectionExecutionHistory[]>;

  findRecentByOwnerId(
    limit: number,
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<readonly ConnectionExecutionHistory[]>;
}
