import {
  WorkflowDefinition,
} from "./WorkflowDefinition.js";

import {
  createWorkflowGovernanceDecision,
} from "./WorkflowGovernanceDecision.js";

export class WorkflowGovernanceEvaluator {
  evaluate({
    workflowDefinition,
  }) {
    if (
      !(workflowDefinition instanceof
        WorkflowDefinition)
    ) {
      throw new Error(
        "WorkflowGovernanceEvaluator requires a WorkflowDefinition.",
      );
    }

    if (
      workflowDefinition.steps.length === 0
    ) {
      return createWorkflowGovernanceDecision({
        decision: "rejected",
        workflowId:
          workflowDefinition.workflowId,
        requirementsEvaluated: [
          "workflow-steps-required",
        ],
        reason:
          "Workflow execution requires at least one step.",
      });
    }

    const authority =
      workflowDefinition
        .grantedAuthority;

    if (
      !authority ||
      typeof authority !== "object" ||
      Object.keys(authority).length === 0
    ) {
      return createWorkflowGovernanceDecision({
        decision: "rejected",
        workflowId:
          workflowDefinition.workflowId,
        requirementsEvaluated: [
          "workflow-authority-required",
        ],
        reason:
          "Workflow execution requires granted authority.",
      });
    }

    const capabilityStepsWithoutValidation =
      workflowDefinition.steps.filter(
        (step) =>
          step.stepType === "capability" &&
          (
            !Array.isArray(
              step.validationExpectations,
            ) ||
            step.validationExpectations
              .length === 0
          ),
      );

    if (
      capabilityStepsWithoutValidation
        .length > 0
    ) {
      return createWorkflowGovernanceDecision({
        decision: "rejected",
        workflowId:
          workflowDefinition.workflowId,
        requirementsEvaluated: [
          "step-validation-expectations-required",
        ],
        reason:
          "Every capability workflow step requires validation expectations.",
      });
    }

    return createWorkflowGovernanceDecision({
      decision: "approved",
      workflowId:
        workflowDefinition.workflowId,
      requirementsEvaluated: [
        "workflow-definition-valid",
        "workflow-authority-present",
        "workflow-steps-present",
        "capability-step-validation-expectations-present",
      ],
      reason:
        "Workflow governance requirements satisfied.",
    });
  }
}
