import {
  WorkflowExecutionRegistry,
  WorkflowExecutor,
  WorkflowRegistry,
} from "../../workflows/index.js";

import {
  DeterministicWorkflowPlanner,
} from "./DeterministicWorkflowPlanner.js";

export class EngineeringObjectiveExecutor {
  constructor({
    runtime,
    planner =
      new DeterministicWorkflowPlanner(),
    workflowRegistry =
      new WorkflowRegistry(),
    executionRegistry =
      new WorkflowExecutionRegistry(),
    workflowExecutor,
    clock,
  }) {
    if (
      !runtime ||
      typeof runtime.dispatch !== "function"
    ) {
      throw new Error(
        "EngineeringObjectiveExecutor requires a runtime.",
      );
    }

    if (
      !planner ||
      typeof planner.plan !== "function"
    ) {
      throw new Error(
        "EngineeringObjectiveExecutor requires a planner.",
      );
    }

    this.runtime = runtime;
    this.planner = planner;
    this.workflowRegistry =
      workflowRegistry;
    this.executionRegistry =
      executionRegistry;

    this.workflowExecutor =
      workflowExecutor ??
      new WorkflowExecutor({
        runtime,
        workflowRegistry,
        executionRegistry,
        clock,
      });

    Object.freeze(this);
  }

  async execute({
    objectiveType,
    objective,
    workflowId,
    correlationId,
    repositoryPath,
    targetWorkspace =
      "forge-engineering",
    grantedAuthority = {},
    securityScope = {},
  }) {
    const workflow =
      this.planner.plan({
        objectiveType,
        objective,
        workflowId,
        correlationId,
        repositoryPath,
        targetWorkspace,
        grantedAuthority,
        securityScope,
      });

    if (
      !this.workflowRegistry.has(
        workflow.workflowId,
      )
    ) {
      this.workflowRegistry.register(
        workflow,
      );
    }

    const workflowResult =
      await this.workflowExecutor.execute(
        workflow,
      );

    return Object.freeze({
      objectiveType,
      objective,
      workflowId:
        workflow.workflowId,
      correlationId:
        workflow.correlationId,
      completionStatus:
        workflowResult.completionStatus,
      workflowResult,
      executionRecord:
        workflowResult.executionRecord,
    });
  }
}
