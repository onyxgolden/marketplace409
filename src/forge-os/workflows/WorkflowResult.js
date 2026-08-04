export class WorkflowResult {
  constructor({
    workflowId,
    correlationId,
    objective,
    completionStatus,
    completedSteps,
    outcomes,
    childResults = [],
    governanceDecision,
    executionRecord,
  }) {
    this.workflowId = workflowId;
    this.correlationId = correlationId;
    this.objective = objective;
    this.completionStatus =
      completionStatus;
    this.completedSteps =
      Object.freeze([
        ...completedSteps,
      ]);
    this.outcomes = Object.freeze([
      ...outcomes,
    ]);
    this.childResults =
      Object.freeze([
        ...childResults,
      ]);
    this.governanceDecision =
      governanceDecision;
    this.executionRecord =
      executionRecord;

    Object.freeze(this);
  }
}
