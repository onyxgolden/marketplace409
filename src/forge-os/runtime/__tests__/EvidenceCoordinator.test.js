import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceCoordinator,
} from "../EvidenceCoordinator.js";

import {
  createManagerOutcomeContract,
} from "../../contracts/v1/outcomes/index.js";

import {
  createContractVersion,
} from "../../contracts/v1/core/index.js";


function createOutcome(overrides = {}) {
  return createManagerOutcomeContract({
    contractId:
      "forge.outcome.test",
    version:
      createContractVersion({
        major: 1,
        minor: 0,
        patch: 0,
      }),
    description:
      "Test manager outcome.",
    provenance: {
      requestId:
        "request-001",
      workflowId:
        "workflow-001",
      correlationId:
        "correlation-001",
      origin: {
        componentType:
          "test",
        componentId:
          "runtime-test",
      },
      contextVersion:
        "1.0.0",
    },
    managerIdentity:
      "test-manager",
    capabilityInvoked:
      "test.execute",
    completionStatus:
      "completed",
    stateChanged:
      false,
    producedOutput: {
      completed:
        true,
    },
    producedEvidence: [],
    resultingRisks: [],
    validationRequirements: [],
    governanceRequirements: [],
    recoveryRequirements: [],
    additionalAuthorityRequirements: [],
    contextContribution:
      undefined,
    ...overrides,
  });
}


describe(
  "EvidenceCoordinator",
  () => {
    it(
      "returns unchanged outcomes without evidence requirements",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        const outcome =
          createOutcome();

        expect(
          coordinator.process({
            outcome,
          }),
        ).toBe(
          outcome,
        );
      },
    );

    it(
      "creates evidence for outcomes requiring validation",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        const outcome =
          createOutcome({
            validationRequirements: [
              "structural-validation",
            ],
          });

        const result =
          coordinator.process({
            outcome,
          });

        expect(
          result,
        ).not.toBe(
          outcome,
        );

        expect(
          result.payload.producedEvidence.length,
        ).toBe(
          1,
        );
      },
    );

    it(
      "preserves immutability",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        const outcome =
          createOutcome({
            stateChanged:
              true,
          });

        const result =
          coordinator.process({
            outcome,
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(result.payload),
        ).toBe(true);
      },
    );
  },
);
