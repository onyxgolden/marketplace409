import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ManagerRegistry,
} from "../../kernel/index.js";

import {
  WorkspaceCoordinator,
  WorkspaceDefinition,
  WorkspaceRegistry,
} from "../index.js";

function createManager({
  managerIdentity,
  capabilities,
}) {
  return {
    managerIdentity,
    capabilities,
    execute() {},
  };
}

function createManagerRegistry() {
  const registry =
    new ManagerRegistry();

  registry.register(
    createManager({
      managerIdentity:
        "planning-manager",
      capabilities: [
        "planning.create",
      ],
    }),
  );

  registry.register(
    createManager({
      managerIdentity:
        "repository-manager",
      capabilities: [
        "repository.inspect",
      ],
    }),
  );

  return registry;
}

describe(
  "WorkspaceCoordinator",
  () => {
    it(
      "activates workspaces in deterministic dependency order",
      () => {
        const registry =
          new WorkspaceRegistry();

        registry.register(
          new WorkspaceDefinition({
            workspaceIdentity:
              "workspace-child",
            displayName:
              "Child",
            managerIdentities: [
              "repository-manager",
            ],
            capabilities: [
              "repository.inspect",
            ],
            dependencies: [
              "workspace-root",
            ],
          }),
        );

        registry.register(
          new WorkspaceDefinition({
            workspaceIdentity:
              "workspace-root",
            displayName:
              "Root",
            managerIdentities: [
              "planning-manager",
            ],
            capabilities: [
              "planning.create",
            ],
          }),
        );

        const coordinator =
          new WorkspaceCoordinator({
            workspaceRegistry:
              registry,
            managerRegistry:
              createManagerRegistry(),
          });

        const results =
          coordinator.activateAll();

        expect(
          results.map(
            (result) =>
              result.workspaceIdentity,
          ),
        ).toEqual([
          "workspace-root",
          "workspace-child",
        ]);

        expect(
          results.every(
            (result) =>
              result.status ===
              "activated",
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(results),
        ).toBe(true);
      },
    );

    it(
      "rejects unknown managers",
      () => {
        const registry =
          new WorkspaceRegistry();

        registry.register(
          new WorkspaceDefinition({
            workspaceIdentity:
              "invalid-workspace",
            displayName:
              "Invalid",
            managerIdentities: [
              "missing-manager",
            ],
            capabilities: [
              "planning.create",
            ],
          }),
        );

        const coordinator =
          new WorkspaceCoordinator({
            workspaceRegistry:
              registry,
            managerRegistry:
              createManagerRegistry(),
          });

        expect(
          () =>
            coordinator.activateAll(),
        ).toThrow(
          "Unknown workspace manager: missing-manager",
        );
      },
    );

    it(
      "rejects unknown capabilities",
      () => {
        const registry =
          new WorkspaceRegistry();

        registry.register(
          new WorkspaceDefinition({
            workspaceIdentity:
              "invalid-workspace",
            displayName:
              "Invalid",
            managerIdentities: [
              "planning-manager",
            ],
            capabilities: [
              "unknown.capability",
            ],
          }),
        );

        const coordinator =
          new WorkspaceCoordinator({
            workspaceRegistry:
              registry,
            managerRegistry:
              createManagerRegistry(),
          });

        expect(
          () =>
            coordinator.activateAll(),
        ).toThrow(
          "Unknown workspace capability: unknown.capability",
        );
      },
    );

    it(
      "rejects unresolved dependencies",
      () => {
        const registry =
          new WorkspaceRegistry();

        registry.register(
          new WorkspaceDefinition({
            workspaceIdentity:
              "invalid-workspace",
            displayName:
              "Invalid",
            managerIdentities: [
              "planning-manager",
            ],
            capabilities: [
              "planning.create",
            ],
            dependencies: [
              "missing-workspace",
            ],
          }),
        );

        const coordinator =
          new WorkspaceCoordinator({
            workspaceRegistry:
              registry,
            managerRegistry:
              createManagerRegistry(),
          });

        expect(
          () =>
            coordinator.activateAll(),
        ).toThrow(
          "Workspace activation dependencies cannot be resolved.",
        );
      },
    );
  },
);
