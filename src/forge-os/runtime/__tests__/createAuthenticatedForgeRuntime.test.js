import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createAuthenticatedForgeRuntime,
} from "../createAuthenticatedForgeRuntime.js";

import {
  createManagerRequestContract,
} from "../../contracts/v1/requests/index.js";

function createForgeApplicationSuite() {
  return Object.freeze({
    financialApplicationSuite: {
      financialOperationsApplication: {
        buildFinancialOperations:
          vi.fn(async () => ({
            type:
              "financial-operations",
            actions: [],
            source: {
              type:
                "authenticated-runtime-test",
            },
          })),
      },
    },

    transactionReviewApplicationSuite: {
      manualAssignmentService: {
        assignTransactionToProperty:
          vi.fn(async (input) => ({
            assignmentType:
              "manual",
            input,
          })),
      },

      bulkAssignmentService: {
        assignTransactionsToProperty:
          vi.fn(async (input) => ({
            assignmentType:
              "bulk",
            assignedCount:
              input.transactionIds?.length ?? 0,
            input,
          })),
      },
    },
  });
}

function createAuthenticatedApplication() {
  const forgeApplicationSuite =
    createForgeApplicationSuite();

  return {
    supabaseClient: {
      identity:
        "request-scoped-client",
    },

    user: {
      id:
        "owner-1",
    },

    currentOwnerId:
      vi.fn(async () => "owner-1"),

    getForgeApplicationSuite:
      vi.fn(async () =>
        forgeApplicationSuite
      ),

    forgeApplicationSuite,
  };
}

describe(
  "createAuthenticatedForgeRuntime",
  () => {
    it(
      "creates an authenticated runtime with engineering and financial workspaces",
      async () => {
        const authenticatedApplication =
          createAuthenticatedApplication();

        const authenticatedApplicationFactory =
          vi.fn(async () =>
            authenticatedApplication
          );

        const result =
          await createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory,
          });

        expect(
          authenticatedApplicationFactory,
        ).toHaveBeenCalledTimes(1);

        expect(
          authenticatedApplication
            .getForgeApplicationSuite,
        ).toHaveBeenCalledTimes(1);

        expect(
          result.workspaceRegistry.has(
            "forge-engineering",
          ),
        ).toBe(true);

        expect(
          result.workspaceRegistry.has(
            "forge-financial",
          ),
        ).toBe(true);
      },
    );

    it(
      "registers static and authenticated business managers",
      async () => {
        const authenticatedApplication =
          createAuthenticatedApplication();

        const result =
          await createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              async () =>
                authenticatedApplication,
          });

        expect(
          result.managerRegistry.has(
            "repository-intelligence-manager",
          ),
        ).toBe(true);

        expect(
          result.managerRegistry.has(
            "memory-manager",
          ),
        ).toBe(true);

        expect(
          result.managerRegistry.has(
            "planning-manager",
          ),
        ).toBe(true);

        expect(
          result.managerRegistry.has(
            "financial-manager",
          ),
        ).toBe(true);

        expect(
          result.managerRegistry.has(
            "transaction-review-manager",
          ),
        ).toBe(true);
      },
    );

    it(
      "activates both authenticated runtime workspaces deterministically",
      async () => {
        const result =
          await createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              async () =>
                createAuthenticatedApplication(),
          });

        expect(
          result.workspaceActivationReport.map(
            (entry) =>
              entry.workspaceIdentity,
          ),
        ).toEqual([
          "forge-engineering",
          "forge-financial",
        ]);

        expect(
          result.workspaceActivationReport.every(
            (entry) =>
              entry.status ===
              "activated",
          ),
        ).toBe(true);
      },
    );

    it(
      "dispatches financial operations through the authenticated runtime",
      async () => {
        const authenticatedApplication =
          createAuthenticatedApplication();

        const result =
          await createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              async () =>
                authenticatedApplication,
          });

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.financial-operations",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier:
                "1.0.0",
            },
            description:
              "Requests authenticated financial operations.",
            provenance: {
              requestId:
                "request-financial-1",
              workflowId:
                "workflow-financial-1",
              correlationId:
                "correlation-financial-1",
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "authenticated-runtime-test",
              },
              contextVersion:
                "1.0.0",
            },
            targetWorkspace:
              "forge-financial",
            requestedCapability:
              "financial.operations.build",
            input: {},
            grantedAuthority: {},
            securityScope: {
              ownerId:
                "owner-1",
            },
          });

        const outcome =
          await result.runtime.dispatch(
            request,
          );

        expect(
          outcome.payload.managerIdentity,
        ).toBe(
          "financial-manager",
        );

        expect(
          outcome.payload.capabilityInvoked,
        ).toBe(
          "financial.operations.build",
        );

        expect(
          authenticatedApplication
            .forgeApplicationSuite
            .financialApplicationSuite
            .financialOperationsApplication
            .buildFinancialOperations,
        ).toHaveBeenCalledTimes(1);
      },
    );

    it(
      "returns authentication failure responses without creating a runtime",
      async () => {
        const response = {
          status:
            401,
        };

        const result =
          await createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              async () => ({
                response,
              }),
          });

        expect(result).toEqual({
          response,
        });

        expect(
          result.runtime,
        ).toBeUndefined();
      },
    );

    it(
      "rejects invalid authenticated composition dependencies",
      async () => {
        await expect(
          createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              null,
          }),
        ).rejects.toThrow(
          "Authenticated FORGE runtime requires an authenticated application factory.",
        );

        await expect(
          createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              async () => ({}),
          }),
        ).rejects.toThrow(
          "Authenticated FORGE runtime requires an authenticated FORGE application.",
        );
      },
    );

    it(
      "returns immutable authenticated runtime composition",
      async () => {
        const result =
          await createAuthenticatedForgeRuntime({
            authenticatedApplicationFactory:
              async () =>
                createAuthenticatedApplication(),
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.workspaceActivationReport,
          ),
        ).toBe(true);
      },
    );
  },
);
