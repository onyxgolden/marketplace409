import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createManagerRequestContract,
} from "../../../contracts/v1/requests/index.js";

import {
  MemoryManager,
} from "../MemoryManager.js";

describe(
  "MemoryManager",
  () => {
    it(
      "produces a deterministic memory retrieval outcome",
      async () => {
        const manager =
          new MemoryManager();

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.memory-retrieval",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Requests memory retrieval.",
            provenance: {
              requestId:
                "request-memory-1",
              workflowId:
                "workflow-memory-1",
              correlationId:
                "correlation-memory-1",
              origin: {
                componentType:
                  "test",
                componentId:
                  "memory-manager-test",
              },
              contextVersion:
                "1.0.0",
            },
            targetWorkspace:
              "test-workspace",
            requestedCapability:
              "memory.retrieve",
            input: {},
            grantedAuthority: {},
            securityScope: {},
          });

        const outcome =
          await manager.execute(
            request,
          );

        expect(
          outcome.payload.managerIdentity,
        ).toBe(
          "memory-manager",
        );

        expect(
          outcome.payload.capabilityInvoked,
        ).toBe(
          "memory.retrieve",
        );

        expect(
          outcome.payload.producedOutput
            .memoryState,
        ).toBe(
          "retrieved",
        );
      },
    );

    it(
      "rejects unsupported capabilities",
      async () => {
        const manager =
          new MemoryManager();

        await expect(
          manager.execute({
            payload: {
              requestedCapability:
                "memory.write",
            },
          }),
        ).rejects.toThrow();
      },
    );
  },
);
