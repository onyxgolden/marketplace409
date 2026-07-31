import {
  describe,
  expect,
  it,
} from "vitest";

import {
  ForgeRuntime,
} from "../ForgeRuntime.js";

import {
  registerVersionOneManagers,
} from "../../managers/registerVersionOneManagers.js";

import {
  createCanonicalContextStore,
} from "../../context/createCanonicalContextStore.js";

import {
  ContextContributionApplier,
} from "../../context/index.js";

import {
  createManagerRequestContract,
} from "../../contracts/v1/requests/index.js";


describe(
  "ForgeRuntime",
  () => {
    it(
      "dispatches requests through the Kernel boundary",
      async () => {
        const runtime =
          new ForgeRuntime({
            managerRegistry:
              registerVersionOneManagers(),

            contextStore:
              createCanonicalContextStore(),

            contextContributionApplier:
              new ContextContributionApplier(),
          });

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.repository-inspection",
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Requests repository inspection.",
            provenance: {
              requestId:
                "request-1",
              workflowId:
                "workflow-1",
              correlationId:
                "correlation-1",
              origin: {
                componentType:
                  "runtime",
                componentId:
                  "forge-runtime",
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
          outcome.payload
            .managerIdentity,
        ).toBe(
          "repository-intelligence-manager",
        );

        expect(
          outcome.payload
            .capabilityInvoked,
        ).toBe(
          "repository.inspect",
        );

        const context =
          runtime.contextStore.getCurrent();

        expect(
          context.payload.contributionHistory.length,
        ).toBe(1);

        expect(
          context.payload.contributionHistory[0]
            .source,
        ).toBe(
          "repository-intelligence-manager",
        );
      },
    );
  },
);
