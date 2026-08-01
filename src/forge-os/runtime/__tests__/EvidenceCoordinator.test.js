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
      "returns outcomes without accepted evidence when evidence is not required",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        const outcome =
          createOutcome();

        const result =
          coordinator.process({
            outcome,
          });

        expect(
          result.outcome,
        ).toBe(
          outcome,
        );

        expect(
          result.acceptedEvidenceReferences,
        ).toEqual([]);
      },
    );

    it(
      "produces, registers, validates, and accepts required evidence",
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
          result.outcome,
        ).toBe(
          outcome,
        );

        expect(
          result.acceptedEvidenceReferences.length,
        ).toBe(1);

        expect(
          result.acceptedEvidenceReferences[0]
            .evidenceId,
        ).toBe(
          "forge.outcome.test.correlation-001.evidence",
        );

        expect(
          result.acceptedEvidenceReferences[0]
            .sourceComponent,
        ).toBe(
          "test-manager",
        );
      },
    );

    it(
      "does not overwrite manager-produced evidence",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        const outcome =
          createOutcome({
            stateChanged:
              true,
            producedEvidence: [
              "manager-produced-reference",
            ],
          });

        const result =
          coordinator.process({
            outcome,
          });

        expect(
          result.outcome.payload
            .producedEvidence,
        ).toEqual([
          "manager-produced-reference",
        ]);
      },
    );

    it(
      "returns immutable coordination results",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        const result =
          coordinator.process({
            outcome:
              createOutcome({
                stateChanged:
                  true,
              }),
          });

        expect(
          Object.isFrozen(result),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.acceptedEvidenceReferences,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            result.acceptedEvidenceReferences[0],
          ),
        ).toBe(true);
      },
    );

    it(
      "rejects missing outcomes",
      () => {
        const coordinator =
          new EvidenceCoordinator();

        expect(() =>
          coordinator.process({}),
        ).toThrow(
          "EvidenceCoordinator requires an outcome.",
        );
      },
    );

    it(
      "requires explicitly supplied dependencies",
      () => {
        expect(() =>
          new EvidenceCoordinator({
            evidenceRegistry:
              null,
          }),
        ).toThrow(
          "EvidenceCoordinator requires an evidenceRegistry.",
        );
      },
    );
  },
);
