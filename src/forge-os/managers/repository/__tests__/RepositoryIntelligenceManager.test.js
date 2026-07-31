import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createContractVersion,
  validateContractStructure,
} from "../../../contracts/v1/core/index.js";

import {
  createManagerRequestContract,
} from "../../../contracts/v1/requests/index.js";

import {
  ContractDispatcher,
  ManagerRegistry,
} from "../../../kernel/index.js";

import {
  RepositoryIntelligenceManager,
} from "../RepositoryIntelligenceManager.js";

function createRequest(
  overrides = {},
) {
  return createManagerRequestContract({
    contractId:
      "forge.request.manager.repository-inspection",
    version: createContractVersion({
      major: 1,
      minor: 0,
      patch: 0,
    }),
    description:
      "Requests deterministic repository inspection.",
    provenance: {
      requestId: "request-001",
      workflowId: "workflow-001",
      correlationId: "correlation-001",
      causationId: undefined,
      parentContractId: undefined,
      origin: Object.freeze({
        componentType: "kernel",
        componentId: "forge-os-kernel",
      }),
      contextVersion: "context-001",
      evidenceReferences: [],
    },
    targetWorkspace: "workspace-001",
    requestedCapability:
      "repository.inspect",
    input: Object.freeze({
      repositoryPath: "/repository",
    }),
    grantedAuthority: Object.freeze({
      scope: "read-only",
    }),
    securityScope: Object.freeze({
      repositoryBoundary: "/repository",
    }),
    requiredEvidence: [],
    expectedOutput: Object.freeze({
      type: "repository-inspection",
    }),
    validationExpectations: [
      "structural-validation",
    ],
    interruptionRules: Object.freeze({
      timeoutMilliseconds: 30000,
    }),
    ...overrides,
  });
}

describe(
  "RepositoryIntelligenceManager",
  () => {
    it(
      "declares an immutable canonical manager boundary",
      () => {
        const manager =
          new RepositoryIntelligenceManager();

        expect(manager.managerIdentity).toBe(
          "repository-intelligence-manager",
        );

        expect(manager.capabilities).toEqual([
          "repository.inspect",
        ]);

        expect(Object.isFrozen(manager)).toBe(
          true,
        );

        expect(
          Object.isFrozen(manager.capabilities),
        ).toBe(true);
      },
    );

    it(
      "produces a deterministic immutable outcome",
      async () => {
        const manager =
          new RepositoryIntelligenceManager();

        const request = createRequest();

        const outcome =
          await manager.execute(request);

        expect(
          validateContractStructure(outcome),
        ).toEqual({
          valid: true,
          findings: [],
        });

        expect(outcome.payload).toEqual({
          managerIdentity:
            "repository-intelligence-manager",
          capabilityInvoked:
            "repository.inspect",
          completionStatus: "completed",
          stateChanged: false,
          producedOutput: {
            repositoryState: "inspected",
            branch: "unknown",
            dirty: "unknown",
            commit: "unknown",
            observations: [],
          },
          producedEvidence: [],
          resultingRisks: [],
          validationRequirements: [
            "structural-validation",
          ],
          governanceRequirements: [],
          recoveryRequirements: [],
          additionalAuthorityRequirements: [],
          contextContribution: {
            repositoryInspectionCompleted: true,
          },
          failureClassification: undefined,
          timingInformation: {
            durationMilliseconds: 0,
          },
        });

        expect(outcome.provenance).toEqual({
          requestId: "request-001",
          workflowId: "workflow-001",
          correlationId:
            "correlation-001",
          causationId:
            "forge.request.manager.repository-inspection",
          parentContractId:
            "forge.request.manager.repository-inspection",
          origin: {
            componentType: "manager",
            componentId:
              "repository-intelligence-manager",
          },
          contextVersion: "context-001",
          evidenceReferences: [],
        });

        expect(Object.isFrozen(outcome)).toBe(
          true,
        );

        expect(
          Object.isFrozen(
            outcome.payload.producedOutput,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            outcome.payload.producedOutput
              .observations,
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects unsupported capabilities",
      async () => {
        const manager =
          new RepositoryIntelligenceManager();

        await expect(
          manager.execute(
            createRequest({
              requestedCapability:
                "repository.status",
            }),
          ),
        ).rejects.toThrow(
          "Unsupported repository intelligence capability: repository.status",
        );
      },
    );

    it(
      "completes the kernel to manager execution path",
      async () => {
        const registry =
          new ManagerRegistry();

        registry.register(
          new RepositoryIntelligenceManager(),
        );

        const dispatcher =
          new ContractDispatcher({
            managerRegistry: registry,
          });

        const outcome =
          await dispatcher.dispatch(
            createRequest(),
          );

        expect(
          outcome.payload.managerIdentity,
        ).toBe(
          "repository-intelligence-manager",
        );

        expect(
          outcome.payload.capabilityInvoked,
        ).toBe("repository.inspect");

        expect(
          outcome.payload.completionStatus,
        ).toBe("completed");
      },
    );
  },
);
