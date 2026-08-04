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
  FinancialManager,
} from "../FinancialManager.js";

function createRequest({
  requestedCapability =
    "financial.operations.build",
} = {}) {
  return createManagerRequestContract({
    contractId:
      "forge.request.financial-operations",
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    },
    description:
      "Requests deterministic financial operations.",
    provenance: {
      requestId:
        "request-financial-manager-1",
      workflowId:
        "workflow-financial-manager-1",
      correlationId:
        "correlation-financial-manager-1",
      origin: {
        componentType:
          "financial-manager-test",
        componentId:
          "financial-manager-test",
      },
      contextVersion:
        "1.0.0",
    },
    targetWorkspace:
      "forge-financial",
    requestedCapability,
    input: {},
    grantedAuthority: {},
    securityScope: {},
  });
}

function createFinancialOperationsApplication() {
  return {
    buildFinancialOperations:
      vi.fn(async () => ({
        type:
          "financial-operations",
        priority:
          "optimize",
        focus:
          "controlled growth",
        summary:
          "Optimize operating performance.",
        actions: [
          {
            id:
              "financial-operation-1",
            title:
              "Review operating costs.",
            category:
              "controlled growth",
            priority:
              "optimize",
            status:
              "recommended",
            rationale:
              "Derived from deterministic financial intelligence.",
          },
        ],
        source: {
          authority:
            "financial-event-repository-backed-read-models",
          mutableLedgerState:
            false,
          aiGenerated:
            false,
          derivedFrom:
            "financial-intelligence",
        },
      })),
  };
}

describe(
  "FinancialManager",
  () => {
    it(
      "declares the financial operations capability",
      () => {
        const manager =
          new FinancialManager({
            financialOperationsApplication:
              createFinancialOperationsApplication(),
          });

        expect(
          manager.managerIdentity,
        ).toBe(
          "financial-manager",
        );

        expect(
          manager.capabilities,
        ).toEqual([
          "financial.operations.build",
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
      "builds financial operations through the application boundary",
      async () => {
        const financialOperationsApplication =
          createFinancialOperationsApplication();

        const manager =
          new FinancialManager({
            financialOperationsApplication,
          });

        const outcome =
          await manager.execute(
            createRequest(),
          );

        expect(
          financialOperationsApplication
            .buildFinancialOperations,
        ).toHaveBeenCalledTimes(1);

        expect(
          outcome.payload
            .managerIdentity,
        ).toBe(
          "financial-manager",
        );

        expect(
          outcome.payload
            .capabilityInvoked,
        ).toBe(
          "financial.operations.build",
        );

        expect(
          outcome.payload
            .completionStatus,
        ).toBe(
          "completed",
        );

        expect(
          outcome.payload
            .producedOutput,
        ).toEqual(
          expect.objectContaining({
            type:
              "financial-operations",
            priority:
              "optimize",
            focus:
              "controlled growth",
          }),
        );

        expect(
          outcome.payload
            .contextContribution,
        ).toEqual({
          financialOperationsBuilt:
            true,
        });

        expect(
          outcome.payload
            .governanceRequirements,
        ).toEqual([
          "financial-recommendation-review",
        ]);
      },
    );

    it(
      "preserves immutable financial output",
      async () => {
        const manager =
          new FinancialManager({
            financialOperationsApplication:
              createFinancialOperationsApplication(),
          });

        const outcome =
          await manager.execute(
            createRequest(),
          );

        expect(
          Object.isFrozen(
            outcome.payload
              .producedOutput,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            outcome.payload
              .producedOutput
              .actions,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            outcome.payload
              .producedOutput
              .actions[0],
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            outcome.payload
              .producedOutput
              .source,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects unsupported capabilities",
      async () => {
        const manager =
          new FinancialManager({
            financialOperationsApplication:
              createFinancialOperationsApplication(),
          });

        await expect(
          manager.execute(
            createRequest({
              requestedCapability:
                "financial.unknown",
            }),
          ),
        ).rejects.toThrow(
          "Unsupported financial capability: financial.unknown",
        );
      },
    );

    it(
      "requires a financial operations application",
      () => {
        expect(
          () =>
            new FinancialManager({}),
        ).toThrow(
          "FinancialManager requires a financial operations application.",
        );
      },
    );

    it(
      "rejects invalid financial operations output",
      async () => {
        const manager =
          new FinancialManager({
            financialOperationsApplication: {
              buildFinancialOperations:
                vi.fn(
                  async () =>
                    null,
                ),
            },
          });

        await expect(
          manager.execute(
            createRequest(),
          ),
        ).rejects.toThrow(
          "FinancialManager requires financial operations output.",
        );
      },
    );
  },
);
