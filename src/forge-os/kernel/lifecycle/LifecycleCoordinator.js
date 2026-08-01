import {
  createContractVersion,
  createLifecycleTransitionContract,
  createLifecycleTransitionEventContract,
} from "../../contracts/v1/index.js";

import {
  LifecycleStateMachine,
} from "./LifecycleStateMachine.js";

export class LifecycleCoordinator {
  constructor({
    initialState = "ready",
    eventSink,
  } = {}) {
    this.stateMachine =
      new LifecycleStateMachine(
        initialState,
      );

    this.eventSink =
      eventSink;
  }

  getCurrentState() {
    return this.stateMachine
      .getCurrentState();
  }

  transition({
    contractId,
    description,
    provenance,
    toState,
    initiatingCause,
    authorityDecision,
    governanceDecision,
    evidenceReferences = [],
    correlationIdentity,
    contextVersion,
  }) {
    const transition =
      this.stateMachine.transitionTo(
        toState,
      );

    const lifecycleTransition =
      createLifecycleTransitionContract({
        contractId,
        version:
          createContractVersion({
            major: 1,
            minor: 0,
            patch: 0,
          }),
        description,
        provenance,
        transitionId:
          `${transition.fromState}-${transition.toState}`,
        lifecycleDomain:
          "kernel",
        fromState:
          transition.fromState,
        toState:
          transition.toState,
        initiatingCause,
        authorityDecision,
        governanceDecision,
        evidenceReferences,
        correlationIdentity,
        contextVersion,
      });

    if (this.eventSink) {
      this.eventSink.record(
        createLifecycleTransitionEventContract({
          contractId:
            `${contractId}.event`,
          version:
            createContractVersion({
              major: 1,
              minor: 0,
              patch: 0,
            }),
          description:
            "Lifecycle transition event.",
          provenance,
          eventId:
            `${transition.fromState}-${transition.toState}-event`,
          eventType:
            "lifecycle_transition",
          transitionId:
            lifecycleTransition.payload.transitionId,
          lifecycleDomain:
            lifecycleTransition.payload.lifecycleDomain,
          contextVersion,
          correlationIdentity,
          evidenceReferences,
        }),
      );
    }

    return lifecycleTransition;
  }
}
