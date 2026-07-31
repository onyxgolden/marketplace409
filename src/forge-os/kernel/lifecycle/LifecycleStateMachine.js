const ALLOWED_TRANSITIONS = Object.freeze({
  uninitialized: Object.freeze([
    "initializing",
  ]),

  initializing: Object.freeze([
    "context-loading",
    "failed",
  ]),

  "context-loading": Object.freeze([
    "manager-registration",
    "failed",
  ]),

  "manager-registration": Object.freeze([
    "contract-validation",
    "failed",
  ]),

  "contract-validation": Object.freeze([
    "workspace-discovery",
    "failed",
  ]),

  "workspace-discovery": Object.freeze([
    "ready",
    "failed",
  ]),

  ready: Object.freeze([
    "planning",
    "failed",
  ]),

  planning: Object.freeze([
    "awaiting-authority",
    "ready",
    "failed",
  ]),

  "awaiting-authority": Object.freeze([
    "executing",
    "planning",
    "failed",
  ]),

  executing: Object.freeze([
    "validating",
    "recovering",
    "failed",
  ]),

  validating: Object.freeze([
    "governing",
    "recovering",
    "failed",
  ]),

  governing: Object.freeze([
    "updating-context",
    "recovering",
    "failed",
  ]),

  "updating-context": Object.freeze([
    "ready",
    "recovering",
    "failed",
  ]),

  recovering: Object.freeze([
    "recovered",
    "failed",
  ]),

  recovered: Object.freeze([
    "ready",
  ]),

  degraded: Object.freeze([
    "ready",
    "failed",
  ]),

  failed: Object.freeze([
    "recovering",
    "shutting-down",
  ]),

  "shutting-down": Object.freeze([
    "stopped",
  ]),

  stopped: Object.freeze([]),
});

export class LifecycleStateMachine {
  constructor(initialState) {
    if (!initialState) {
      throw new Error(
        "LifecycleStateMachine requires an initial state.",
      );
    }

    this.currentState = initialState;
  }

  getCurrentState() {
    return this.currentState;
  }

  canTransitionTo(nextState) {
    const allowed =
      ALLOWED_TRANSITIONS[
        this.currentState
      ] ?? [];

    return allowed.includes(nextState);
  }

  transitionTo(nextState) {
    if (!this.canTransitionTo(nextState)) {
      throw new Error(
        `Invalid lifecycle transition: ${this.currentState} -> ${nextState}`,
      );
    }

    const previousState =
      this.currentState;

    this.currentState =
      nextState;

    return {
      fromState: previousState,
      toState: nextState,
    };
  }
}
