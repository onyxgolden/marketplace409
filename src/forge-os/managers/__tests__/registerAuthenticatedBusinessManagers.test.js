import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  registerVersionOneManagers,
} from "../registerVersionOneManagers.js";

import {
  registerAuthenticatedBusinessManagers,
} from "../registerAuthenticatedBusinessManagers.js";

function createRequestContract({
  requestedCapability,
  input = {},
}) {
  return {
    metadata: {
      contractId:
        "forge.request.test",
      version:
        "1.0.0",
    },
    provenance: {
      requestId:
        "request-test",
      workflowId:
        "workflow-test",
      correlationId:
        "correlation-test",
      contextVersion:
        "context-test",
    },
    payload: {
      requestedCapability,
      input,
    },
  };
}

function createForgeApplicationSuite() {
  return {
    financialApplicationSuite: {
      financialOperationsApplication: {
        buildFinancialOperations:
          vi.fn(async () => ({
            actions: [],
            source: {
              type:
                "test",
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
  };
}

describe(
  "registerAuthenticatedBusinessManagers",
  () => {
    it(
      "registers authenticated business managers while preserving Version 1 managers",
      () => {
        const managerRegistry =
          registerVersionOneManagers();

        const forgeApplicationSuite =
          createForgeApplicationSuite();

        const result =
          registerAuthenticatedBusinessManagers({
            managerRegistry,
            forgeApplicationSuite,
          });

        expect(
          result.managerRegistry,
        ).toBe(managerRegistry);

        expect(
          result.registeredManagerIdentities,
        ).toEqual([
          "financial-manager",
          "transaction-review-manager",
        ]);

        expect(
          managerRegistry.has(
            "repository-intelligence-manager",
          ),
        ).toBe(true);

        expect(
          managerRegistry.has(
            "memory-manager",
          ),
        ).toBe(true);

        expect(
          managerRegistry.has(
            "planning-manager",
          ),
        ).toBe(true);

        expect(
          managerRegistry.has(
            "financial-manager",
          ),
        ).toBe(true);

        expect(
          managerRegistry.has(
            "transaction-review-manager",
          ),
        ).toBe(true);
      },
    );

    it(
      "registers all authenticated business capabilities",
      () => {
        const managerRegistry =
          registerVersionOneManagers();

        registerAuthenticatedBusinessManagers({
          managerRegistry,
          forgeApplicationSuite:
            createForgeApplicationSuite(),
        });

        expect(
          managerRegistry.hasCapability(
            "financial.operations.build",
          ),
        ).toBe(true);

        expect(
          managerRegistry.hasCapability(
            "transaction.assignment.manual",
          ),
        ).toBe(true);

        expect(
          managerRegistry.hasCapability(
            "transaction.assignment.bulk",
          ),
        ).toBe(true);
      },
    );

    it(
      "wires FinancialManager to the supplied financial operations application",
      async () => {
        const managerRegistry =
          registerVersionOneManagers();

        const forgeApplicationSuite =
          createForgeApplicationSuite();

        registerAuthenticatedBusinessManagers({
          managerRegistry,
          forgeApplicationSuite,
        });

        const manager =
          managerRegistry.resolve(
            "financial.operations.build",
          );

        const outcome =
          await manager.execute(
            createRequestContract({
              requestedCapability:
                "financial.operations.build",
            }),
          );

        expect(
          forgeApplicationSuite
            .financialApplicationSuite
            .financialOperationsApplication
            .buildFinancialOperations,
        ).toHaveBeenCalledTimes(1);

        expect(
          outcome.payload
            .contextContribution,
        ).toEqual({
          financialOperationsBuilt:
            true,
        });
      },
    );

    it(
      "wires TransactionReviewManager to the supplied assignment services",
      async () => {
        const managerRegistry =
          registerVersionOneManagers();

        const forgeApplicationSuite =
          createForgeApplicationSuite();

        registerAuthenticatedBusinessManagers({
          managerRegistry,
          forgeApplicationSuite,
        });

        const manualInput = {
          transactionId:
            "transaction-1",
          propertyId:
            "property-1",
        };

        const bulkInput = {
          transactionIds: [
            "transaction-1",
            "transaction-2",
          ],
          propertyId:
            "property-1",
        };

        await managerRegistry
          .resolve(
            "transaction.assignment.manual",
          )
          .execute(
            createRequestContract({
              requestedCapability:
                "transaction.assignment.manual",
              input:
                manualInput,
            }),
          );

        const bulkOutcome =
          await managerRegistry
            .resolve(
              "transaction.assignment.bulk",
            )
            .execute(
              createRequestContract({
                requestedCapability:
                  "transaction.assignment.bulk",
                input:
                  bulkInput,
              }),
            );

        expect(
          forgeApplicationSuite
            .transactionReviewApplicationSuite
            .manualAssignmentService
            .assignTransactionToProperty,
        ).toHaveBeenCalledWith(
          manualInput,
        );

        expect(
          forgeApplicationSuite
            .transactionReviewApplicationSuite
            .bulkAssignmentService
            .assignTransactionsToProperty,
        ).toHaveBeenCalledWith(
          bulkInput,
        );

        expect(
          bulkOutcome.payload
            .contextContribution,
        ).toEqual({
          bulkTransactionAssignmentCompleted:
            true,
          assignedCount:
            2,
        });
      },
    );

    it(
      "rejects duplicate manager registration",
      () => {
        const managerRegistry =
          registerVersionOneManagers();

        const forgeApplicationSuite =
          createForgeApplicationSuite();

        registerAuthenticatedBusinessManagers({
          managerRegistry,
          forgeApplicationSuite,
        });

        expect(() =>
          registerAuthenticatedBusinessManagers({
            managerRegistry,
            forgeApplicationSuite,
          }),
        ).toThrow(
          "Manager already registered: financial-manager",
        );
      },
    );

    it(
      "rejects invalid composition dependencies",
      () => {
        expect(() =>
          registerAuthenticatedBusinessManagers({
            managerRegistry:
              null,
            forgeApplicationSuite:
              createForgeApplicationSuite(),
          }),
        ).toThrow(
          "Authenticated business manager registration requires a manager registry.",
        );

        expect(() =>
          registerAuthenticatedBusinessManagers({
            managerRegistry:
              registerVersionOneManagers(),
            forgeApplicationSuite:
              null,
          }),
        ).toThrow(
          "Authenticated business manager registration requires a FORGE application suite.",
        );
      },
    );

    it(
      "returns an immutable registration report",
      () => {
        const result =
          registerAuthenticatedBusinessManagers({
            managerRegistry:
              registerVersionOneManagers(),
            forgeApplicationSuite:
              createForgeApplicationSuite(),
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.registrations,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.registeredManagerIdentities,
          ),
        ).toBe(true);
      },
    );
  },
);
