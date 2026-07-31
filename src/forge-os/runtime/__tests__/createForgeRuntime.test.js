import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createForgeRuntime,
} from "../index.js";

import {
  createManagerRequestContract,
} from "../../contracts/v1/requests/index.js";

describe(
  "createForgeRuntime",
  () => {
    it(
      "creates a Version 1 FORGE runtime composition",
      async () => {
        const runtime =
          createForgeRuntime();

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.repository-inspection",
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Requests repository inspection.",
            provenance: {
              requestId:
                "request-runtime-factory-1",
              workflowId:
                "workflow-runtime-factory-1",
              correlationId:
                "correlation-runtime-factory-1",
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "create-forge-runtime-test",
              },
              contextVersion:
                "1.0.0",
            },
            targetWorkspace:
              "test-workspace",
            requestedCapability:
              "repository.inspect",
            input: {},
            grantedAuthority: {},
            securityScope: {},
          });

        const outcome =
          await runtime.dispatch(
            request,
          );

        expect(
          outcome.payload.managerIdentity,
        ).toBe(
          "repository-intelligence-manager",
        );
      },
    );

    it(
      "dispatches all registered Version 1 manager capabilities",
      async () => {
        const runtime =
          createForgeRuntime();

        const capabilities = [
          [
            "repository.inspect",
            "repository-intelligence-manager",
          ],
          [
            "memory.retrieve",
            "memory-manager",
          ],
          [
            "planning.create",
            "planning-manager",
          ],
        ];

        for (const [
          capability,
          expectedManager,
        ] of capabilities) {
          const request =
            createManagerRequestContract({
              contractId:
                `forge.request.${capability}`,
              version: {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
              description:
                `Requests ${capability}.`,
              provenance: {
                requestId:
                  `request-${capability}`,
                workflowId:
                  "workflow-runtime-capability-test",
                correlationId:
                  `correlation-${capability}`,
                origin: {
                  componentType:
                    "runtime-test",
                  componentId:
                    "create-forge-runtime-test",
                },
                contextVersion:
                  "1.0.0",
              },
              targetWorkspace:
                "test-workspace",
              requestedCapability:
                capability,
              input: {
                objective:
                  "Validate runtime composition",
              },
              grantedAuthority: {},
              securityScope: {},
            });

          const outcome =
            await runtime.dispatch(
              request,
            );

          expect(
            outcome.payload.managerIdentity,
          ).toBe(
            expectedManager,
          );

          expect(
            outcome.payload.capabilityInvoked,
          ).toBe(
            capability,
          );
        }
      },
    );

  },
);
