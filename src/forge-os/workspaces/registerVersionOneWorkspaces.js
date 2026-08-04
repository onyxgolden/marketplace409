import {
  WorkspaceDefinition,
} from "./WorkspaceDefinition.js";

import {
  WorkspaceRegistry,
} from "./WorkspaceRegistry.js";

export function registerVersionOneWorkspaces() {
  const registry =
    new WorkspaceRegistry();

  registry.register(
    new WorkspaceDefinition({
      workspaceIdentity:
        "forge-engineering",
      displayName:
        "FORGE Engineering",
      managerIdentities: [
        "memory-manager",
        "planning-manager",
        "repository-intelligence-manager",
      ],
      capabilities: [
        "memory.retrieve",
        "planning.create",
        "repository.inspect",
      ],
      dependencies: [],
      activationRequirements: [
        "manager-registration",
        "contract-validation",
      ],
      metadata: {
        workspaceType:
          "engineering",
      },
    }),
  );

  return registry;
}
