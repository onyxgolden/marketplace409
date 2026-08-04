import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  createManagerRequestContract,
} from "../../../contracts/v1/requests/index.js";

import {
  TransactionReviewManager,
} from "../TransactionReviewManager.js";

function createRequest({
  requestedCapability =
    "transaction.assignment.manual",
  input = {},
} = {}) {
  return createManagerRequestContract({
    contractId:
      "forge.request.transaction-assignment",
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    },
    description:
      "Requests deterministic transaction assignment.",
    provenance: {
      requestId:
        "request-transaction-review-1",
      workflowId:
        "workflow-transaction-review-1",
      correlationId:
        "correlation-transaction-review-1",
      origin: {
        componentType:
          "transaction-review-manager-test",
        componentId:
          "transaction-review-manager-test",
      },
      contextVersion:
        "1.0.0",
    },
    targetWorkspace:
      "forge-financial",
    requestedCapability,
    input,
    grantedAuthority: {
      transactionAssignment:
        true,
    },
    securityScope: {},
  });
}

function createDependencies() {
  return {
    manualAssignmentService: {
      assignTransactionToProperty:
        vi.fn(async (input) => ({
          transaction:
            input.transaction,
          property:
            input.property,
          rule: {
            id:
              "rule-1",
            type:
              "manual",
            ownerId:
              input.ownerId ?? null,
          },
          reviewItem:
            null,
        })),
    },

    bulkAssignmentService: {
      assignTransactionsToProperty:
        vi.fn(async (input) => ({
          assignments:
            input.assignments.map(
              (assignment, index) => ({
                transaction:
                  assignment.transaction,
                property:
                  assignment.property,
                rule: {
                  id:
                    `rule-${index + 1}`,
                  type:
                    "manual",
                },
                reviewItem:
                  null,
              }),
            ),
          assignedCount:
            input.assignments.length,
          failedCount:
            0,
        })),
    },
  };
}

describe(
  "TransactionReviewManager",
  () => {
    it(
      "declares transaction assignment capabilities",
      () => {
        const manager =
          new TransactionReviewManager(
            createDependencies(),
          );

        expect(
          manager.managerIdentity,
        ).toBe(
          "transaction-review-manager",
        );

        expect(
          manager.capabilities,
        ).toEqual([
          "transaction.assignment.manual",
          "transaction.assignment.bulk",
        ]);

        expect(
          Object.isFrozen(manager),
        ).toBe(true);

        expect(
          Object.isFrozen(
            manager.capabilities,
          ),
        ).toBe(true);
      },
    );

    it(
      "executes a manual assignment through the domain service",
      async () => {
        const dependencies =
          createDependencies();

        const manager =
          new TransactionReviewManager(
            dependencies,
          );

        const input = {
          transaction: {
            id:
              "transaction-1",
          },
          property: {
            id:
              "property-1",
            name:
              "170 John",
          },
          ownerId:
            "owner-1",
        };

        const outcome =
          await manager.execute(
            createRequest({
              input,
            }),
          );

        expect(
          dependencies
            .manualAssignmentService
            .assignTransactionToProperty,
        ).toHaveBeenCalledWith(
          input,
        );

        expect(
          outcome.payload
            .managerIdentity,
        ).toBe(
          "transaction-review-manager",
        );

        expect(
          outcome.payload
            .capabilityInvoked,
        ).toBe(
          "transaction.assignment.manual",
        );

        expect(
          outcome.payload
            .completionStatus,
        ).toBe(
          "completed",
        );

        expect(
          outcome.payload
            .stateChanged,
        ).toBe(true);

        expect(
          outcome.payload
            .producedOutput.rule,
        ).toEqual(
          expect.objectContaining({
            type:
              "manual",
            ownerId:
              "owner-1",
          }),
        );

        expect(
          outcome.payload
            .contextContribution,
        ).toEqual({
          manualTransactionAssignmentCompleted:
            true,
        });
      },
    );

    it(
      "executes bulk assignments through the domain service",
      async () => {
        const dependencies =
          createDependencies();

        const manager =
          new TransactionReviewManager(
            dependencies,
          );

        const input = {
          assignments: [
            {
              transaction: {
                id:
                  "transaction-1",
              },
              property: {
                id:
                  "property-1",
              },
            },
            {
              transaction: {
                id:
                  "transaction-2",
              },
              property: {
                id:
                  "property-1",
              },
            },
          ],
          ownerId:
            "owner-1",
        };

        const outcome =
          await manager.execute(
            createRequest({
              requestedCapability:
                "transaction.assignment.bulk",
              input,
            }),
          );

        expect(
          dependencies
            .bulkAssignmentService
            .assignTransactionsToProperty,
        ).toHaveBeenCalledWith(
          input,
        );

        expect(
          outcome.payload
            .capabilityInvoked,
        ).toBe(
          "transaction.assignment.bulk",
        );

        expect(
          outcome.payload
            .producedOutput
            .assignedCount,
        ).toBe(2);

        expect(
          outcome.payload
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
      "deep freezes assignment output",
      async () => {
        const manager =
          new TransactionReviewManager(
            createDependencies(),
          );

        const outcome =
          await manager.execute(
            createRequest({
              input: {
                transaction: {
                  id:
                    "transaction-1",
                },
                property: {
                  id:
                    "property-1",
                },
              },
            }),
          );

        const output =
          outcome.payload
            .producedOutput;

        expect(
          Object.isFrozen(output),
        ).toBe(true);

        expect(
          Object.isFrozen(
            output.transaction,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            output.property,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            output.rule,
          ),
        ).toBe(true);
      },
    );

    it(
      "requires both assignment services",
      () => {
        expect(
          () =>
            new TransactionReviewManager({
              bulkAssignmentService:
                createDependencies()
                  .bulkAssignmentService,
            }),
        ).toThrow(
          "TransactionReviewManager requires a manual assignment service.",
        );

        expect(
          () =>
            new TransactionReviewManager({
              manualAssignmentService:
                createDependencies()
                  .manualAssignmentService,
            }),
        ).toThrow(
          "TransactionReviewManager requires a bulk assignment service.",
        );
      },
    );

    it(
      "rejects unsupported capabilities",
      async () => {
        const manager =
          new TransactionReviewManager(
            createDependencies(),
          );

        await expect(
          manager.execute(
            createRequest({
              requestedCapability:
                "transaction.assignment.unknown",
            }),
          ),
        ).rejects.toThrow(
          "Unsupported transaction review capability: transaction.assignment.unknown",
        );
      },
    );

    it(
      "declares validation, governance, and authority requirements",
      async () => {
        const manager =
          new TransactionReviewManager(
            createDependencies(),
          );

        const outcome =
          await manager.execute(
            createRequest({
              input: {
                transaction: {
                  id:
                    "transaction-1",
                },
                property: {
                  id:
                    "property-1",
                },
              },
            }),
          );

        expect(
          outcome.payload
            .validationRequirements,
        ).toEqual([
          "structural-validation",
          "assignment-result-validation",
        ]);

        expect(
          outcome.payload
            .governanceRequirements,
        ).toEqual([
          "transaction-assignment-review",
        ]);

        expect(
          outcome.payload
            .additionalAuthorityRequirements,
        ).toEqual([
          "transaction-assignment-authority",
        ]);
      },
    );
  },
);
