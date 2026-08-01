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
            .metadata.contractType,
        ).toBe(
          "context-evolution-record",
        );

        expect(
          context.payload.contributionHistory[0]
            .payload.sourceManager,
        ).toBe(
          "repository-intelligence-manager",
        );

        expect(
          context.payload.contributionHistory[0]
            .payload.evidenceReferences,
        ).toEqual([
          "forge.outcome.manager.repository-inspection.correlation-1.evidence",
        ]);

        expect(
          context.payload.contributionHistory[0]
            .payload.governanceDecision.decision,
        ).toBe(
          "approved",
        );
      },
    );

    it(
      "preserves evidence identity through governance and context evolution",
      async () => {
        let acceptedEvidenceReferences = [];

        const evidenceCoordinator = {
          process() {
            acceptedEvidenceReferences = [
              "forge.outcome.manager.repository-inspection.correlation-lineage-1.evidence",
            ];

            return {
              acceptedEvidenceReferences: [
                {
                  evidenceId:
                    acceptedEvidenceReferences[0],
                },
              ],
            };
          },
        };

        const runtime =
          new ForgeRuntime({
            managerRegistry:
              registerVersionOneManagers(),

            contextStore:
              createCanonicalContextStore(),

            contextContributionApplier:
              new ContextContributionApplier(),

            evidenceCoordinator,
          });

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.repository-inspection-lineage",
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Requests repository inspection lineage validation.",
            provenance: {
              requestId:
                "request-lineage-1",
              workflowId:
                "workflow-lineage-1",
              correlationId:
                "correlation-lineage-1",
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

        const context =
          runtime.contextStore.getCurrent();

        const evolutionRecord =
          context.payload
            .contributionHistory[0];

        expect(
          outcome.payload.managerIdentity,
        ).toBe(
          evolutionRecord.payload.sourceManager,
        );

        expect(
          acceptedEvidenceReferences[0],
        ).toBe(
          evolutionRecord.payload.evidenceReferences[0],
        );

        expect(
          Object.isFrozen(
            evolutionRecord.payload.evidenceReferences,
          ),
        ).toBe(true);
      },
    );


    it(
      "does not apply context mutations when governance rejects",
      async () => {
        const runtime =
          new ForgeRuntime({
            managerRegistry:
              registerVersionOneManagers(),

            contextStore:
              createCanonicalContextStore(),

            contextContributionApplier:
              new ContextContributionApplier(),

            governanceEvaluator: {
              evaluate() {
                return {
                  decision:
                    "rejected",
                };
              },
            },
          });

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.repository-inspection-rejected",
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Requests repository inspection rejected by governance.",
            provenance: {
              requestId:
                "request-2",
              workflowId:
                "workflow-2",
              correlationId:
                "correlation-2",
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

        await runtime.dispatch(
          request,
        );

        const context =
          runtime.contextStore.getCurrent();

        expect(
          context.payload.contributionHistory.length,
        ).toBe(0);
      },
    );

  },
);
