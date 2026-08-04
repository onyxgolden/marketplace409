export class WorkflowStep {
  constructor({
    stepId,
    capability,
    workflowId,
    description,
    input = {},
    requiredEvidence = [],
    expectedOutput,
    validationExpectations = [],
    interruptionRules = {},
  }) {
    if (
      typeof stepId !== "string" ||
      stepId.length === 0
    ) {
      throw new Error(
        "WorkflowStep requires a stepId.",
      );
    }

    const hasCapability =
      typeof capability === "string" &&
      capability.length > 0;

    const hasWorkflow =
      typeof workflowId === "string" &&
      workflowId.length > 0;

    if (
      hasCapability === hasWorkflow
    ) {
      throw new Error(
        "WorkflowStep requires exactly one capability or workflowId.",
      );
    }

    this.stepId = stepId;
    this.stepType =
      hasCapability
        ? "capability"
        : "workflow";
    this.capability =
      hasCapability
        ? capability
        : undefined;
    this.workflowId =
      hasWorkflow
        ? workflowId
        : undefined;
    this.description =
      description ??
      (
        hasCapability
          ? `Execute ${capability}.`
          : `Execute workflow ${workflowId}.`
      );
    this.input = Object.freeze({
      ...input,
    });
    this.requiredEvidence = Object.freeze([
      ...requiredEvidence,
    ]);
    this.expectedOutput = expectedOutput;
    this.validationExpectations =
      Object.freeze([
        ...validationExpectations,
      ]);
    this.interruptionRules =
      Object.freeze({
        ...interruptionRules,
      });

    Object.freeze(this);
  }
}
