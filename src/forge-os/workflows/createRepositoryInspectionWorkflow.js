import {
  EngineeringWorkflow,
} from "./EngineeringWorkflow.js";

export function createRepositoryInspectionWorkflow({
  workflowId,
  correlationId,
  repositoryPath,
  targetWorkspace =
    "forge-engineering",
  objective =
    "Inspect the repository through governed FORGE OS execution.",
  grantedAuthority = {},
  securityScope = {},
}) {
  return new EngineeringWorkflow({
    workflowId,
    correlationId,
    objective,
    targetWorkspace,
    repositoryPath,
    grantedAuthority,
    securityScope,
    steps: [
      {
        stepId: "create-plan",
        capability:
          "planning.create",
        description:
          "Create the repository inspection execution plan.",
        input: {
          objective,
        },
        validationExpectations: [
          "structural-validation",
        ],
      },
      {
        stepId:
          "inspect-repository",
        capability:
          "repository.inspect",
        description:
          "Inspect the repository using the governed repository manager.",
        input: {
          repositoryPath,
        },
        requiredEvidence: [
          "repository-state",
        ],
        validationExpectations: [
          "structural-validation",
        ],
      },
    ],
  });
}
