import {
  describe,
  expect,
  it,
} from "vitest";

import {
  registerVersionOneWorkspaces,
} from "../registerVersionOneWorkspaces.js";

import {
  registerFinancialWorkspace,
} from "../registerFinancialWorkspace.js";

describe(
  "registerFinancialWorkspace",
  () => {
    it(
      "registers the financial workspace while preserving the engineering workspace",
      () => {
        const workspaceRegistry =
          registerVersionOneWorkspaces();

        const result =
          registerFinancialWorkspace({
            workspaceRegistry,
          });

        expect(
          result.workspaceRegistry,
        ).toBe(workspaceRegistry);

        expect(
          workspaceRegistry.has(
            "forge-engineering",
          ),
        ).toBe(true);

        expect(
          workspaceRegistry.has(
            "forge-financial",
          ),
        ).toBe(true);

        expect(
          result.workspaceIdentity,
        ).toBe(
          "forge-financial",
        );
      },
    );

    it(
      "registers the expected managers and capabilities",
      () => {
        const workspaceRegistry =
          registerVersionOneWorkspaces();

        registerFinancialWorkspace({
          workspaceRegistry,
        });

        const workspace =
          workspaceRegistry.get(
            "forge-financial",
          );

        expect(
          workspace.managerIdentities,
        ).toEqual([
          "financial-manager",
          "transaction-review-manager",
        ]);

        expect(
          workspace.capabilities,
        ).toEqual([
          "financial.operations.build",
          "transaction.assignment.manual",
          "transaction.assignment.bulk",
        ]);
      },
    );

    it(
      "registers the expected activation and metadata configuration",
      () => {
        const workspaceRegistry =
          registerVersionOneWorkspaces();

        registerFinancialWorkspace({
          workspaceRegistry,
        });

        const workspace =
          workspaceRegistry.get(
            "forge-financial",
          );

        expect(
          workspace.dependencies,
        ).toEqual([]);

        expect(
          workspace.activationRequirements,
        ).toEqual([
          "manager-registration",
          "contract-validation",
        ]);

        expect(
          workspace.metadata,
        ).toEqual({
          workspaceType:
            "financial",
        });
      },
    );

    it(
      "rejects duplicate registration",
      () => {
        const workspaceRegistry =
          registerVersionOneWorkspaces();

        registerFinancialWorkspace({
          workspaceRegistry,
        });

        expect(() =>
          registerFinancialWorkspace({
            workspaceRegistry,
          }),
        ).toThrow(
          "Workspace already registered: forge-financial",
        );
      },
    );

    it(
      "rejects invalid registry input",
      () => {
        expect(() =>
          registerFinancialWorkspace({
            workspaceRegistry:
              null,
          }),
        ).toThrow(
          "Financial workspace registration requires a workspace registry.",
        );
      },
    );

    it(
      "returns immutable registration data",
      () => {
        const result =
          registerFinancialWorkspace({
            workspaceRegistry:
              registerVersionOneWorkspaces(),
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.workspace,
          ),
        ).toBe(true);
      },
    );
  },
);
