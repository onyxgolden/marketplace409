import {
  describe,
  expect,
  it,
} from "vitest";

import {
  LifecycleStateMachine,
} from "../LifecycleStateMachine.js";

describe("LifecycleStateMachine", () => {
  it("allows valid lifecycle transitions", () => {
    const machine =
      new LifecycleStateMachine(
        "ready",
      );

    expect(
      machine.canTransitionTo(
        "planning",
      ),
    ).toBe(true);

    expect(
      machine.transitionTo(
        "planning",
      ),
    ).toEqual({
      fromState: "ready",
      toState: "planning",
    });

    expect(
      machine.getCurrentState(),
    ).toBe("planning");
  });

  it("rejects invalid lifecycle transitions", () => {
    const machine =
      new LifecycleStateMachine(
        "ready",
      );

    expect(
      machine.canTransitionTo(
        "executing",
      ),
    ).toBe(false);

    expect(() =>
      machine.transitionTo(
        "executing",
      ),
    ).toThrow();
  });

  it("supports recovery transitions", () => {
    const machine =
      new LifecycleStateMachine(
        "executing",
      );

    expect(
      machine.transitionTo(
        "recovering",
      ),
    ).toEqual({
      fromState: "executing",
      toState: "recovering",
    });
  });

  it("supports governance completion without context updates", () => {
    const machine =
      new LifecycleStateMachine(
        "governing",
      );

    expect(
      machine.transitionTo(
        "ready",
      ),
    ).toEqual({
      fromState: "governing",
      toState: "ready",
    });

    expect(
      machine.getCurrentState(),
    ).toBe("ready");
  });

  it("supports governance completion with context updates", () => {
    const machine =
      new LifecycleStateMachine(
        "governing",
      );

    expect(
      machine.transitionTo(
        "updating-context",
      ),
    ).toEqual({
      fromState: "governing",
      toState: "updating-context",
    });
  });
});
