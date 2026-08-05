import {
  WorkspaceDefinition,
} from "./WorkspaceDefinition.js";

export function registerFinancialWorkspace({
  workspaceRegistry,
}) {
  if (
    !workspaceRegistry ||
    typeof workspaceRegistry.register !== "function"
  ) {
    throw new Error(
      "Financial workspace registration requires a workspace registry.",
    );
  }

  const workspace =
    new WorkspaceDefinition({
      workspaceIdentity:
        "forge-financial",
      displayName:
        "FORGE Financial",
      managerIdentities: [
        "financial-manager",
        "transaction-review-manager",
      ],
      capabilities: [
        "financial.operations.build",
        "transaction.assignment.manual",
        "transaction.assignment.bulk",
      ],
      dependencies: [],
      activationRequirements: [
        "manager-registration",
        "contract-validation",
      ],
      metadata: {
        workspaceType:
          "financial",
      },
    });

  const registration =
    workspaceRegistry.register(
      workspace,
    );

  return Object.freeze({
    workspaceRegistry,
    workspace:
      registration,
    workspaceIdentity:
      registration.workspaceIdentity,
  });
}
