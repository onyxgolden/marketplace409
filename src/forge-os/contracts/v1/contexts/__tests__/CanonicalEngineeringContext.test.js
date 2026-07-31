import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createCanonicalEngineeringContextContract,
} from "../CanonicalEngineeringContext.js";

describe(
  "CanonicalEngineeringContext",
  () => {
    it(
      "creates an immutable context contract",
      () => {
        const contract =
          createCanonicalEngineeringContextContract({
            contractId:
              "forge.context.test",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Creates a test engineering context.",
            provenance: {
              requestId:
                "request-context-1",
              workflowId:
                "workflow-context-1",
              correlationId:
                "correlation-context-1",
              origin: {
                componentType:
                  "test",
                componentId:
                  "context-test",
              },
              contextVersion:
                "1.0.0",
            },
            contextIdentity:
              "test-context",
            repositoryState:
              { ready: true },
            memoryState:
              { loaded: true },
            governanceState:
              { valid: true },
            executionState:
              { idle: true },
            validationState:
              { passed: true },
            authorityState:
              { owner: "test" },
            evidenceReferences: [
              "evidence-1",
            ],
          });

        expect(
          contract.metadata.contractType,
        ).toBe(
          "context",
        );

        expect(
          contract.payload.contextIdentity,
        ).toBe(
          "test-context",
        );

        expect(
          Object.isFrozen(
            contract.payload.evidenceReferences,
          ),
        ).toBe(true);

        expect(
          contract.provenance.requestId,
        ).toBe(
          "request-context-1",
        );
      },
    );
  },
);
