import {
  describe,
  expect,
  it,
} from "vitest";

import {
  createForgeRuntime,
} from "../index.js";

import {
  ForgeRuntime,
} from "../ForgeRuntime.js";

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

        const context =
          runtime.contextStore.getCurrent();

        expect(
          context.metadata.contractType,
        ).toBe(
          "context",
        );

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

    it(
      "creates isolated lifecycle coordinators per dispatch",
      async () => {
        const lifecycleTransitions = [];
        const lifecycleCoordinatorInstances = [];

        const runtime =
          new ForgeRuntime({
            managerRegistry:
              (await import("../../managers/registerVersionOneManagers.js"))
                .registerVersionOneManagers(),

            contextStore:
              (await import("../../context/createCanonicalContextStore.js"))
                .createCanonicalContextStore(),

            contextContributionApplier:
              new (
                await import("../../context/index.js")
              ).ContextContributionApplier(),

            lifecycleCoordinatorFactory:
              () => {
                const coordinator = {
                  transition(input) {
                    lifecycleTransitions.push(input);
                  },
                };

                lifecycleCoordinatorInstances.push(
                  coordinator,
                );

                return coordinator;
              },
          });

        const createRequest = (id) =>
          createManagerRequestContract({
            contractId:
              `forge.request.${id}`,
            version: {
              major: 1,
              minor: 0,
              patch: 0,
              identifier: "1.0.0",
            },
            description:
              "Lifecycle isolation test.",
            provenance: {
              requestId:
                id,
              workflowId:
                id,
              correlationId:
                id,
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "lifecycle-test",
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

        await runtime.dispatch(
          createRequest("one"),
        );

        await runtime.dispatch(
          createRequest("two"),
        );

        expect(
          lifecycleTransitions.length,
        ).toBe(14);

        expect(
          lifecycleCoordinatorInstances.length,
        ).toBe(2);

        expect(
          lifecycleCoordinatorInstances[0],
        ).not.toBe(
          lifecycleCoordinatorInstances[1],
        );

        expect(
          lifecycleTransitions
            .slice(0, 7)
            .map(
              (transition) =>
                transition.toState,
            ),
        ).toEqual([
          "planning",
          "awaiting-authority",
          "executing",
          "validating",
          "governing",
          "updating-context",
          "ready",
        ]);

        expect(
          lifecycleTransitions
            .slice(7, 14)
            .map(
              (transition) =>
                transition.toState,
            ),
        ).toEqual([
          "planning",
          "awaiting-authority",
          "executing",
          "validating",
          "governing",
          "updating-context",
          "ready",
        ]);
      },
    );

  },
);
