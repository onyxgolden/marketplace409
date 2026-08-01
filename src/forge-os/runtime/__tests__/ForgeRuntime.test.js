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

import {
  LifecycleCoordinator,
} from "../../kernel/lifecycle/LifecycleCoordinator.js";


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


    it(
      "preserves lineage identifiers through lifecycle transition history",
      async () => {
        const lifecycleTransitions = [];

        const runtime =
          new ForgeRuntime({
            managerRegistry:
              registerVersionOneManagers(),

            contextStore:
              createCanonicalContextStore(),

            contextContributionApplier:
              new ContextContributionApplier(),

            lifecycleCoordinatorFactory:
              () => ({
                transition(input) {
                  lifecycleTransitions.push(input);
                },
              }),
          });

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.repository-inspection-lineage-history",
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Validates lifecycle lineage preservation.",
            provenance: {
              requestId:
                "request-lineage-history-1",
              workflowId:
                "workflow-lineage-history-1",
              correlationId:
                "correlation-lineage-history-1",
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "forge-runtime-lineage",
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

        expect(
          lifecycleTransitions.length,
        ).toBeGreaterThan(0);

        for (const transition of lifecycleTransitions) {
          expect(
            transition.provenance.requestId,
          ).toBe(
            "request-lineage-history-1",
          );

          expect(
            transition.provenance.workflowId,
          ).toBe(
            "workflow-lineage-history-1",
          );

          expect(
            transition.provenance.correlationId,
          ).toBe(
            "correlation-lineage-history-1",
          );
        }

        const validatingTransition =
          lifecycleTransitions.find(
            (transition) =>
              transition.toState === "validating",
          );

        expect(
          validatingTransition.evidenceReferences,
        ).toBeDefined();

        const contextTransition =
          lifecycleTransitions.find(
            (transition) =>
              transition.toState === "updating-context",
          );

        expect(
          contextTransition.governanceDecision,
        ).toBeDefined();
      },
    );



    it(
      "preserves context evolution history across sequential executions",
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

        const createRequest = (id) =>
          createManagerRequestContract({
            contractId:
              `forge.request.sequential-${id}`,
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Sequential context evolution validation.",
            provenance: {
              requestId:
                `request-sequential-${id}`,
              workflowId:
                "workflow-sequential-test",
              correlationId:
                `correlation-sequential-${id}`,
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "forge-runtime-state-integrity",
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

        const firstContext =
          runtime.contextStore.getCurrent();

        expect(
          firstContext.payload.contributionHistory.length,
        ).toBe(1);

        const firstEvolution =
          firstContext.payload.contributionHistory[0];

        await runtime.dispatch(
          createRequest("two"),
        );

        const secondContext =
          runtime.contextStore.getCurrent();

        expect(
          secondContext.payload.contributionHistory.length,
        ).toBe(2);

        expect(
          secondContext.payload.contributionHistory[0],
        ).toBe(
          firstEvolution,
        );

        expect(
          secondContext.payload.contributionHistory[1]
            .payload.sequence,
        ).toBe(2);
      },
    );



    it(
      "does not apply context mutations when evidence processing fails",
      async () => {
        const runtime =
          new ForgeRuntime({
            managerRegistry:
              registerVersionOneManagers(),

            contextStore:
              createCanonicalContextStore(),

            contextContributionApplier:
              new ContextContributionApplier(),

            evidenceCoordinator: {
              process() {
                throw new Error(
                  "Evidence validation failed.",
                );
              },
            },
          });

        const initialContext =
          runtime.contextStore.getCurrent();

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.evidence-failure",
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Validates evidence failure recovery.",
            provenance: {
              requestId:
                "request-evidence-failure-1",
              workflowId:
                "workflow-evidence-failure-1",
              correlationId:
                "correlation-evidence-failure-1",
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "forge-runtime-recovery",
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

        await expect(
          runtime.dispatch(
            request,
          ),
        ).rejects.toThrow(
          "Evidence validation failed.",
        );

        const currentContext =
          runtime.contextStore.getCurrent();

        expect(
          currentContext,
        ).toBe(
          initialContext,
        );

        expect(
          currentContext.payload.contributionHistory.length,
        ).toBe(0);
      },
    );



    it(
      "propagates lifecycle events through runtime execution",
      async () => {
        const events = [];

        const runtime =
          new ForgeRuntime({
            managerRegistry:
              registerVersionOneManagers(),

            contextStore:
              createCanonicalContextStore(),

            contextContributionApplier:
              new ContextContributionApplier(),

            lifecycleCoordinatorFactory:
              () =>
                new LifecycleCoordinator({
                  eventSink: {
                    record(event) {
                      events.push(event);
                    },
                  },
                }),
          });

        const request =
          createManagerRequestContract({
            contractId:
              "forge.request.runtime-events",
            version:
              {
                major: 1,
                minor: 0,
                patch: 0,
                identifier: "1.0.0",
              },
            description:
              "Validates runtime event propagation.",
            provenance: {
              requestId:
                "request-runtime-events-1",
              workflowId:
                "workflow-runtime-events-1",
              correlationId:
                "correlation-runtime-events-1",
              origin: {
                componentType:
                  "runtime-test",
                componentId:
                  "forge-runtime-events",
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

        expect(
          events.length,
        ).toBeGreaterThan(0);

        expect(
          events[0].payload.correlationIdentity,
        ).toBe(
          "correlation-runtime-events-1",
        );

        expect(
          events.map(
            (event) =>
              event.payload.transitionId,
          ),
        ).toEqual([
          "ready-planning",
          "planning-awaiting-authority",
          "awaiting-authority-executing",
          "executing-validating",
          "validating-governing",
          "governing-updating-context",
          "updating-context-ready",
        ]);
      },
    );


  },
);
