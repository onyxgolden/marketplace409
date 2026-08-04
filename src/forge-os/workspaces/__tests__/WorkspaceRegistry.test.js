import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkspaceDefinition,
} from "../WorkspaceDefinition.js";

import {
  WorkspaceRegistry,
} from "../WorkspaceRegistry.js";

function createWorkspace(
  workspaceIdentity =
    "forge-engineering",
) {
  return new WorkspaceDefinition({
    workspaceIdentity,
    displayName:
      workspaceIdentity,
    managerIdentities: [
      "planning-manager",
    ],
    capabilities: [
      "planning.create",
    ],
  });
}

describe(
  "WorkspaceRegistry",
  () => {
    it(
      "registers and retrieves workspaces",
      () => {
        const registry =
          new WorkspaceRegistry();

        const workspace =
          registry.register(
            createWorkspace(),
          );

        expect(
          registry.get(
            "forge-engineering",
          ),
        ).toBe(workspace);

        expect(
          registry.has(
            "forge-engineering",
          ),
        ).toBe(true);
      },
    );

    it(
      "lists workspaces deterministically",
      () => {
        const registry =
          new WorkspaceRegistry();

        registry.register(
          createWorkspace(
            "workspace-z",
          ),
        );

        registry.register(
          createWorkspace(
            "workspace-a",
          ),
        );

        expect(
          registry.list().map(
            (workspace) =>
              workspace.workspaceIdentity,
          ),
        ).toEqual([
          "workspace-a",
          "workspace-z",
        ]);

        expect(
          Object.isFrozen(
            registry.list(),
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects duplicate identities",
      () => {
        const registry =
          new WorkspaceRegistry();

        registry.register(
          createWorkspace(),
        );

        expect(
          () =>
            registry.register(
              createWorkspace(),
            ),
        ).toThrow(
          "Workspace already registered: forge-engineering",
        );
      },
    );

    it(
      "rejects invalid registrations",
      () => {
        const registry =
          new WorkspaceRegistry();

        expect(
          () =>
            registry.register({}),
        ).toThrow(
          "WorkspaceRegistry requires a WorkspaceDefinition.",
        );
      },
    );
  },
);
