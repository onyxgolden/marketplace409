import {
  WorkflowStep,
} from "./WorkflowStep.js";

function freezeObject(value = {}) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "WorkflowDefinition object fields must be objects.",
    );
  }

  return Object.freeze({
    ...value,
  });
}

export class WorkflowDefinition {
  constructor({
    workflowId,
    correlationId,
    objective,
    targetWorkspace,
    repositoryPath,
    version = {
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    },
    contextVersion = "1.0.0",
    grantedAuthority = {},
    securityScope = {},
    steps,
  }) {
    if (
      typeof workflowId !== "string" ||
      workflowId.length === 0
    ) {
      throw new Error(
        "WorkflowDefinition requires a workflowId.",
      );
    }

    if (
      typeof correlationId !== "string" ||
      correlationId.length === 0
    ) {
      throw new Error(
        "WorkflowDefinition requires a correlationId.",
      );
    }

    if (
      typeof objective !== "string" ||
      objective.length === 0
    ) {
      throw new Error(
        "WorkflowDefinition requires an objective.",
      );
    }

    if (
      typeof targetWorkspace !== "string" ||
      targetWorkspace.length === 0
    ) {
      throw new Error(
        "WorkflowDefinition requires a targetWorkspace.",
      );
    }

    if (
      !Array.isArray(steps) ||
      steps.length === 0
    ) {
      throw new Error(
        "WorkflowDefinition requires at least one step.",
      );
    }

    const normalizedSteps =
      steps.map(
        (step) =>
          step instanceof WorkflowStep
            ? step
            : new WorkflowStep(step),
      );

    const stepIds =
      normalizedSteps.map(
        (step) => step.stepId,
      );

    if (
      new Set(stepIds).size !==
      stepIds.length
    ) {
      throw new Error(
        "WorkflowDefinition stepIds must be unique.",
      );
    }

    this.workflowId = workflowId;
    this.correlationId = correlationId;
    this.objective = objective;
    this.targetWorkspace =
      targetWorkspace;
    this.repositoryPath =
      repositoryPath;
    this.version =
      freezeObject(version);
    this.contextVersion =
      contextVersion;
    this.grantedAuthority =
      freezeObject(grantedAuthority);
    this.securityScope =
      freezeObject(securityScope);
    this.steps = Object.freeze([
      ...normalizedSteps,
    ]);

    Object.freeze(this);
  }
}
