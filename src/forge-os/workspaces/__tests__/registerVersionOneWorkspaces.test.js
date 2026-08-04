import {
  describe,
  expect,
  it,
} from "vitest";

import {
  registerVersionOneWorkspaces,
} from "../registerVersionOneWorkspaces.js";

describe(
  "registerVersionOneWorkspaces",
  () => {
    it(
      "registers the Version 1 engineering workspace",
      () => {
        const registry =
          registerVersionOneWorkspaces();

        const workspace =
          registry.get(
            "forge-engineering",
          );

        expect(
          workspace,
        ).not.toBeNull();

        expect(
          workspace.managerIdentities,
        ).toEqual([
          "memory-manager",
          "planning-manager",
          "repository-intelligence-manager",
        ]);

        expect(
          workspace.capabilities,
        ).toEqual([
          "memory.retrieve",
          "planning.create",
          "repository.inspect",
        ]);
      },
    );
  },
);
