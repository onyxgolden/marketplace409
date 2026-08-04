export class WorkflowExecutionRecord {
  constructor({
    executionId,
    workflowId,
    correlationId,
    objective,
    completionStatus,
    completedSteps,
    outcomeContractIds,
    startedAt,
    completedAt,
  }) {
    if (
      typeof executionId !== "string" ||
      executionId.length === 0
    ) {
      throw new Error(
        "WorkflowExecutionRecord requires an executionId.",
      );
    }

    if (
      typeof workflowId !== "string" ||
      workflowId.length === 0
    ) {
      throw new Error(
        "WorkflowExecutionRecord requires a workflowId.",
      );
    }

    if (
      typeof correlationId !== "string" ||
      correlationId.length === 0
    ) {
      throw new Error(
        "WorkflowExecutionRecord requires a correlationId.",
      );
    }

    if (
      typeof completionStatus !== "string" ||
      completionStatus.length === 0
    ) {
      throw new Error(
        "WorkflowExecutionRecord requires a completionStatus.",
      );
    }

    if (!Array.isArray(completedSteps)) {
      throw new Error(
        "WorkflowExecutionRecord completedSteps must be an array.",
      );
    }

    if (!Array.isArray(outcomeContractIds)) {
      throw new Error(
        "WorkflowExecutionRecord outcomeContractIds must be an array.",
      );
    }

    this.executionId = executionId;
    this.workflowId = workflowId;
    this.correlationId =
      correlationId;
    this.objective = objective;
    this.completionStatus =
      completionStatus;
    this.completedSteps =
      Object.freeze([
        ...completedSteps,
      ]);
    this.outcomeContractIds =
      Object.freeze([
        ...outcomeContractIds,
      ]);
    this.startedAt = startedAt;
    this.completedAt = completedAt;

    Object.freeze(this);
  }
}
