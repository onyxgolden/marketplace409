import {
  describe,
  expect,
  it,
} from "vitest";

import {
  WorkspaceDefinition,
} from "../WorkspaceDefinition.js";

function createWorkspace(
  overrides = {},
) {
  return new WorkspaceDefinition({
    workspaceIdentity:
      "forge-engineering",
    displayName:
      "FORGE Engineering",
    managerIdentities: [
      "planning-manager",
    ],
    capabilities: [
      "planning.create",
    ],
    ...overrides,
  });
}

describe(
  "WorkspaceDefinition",
  () => {
    it(
      "creates an immutable workspace definition",
      () => {
        const workspace =
          createWorkspace();

        expect(
          workspace.workspaceIdentity,
        ).toBe(
          "forge-engineering",
        );

        expect(
          Object.isFrozen(workspace),
        ).toBe(true);

        expect(
          Object.isFrozen(
            workspace.managerIdentities,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            workspace.capabilities,
          ),
        ).toBe(true);
      },
    );

    it(
      "isolates collection inputs",
      () => {
        const managerIdentities = [
          "planning-manager",
        ];

        const workspace =
          createWorkspace({
            managerIdentities,
          });

        managerIdentities.push(
          "memory-manager",
        );

        expect(
          workspace.managerIdentities,
        ).toEqual([
          "planning-manager",
        ]);
      },
    );

    it(
      "rejects invalid definitions",
      () => {
        expect(
          () =>
            createWorkspace({
              workspaceIdentity: "",
            }),
        ).toThrow(
          "WorkspaceDefinition requires a workspaceIdentity.",
        );

        expect(
          () =>
            createWorkspace({
              managerIdentities: [],
            }),
        ).toThrow(
          "WorkspaceDefinition requires at least one managerIdentities entry.",
        );

        expect(
          () =>
            createWorkspace({
              capabilities: [
                "planning.create",
                "planning.create",
              ],
            }),
        ).toThrow(
          "WorkspaceDefinition capabilities must be unique.",
        );
      },
    );
  },
);
