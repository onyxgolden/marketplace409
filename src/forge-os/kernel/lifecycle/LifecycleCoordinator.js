import {
  createContractVersion,
  createLifecycleTransitionContract,
} from "../../contracts/v1/index.js";

import {
  LifecycleStateMachine,
} from "./LifecycleStateMachine.js";

export class LifecycleCoordinator {
  constructor({
    initialState = "ready",
  } = {}) {
    this.stateMachine =
      new LifecycleStateMachine(
        initialState,
      );
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

    return createLifecycleTransitionContract({
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
  }
}
