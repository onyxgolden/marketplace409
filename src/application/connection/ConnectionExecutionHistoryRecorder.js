import crypto from "node:crypto";

export class ConnectionExecutionHistoryRecorder {
  constructor({
    connectionExecutionHistoryRepository,
    idGenerator = null,
    clock = () => new Date().toISOString(),
  }) {
    this.connectionExecutionHistoryRepository =
      connectionExecutionHistoryRepository;

    this.idGenerator =
      idGenerator ||
      (() =>
        crypto.randomUUID());

    this.clock = clock;
  }

  async recordExecution({
    operation,
    ownerId,
    executionResult,
    startedAt = null,
    completedAt = null,
  }) {
    if (
      !this.connectionExecutionHistoryRepository
    ) {
      return null;
    }

    const record =
      Object.freeze({
        id: this.idGenerator(),
        ownerId,
        connectionId:
          executionResult.connectionId,
        operationType:
          this.normalizeOperation(
            operation,
          ),
        status:
          this.resolveStatus(
            operation,
            executionResult,
          ),
        provider:
          executionResult.provider || null,
        startedAt:
          startedAt || this.clock(),
        completedAt:
          completedAt || this.clock(),
        metrics:
          this.buildMetrics(
            executionResult,
          ),
        errorDetails:
          executionResult.errorDetails ||
          null,
        createdAt:
          this.clock(),
      });

    return this.connectionExecutionHistoryRepository
      .save(
        record,
        {
          ownerId,
        },
      );
  }

  normalizeOperation(operation) {
    switch (operation) {
      case "import-transactions":
        return "import";

      case "review-connection":
        return "review";

      case "repair-connection":
        return "repair";

      default:
        return operation;
    }
  }

  resolveStatus(
    operation,
    executionResult,
  ) {
    if (
      operation === "review-connection"
    ) {
      return "completed";
    }

    return executionResult.success === true
      || executionResult.repaired === true
      ? "success"
      : "failed";
  }

  buildMetrics(executionResult) {
    const {
      ownerId,
      connectionId,
      provider,
      occurredAt,
      ...metrics
    } = executionResult;

    return Object.freeze(metrics);
  }
}

Object.freeze(
  ConnectionExecutionHistoryRecorder,
);
