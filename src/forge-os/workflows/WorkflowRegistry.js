import {
  WorkflowDefinition,
} from "./WorkflowDefinition.js";

export class WorkflowRegistry {
  constructor() {
    this.workflowDefinitions =
      new Map();
  }

  register(workflowDefinition) {
    if (
      !(workflowDefinition instanceof
        WorkflowDefinition)
    ) {
      throw new Error(
        "WorkflowRegistry requires a WorkflowDefinition.",
      );
    }

    const {
      workflowId,
    } = workflowDefinition;

    if (
      this.workflowDefinitions.has(
        workflowId,
      )
    ) {
      throw new Error(
        `Workflow already registered: ${workflowId}`,
      );
    }

    this.workflowDefinitions.set(
      workflowId,
      workflowDefinition,
    );

    return workflowDefinition;
  }

  get(workflowId) {
    return (
      this.workflowDefinitions.get(
        workflowId,
      ) || null
    );
  }

  has(workflowId) {
    return this.workflowDefinitions.has(
      workflowId,
    );
  }

  list() {
    return Object.freeze(
      Array.from(
        this.workflowDefinitions
          .values(),
      ),
    );
  }
}
