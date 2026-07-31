import {
  describe,
  expect,
  it,
} from "vitest";

import {
  validateContractStructure,
} from "../../core/index.js";

import {
  createContextEvolutionRecordContract,
} from "../ContextEvolutionRecord.js";

function createTestRecord() {
  return createContextEvolutionRecordContract({
    contractId:
      "forge.context-evolution.test",
    version: {
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    },
    description:
      "Captures a test context evolution event.",
    provenance: {
      requestId:
        "request-evolution-1",
      workflowId:
        "workflow-evolution-1",
      correlationId:
        "correlation-evolution-1",
      origin: {
        componentType:
          "manager",
        componentId:
          "repository-intelligence-manager",
      },
      contextVersion:
        "1.0.0",
      evidenceReferences: [
        "evidence-1",
      ],
    },
    evolutionId:
      "evolution-1",
    sourceManager:
      "repository-intelligence-manager",
    contribution: {
      repositoryInspected: true,
    },
    evidenceReferences: [
      "evidence-1",
    ],
    previousContextIdentity:
      "context-1",
    resultingContextIdentity:
      "context-2",
    sequence: 1,
  });
}

describe(
  "ContextEvolutionRecord",
  () => {
    it(
      "creates an immutable context evolution contract",
      () => {
        const contract =
          createTestRecord();

        expect(
          contract.metadata.contractType,
        ).toBe(
          "context-evolution-record",
        );

        expect(
          contract.payload.evolutionId,
        ).toBe(
          "evolution-1",
        );

        expect(
          contract.payload.sourceManager,
        ).toBe(
          "repository-intelligence-manager",
        );

        expect(
          contract.payload.sequence,
        ).toBe(1);

        expect(
          Object.isFrozen(contract),
        ).toBe(true);

        expect(
          Object.isFrozen(contract.payload),
        ).toBe(true);

        expect(
          Object.isFrozen(
            contract.payload.contribution,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            contract.payload.evidenceReferences,
          ),
        ).toBe(true);

        expect(
          contract.provenance.requestId,
        ).toBe(
          "request-evolution-1",
        );
      },
    );

    it(
      "clones immutable contribution and evidence collections",
      () => {
        const contribution = {
          memoryRetrieved: true,
        };

        const evidenceReferences = [
          "evidence-memory-1",
        ];

        const contract =
          createContextEvolutionRecordContract({
            contractId:
              "forge.context-evolution.clone-test",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Verifies context evolution cloning.",
            provenance: {
              requestId:
                "request-evolution-2",
              workflowId:
                "workflow-evolution-2",
              correlationId:
                "correlation-evolution-2",
              origin: {
                componentType:
                  "manager",
                componentId:
                  "memory-manager",
              },
              contextVersion:
                "1.0.0",
            },
            evolutionId:
              "evolution-2",
            sourceManager:
              "memory-manager",
            contribution,
            evidenceReferences,
            previousContextIdentity:
              "context-2",
            resultingContextIdentity:
              "context-3",
            sequence: 2,
          });

        contribution.memoryRetrieved = false;
        evidenceReferences.push(
          "evidence-memory-2",
        );

        expect(
          contract.payload.contribution,
        ).toEqual({
          memoryRetrieved: true,
        });

        expect(
          contract.payload.evidenceReferences,
        ).toEqual([
          "evidence-memory-1",
        ]);
      },
    );


    it(
      "stores immutable governance decision metadata",
      () => {
        const contract =
          createContextEvolutionRecordContract({
            contractId:
              "forge.context-evolution.governance-test",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Captures governance decision metadata.",
            provenance: {
              requestId:
                "request-governance-1",
              workflowId:
                "workflow-governance-1",
              correlationId:
                "correlation-governance-1",
              origin: {
                componentType:
                  "kernel",
                componentId:
                  "governance-evaluator",
              },
              contextVersion:
                "1.0.0",
            },
            evolutionId:
              "evolution-governance-1",
            sourceManager:
              "repository-intelligence-manager",
            contribution: {
              repositoryInspected:
                true,
            },
            evidenceReferences: [
              "evidence-1",
            ],
            governanceDecision: {
              decision:
                "approved",
              reason:
                "Governance requirements satisfied.",
              requirementsEvaluated: [
                "evidence-present",
              ],
            },
            previousContextIdentity:
              "context-1",
            resultingContextIdentity:
              "context-2",
            sequence: 1,
          });

        expect(
          contract.payload.governanceDecision.decision,
        ).toBe(
          "approved",
        );

        expect(
          Object.isFrozen(
            contract.payload.governanceDecision,
          ),
        ).toBe(true);

        expect(
          Object.isFrozen(
            contract.payload.governanceDecision
              .requirementsEvaluated,
          ),
        ).toBe(true);
      },
    );

    it(
      "passes the existing structural contract validator",
      () => {
        const result =
          validateContractStructure(
            createTestRecord(),
          );

        expect(result.valid).toBe(true);
        expect(result.findings).toEqual([]);
      },
    );
  },
);
