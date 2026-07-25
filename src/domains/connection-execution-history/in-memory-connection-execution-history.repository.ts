import type {
  ConnectionExecutionHistoryRepository,
  ConnectionExecutionHistoryPersistenceContext,
} from "./connection-execution-history.repository";

import type {
  ConnectionExecutionHistory,
} from "./connection-execution-history.types";

export class InMemoryConnectionExecutionHistoryRepository
  implements ConnectionExecutionHistoryRepository
{
  private readonly records: ConnectionExecutionHistory[] = [];

  async save(
    executionHistory: ConnectionExecutionHistory,
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<ConnectionExecutionHistory> {
    if (
      context &&
      executionHistory.ownerId !== context.ownerId
    ) {
      throw new Error(
        "Connection execution history owner mismatch.",
      );
    }

    this.records.push(executionHistory);

    return executionHistory;
  }

  async findByConnectionId(
    connectionId: string,
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<readonly ConnectionExecutionHistory[]> {
    return this.records.filter(
      (record) =>
        record.connectionId === connectionId &&
        (!context ||
          record.ownerId === context.ownerId),
    );
  }

  async findByOwnerId(
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<readonly ConnectionExecutionHistory[]> {
    return this.records.filter(
      (record) =>
        !context ||
        record.ownerId === context.ownerId,
    );
  }

  async findRecentByOwnerId(
    limit: number,
    context?: ConnectionExecutionHistoryPersistenceContext,
  ): Promise<readonly ConnectionExecutionHistory[]> {
    return (
      await this.findByOwnerId(context)
    )
      .slice()
      .sort(
        (a, b) =>
          Date.parse(b.createdAt) -
          Date.parse(a.createdAt),
      )
      .slice(0, limit);
  }
}
