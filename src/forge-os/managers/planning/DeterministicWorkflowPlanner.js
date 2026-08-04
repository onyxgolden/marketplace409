import {
  createRepositoryInspectionWorkflow,
} from "../../workflows/index.js";

const REPOSITORY_INSPECTION_OBJECTIVE =
  "repository-inspection";

export class DeterministicWorkflowPlanner {
  constructor({
    workflowFactories = {},
  } = {}) {
    this.workflowFactories =
      Object.freeze({
        [REPOSITORY_INSPECTION_OBJECTIVE]:
          createRepositoryInspectionWorkflow,
        ...workflowFactories,
      });

    Object.freeze(this);
  }

  plan({
    objectiveType,
    objective,
    workflowId,
    correlationId,
    repositoryPath,
    targetWorkspace,
    grantedAuthority,
    securityScope,
  }) {
    if (
      typeof objectiveType !== "string" ||
      objectiveType.length === 0
    ) {
      throw new Error(
        "DeterministicWorkflowPlanner requires an objectiveType.",
      );
    }

    const workflowFactory =
      this.workflowFactories[
        objectiveType
      ];

    if (
      typeof workflowFactory !==
      "function"
    ) {
      throw new Error(
        `Unsupported engineering objective: ${objectiveType}`,
      );
    }

    return workflowFactory({
      workflowId,
      correlationId,
      repositoryPath,
      targetWorkspace,
      objective,
      grantedAuthority,
      securityScope,
    });
  }

  supports(objectiveType) {
    return (
      typeof this.workflowFactories[
        objectiveType
      ] === "function"
    );
  }

  listSupportedObjectives() {
    return Object.freeze(
      Object.keys(
        this.workflowFactories,
      ),
    );
  }
}
