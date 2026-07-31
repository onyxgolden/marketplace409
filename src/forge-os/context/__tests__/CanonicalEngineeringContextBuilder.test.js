import {
  describe,
  expect,
  it,
} from "vitest";

import {
  buildCanonicalEngineeringContext,
} from "../CanonicalEngineeringContextBuilder.js";

describe(
  "CanonicalEngineeringContextBuilder",
  () => {
    it(
      "creates a canonical engineering context contract",
      () => {
        const context =
          buildCanonicalEngineeringContext({
            contextIdentity:
              "test-context",
            provenance: {
              requestId:
                "request-1",
              workflowId:
                "workflow-1",
              correlationId:
                "correlation-1",
              origin: {
                componentType:
                  "test",
                componentId:
                  "context-builder-test",
              },
              contextVersion:
                "1.0.0",
            },
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
              { owner: true },
            evidenceReferences: [
              "evidence-1",
            ],
          });

        expect(
          context.metadata.contractType,
        ).toBe(
          "context",
        );

        expect(
          context.payload.contextIdentity,
        ).toBe(
          "test-context",
        );
      },
    );
  },
);
