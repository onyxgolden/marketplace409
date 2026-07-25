export class ConnectionExecutionHistoryQueryService {
  constructor({
    connectionExecutionHistoryRepository,
  } = {}) {
    if (
      !connectionExecutionHistoryRepository ||
      typeof connectionExecutionHistoryRepository
        .findByConnectionId !== "function" ||
      typeof connectionExecutionHistoryRepository
        .findByOwnerId !== "function" ||
      typeof connectionExecutionHistoryRepository
        .findRecentByOwnerId !== "function"
    ) {
      throw new Error(
        "ConnectionExecutionHistoryQueryService requires a connection execution history repository.",
      );
    }

    this.connectionExecutionHistoryRepository =
      connectionExecutionHistoryRepository;

    Object.freeze(this);
  }

  async findByOwnerId(ownerId) {
    this.requireOwnerId(ownerId);

    return this.connectionExecutionHistoryRepository
      .findByOwnerId({
        ownerId,
      });
  }

  async findByConnectionId(
    ownerId,
    connectionId,
  ) {
    this.requireOwnerId(ownerId);
    this.requireConnectionId(connectionId);

    return this.connectionExecutionHistoryRepository
      .findByConnectionId(
        connectionId,
        {
          ownerId,
        },
      );
  }

  async findRecentByOwnerId(
    ownerId,
    limit = 20,
  ) {
    this.requireOwnerId(ownerId);

    if (
      !Number.isInteger(limit) ||
      limit <= 0
    ) {
      throw new Error(
        "Execution history limit must be a positive integer.",
      );
    }

    return this.connectionExecutionHistoryRepository
      .findRecentByOwnerId(
        limit,
        {
          ownerId,
        },
      );
  }

  requireOwnerId(ownerId) {
    if (
      typeof ownerId !== "string" ||
      ownerId.trim().length === 0
    ) {
      throw new Error("Owner id is required");
    }
  }

  requireConnectionId(connectionId) {
    if (
      typeof connectionId !== "string" ||
      connectionId.trim().length === 0
    ) {
      throw new Error(
        "Connection id is required",
      );
    }
  }
}

Object.freeze(
  ConnectionExecutionHistoryQueryService,
);
