import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createManagerRequestContract,
} from "../../../contracts/v1/requests/index.js";

import {
  PlanningManager,
} from "../PlanningManager.js";

describe(
  "PlanningManager",
  () => {
    it(
      "produces a deterministic planning outcome",
      async () => {
        const manager =
          new PlanningManager();

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.planning",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Requests planning.",
            provenance: {
              requestId:
                "request-planning-1",
              workflowId:
                "workflow-planning-1",
              correlationId:
                "correlation-planning-1",
              origin: {
                componentType:
                  "test",
                componentId:
                  "planning-manager-test",
              },
              contextVersion:
                "1.0.0",
            },
            targetWorkspace:
              "test-workspace",
            requestedCapability:
              "planning.create",
            input: {
              objective:
                "Create bounded execution plan",
            },
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
          "planning-manager",
        );

        expect(
          outcome.payload.capabilityInvoked,
        ).toBe(
          "planning.create",
        );

        expect(
          outcome.payload.producedOutput
            .planState,
        ).toBe(
          "created",
        );
      },
    );

    it(
      "rejects unsupported capabilities",
      async () => {
        const manager =
          new PlanningManager();

        await expect(
          manager.execute({
            payload: {
              requestedCapability:
                "planning.execute",
            },
          }),
        ).rejects.toThrow();
      },
    );
  },
);
