import {
  createManagerRequestContract,
} from "../contracts/v1/requests/index.js";

import {
  WorkflowDefinition,
} from "./WorkflowDefinition.js";

import {
  WorkflowExecutionRecord,
} from "./WorkflowExecutionRecord.js";

import {
  WorkflowExecutionRegistry,
} from "./WorkflowExecutionRegistry.js";

import {
  WorkflowGovernanceEvaluator,
} from "./WorkflowGovernanceEvaluator.js";

import {
  WorkflowRegistry,
} from "./WorkflowRegistry.js";

import {
  WorkflowResult,
} from "./WorkflowResult.js";

export class WorkflowExecutor {
  constructor({
    runtime,
    workflowRegistry =
      new WorkflowRegistry(),
    governanceEvaluator =
      new WorkflowGovernanceEvaluator(),
    executionRegistry =
      new WorkflowExecutionRegistry(),
    clock =
      () => new Date().toISOString(),
  }) {
    if (
      !runtime ||
      typeof runtime.dispatch !== "function"
    ) {
      throw new Error(
        "WorkflowExecutor requires a runtime.",
      );
    }

    if (
      !workflowRegistry ||
      typeof workflowRegistry.get !==
        "function"
    ) {
      throw new Error(
        "WorkflowExecutor requires a workflowRegistry.",
      );
    }

    if (
      !governanceEvaluator ||
      typeof governanceEvaluator.evaluate !==
        "function"
    ) {
      throw new Error(
        "WorkflowExecutor requires a governanceEvaluator.",
      );
    }

    if (
      !executionRegistry ||
      typeof executionRegistry.register !==
        "function"
    ) {
      throw new Error(
        "WorkflowExecutor requires an executionRegistry.",
      );
    }

    if (typeof clock !== "function") {
      throw new Error(
        "WorkflowExecutor requires a clock.",
      );
    }

    this.runtime = runtime;
    this.workflowRegistry =
      workflowRegistry;
    this.governanceEvaluator =
      governanceEvaluator;
    this.executionRegistry =
      executionRegistry;
    this.clock = clock;

    Object.freeze(this);
  }

  async execute(workflow) {
    if (
      !(workflow instanceof
        WorkflowDefinition)
    ) {
      throw new Error(
        "WorkflowExecutor requires a WorkflowDefinition.",
      );
    }

    return await this.executeWorkflow({
      workflow,
      correlationId:
        workflow.correlationId,
      ancestry: [],
      executionPath:
        workflow.workflowId,
    });
  }

  async executeWorkflow({
    workflow,
    correlationId,
    ancestry,
    executionPath,
  }) {
    if (
      ancestry.includes(
        workflow.workflowId,
      )
    ) {
      const cycle = [
        ...ancestry,
        workflow.workflowId,
      ].join(" -> ");

      throw new Error(
        `Workflow composition cycle detected: ${cycle}`,
      );
    }

    const governanceDecision =
      this.governanceEvaluator.evaluate({
        workflowDefinition: workflow,
      });

    if (
      governanceDecision.decision !==
      "approved"
    ) {
      throw new Error(
        `Workflow governance rejected execution: ${governanceDecision.reason}`,
      );
    }

    const startedAt =
      this.clock();

    const outcomes = [];
    const childResults = [];
    const completedSteps = [];

    const nextAncestry = [
      ...ancestry,
      workflow.workflowId,
    ];

    for (
      let index = 0;
      index < workflow.steps.length;
      index += 1
    ) {
      const step = workflow.steps[index];

      if (
        step.stepType === "workflow"
      ) {
        const childWorkflow =
          this.workflowRegistry.get(
            step.workflowId,
          );

        if (!childWorkflow) {
          throw new Error(
            `Unknown child workflow: ${step.workflowId}`,
          );
        }

        const childResult =
          await this.executeWorkflow({
            workflow:
              childWorkflow,
            correlationId,
            ancestry:
              nextAncestry,
            executionPath:
              `${executionPath}.${step.stepId}.${childWorkflow.workflowId}`,
          });

        childResults.push(
          childResult,
        );

        outcomes.push(
          ...childResult.outcomes,
        );

        completedSteps.push(
          step.stepId,
        );

        continue;
      }

      const requestContract =
        createManagerRequestContract({
          contractId:
            `forge.request.workflow.${executionPath}.${step.stepId}`,
          version:
            workflow.version,
          description:
            step.description,
          provenance: {
            requestId:
              `${executionPath}.request.${index + 1}`,
            workflowId:
              workflow.workflowId,
            correlationId,
            causationId:
              outcomes.length === 0
                ? undefined
                : outcomes[
                    outcomes.length - 1
                  ].metadata.contractId,
            parentContractId:
              executionPath,
            origin: Object.freeze({
              componentType:
                "workflow-executor",
              componentId:
                "forge-engineering-workflow",
            }),
            contextVersion:
              workflow.contextVersion,
            evidenceReferences:
              outcomes.length === 0
                ? []
                : outcomes[
                    outcomes.length - 1
                  ].payload
                    .producedEvidence,
          },
          targetWorkspace:
            workflow.targetWorkspace,
          requestedCapability:
            step.capability,
          input: {
            ...step.input,
            objective:
              step.input.objective ??
              workflow.objective,
            repositoryPath:
              step.input.repositoryPath ??
              workflow.repositoryPath,
          },
          grantedAuthority:
            workflow.grantedAuthority,
          securityScope:
            workflow.securityScope,
          requiredEvidence:
            step.requiredEvidence,
          expectedOutput:
            step.expectedOutput,
          validationExpectations:
            step.validationExpectations,
          interruptionRules:
            step.interruptionRules,
        });

      const outcome =
        await this.runtime.dispatch(
          requestContract,
        );

      outcomes.push(outcome);
      completedSteps.push(step.stepId);
    }

    const completedAt =
      this.clock();

    const executionRecord =
      new WorkflowExecutionRecord({
        executionId:
          `${executionPath}.${correlationId}`,
        workflowId:
          workflow.workflowId,
        correlationId,
        objective:
          workflow.objective,
        completionStatus:
          "completed",
        completedSteps,
        outcomeContractIds:
          outcomes.map(
            (outcome) =>
              outcome.metadata
                .contractId,
          ),
        startedAt,
        completedAt,
      });

    this.executionRegistry.register(
      executionRecord,
    );

    return new WorkflowResult({
      workflowId:
        workflow.workflowId,
      correlationId,
      objective:
        workflow.objective,
      completionStatus:
        "completed",
      completedSteps,
      outcomes,
      childResults,
      governanceDecision,
      executionRecord,
    });
  }
}
