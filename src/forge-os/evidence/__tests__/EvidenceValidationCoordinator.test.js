import {
  describe,
  expect,
  it,
} from "vitest";

import {
  EvidenceValidationCoordinator,
} from "../EvidenceValidationCoordinator.js";

import {
  EvidenceAcceptanceService,
} from "../EvidenceAcceptanceService.js";

import {
  EvidenceRegistry,
} from "../EvidenceRegistry.js";

import {
  EvidenceValidator,
} from "../EvidenceValidator.js";


function createEvidence(evidenceId) {
  return {
    metadata: {
      contractType:
        "evidence-record",
    },
    payload: {
      evidenceId,
      sourceComponent:
        "test-component",
      validationStatus:
        "passed",
      artifacts: [],
    },
    provenance: {
      workflowId:
        "workflow-001",
    },
  };
}


function createCoordinator() {
  const registry =
    new EvidenceRegistry();

  registry.register(
    createEvidence(
      "evidence-001",
    ),
  );

  registry.register(
    createEvidence(
      "evidence-002",
    ),
  );

  return new EvidenceValidationCoordinator({
    evidenceAcceptanceService:
      new EvidenceAcceptanceService({
        evidenceRegistry:
          registry,
        evidenceValidator:
          new EvidenceValidator(),
      }),
  });
}


describe(
  "EvidenceValidationCoordinator",
  () => {
    it(
      "validates and accepts evidence references",
      () => {
        const coordinator =
          createCoordinator();

        const references =
          coordinator.validateAndAccept({
            evidenceIds: [
              "evidence-001",
            ],
          });

        expect(
          references.length,
        ).toBe(1);

        expect(
          references[0].evidenceId,
        ).toBe(
          "evidence-001",
        );
      },
    );

    it(
      "processes multiple evidence identifiers",
      () => {
        const coordinator =
          createCoordinator();

        const references =
          coordinator.validateAndAccept({
            evidenceIds: [
              "evidence-001",
              "evidence-002",
            ],
          });

        expect(
          references.length,
        ).toBe(2);
      },
    );

    it(
      "requires an acceptance service",
      () => {
        expect(() =>
          new EvidenceValidationCoordinator({}),
        ).toThrow();
      },
    );

    it(
      "requires evidence identifiers",
      () => {
        const coordinator =
          createCoordinator();

        expect(() =>
          coordinator.validateAndAccept({}),
        ).toThrow();
      },
    );
  },
);
