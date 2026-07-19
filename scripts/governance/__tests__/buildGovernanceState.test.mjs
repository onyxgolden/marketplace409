import {
  describe,
  expect,
  test,
} from "vitest";

import {
  buildGovernanceState,
} from "../buildGovernanceState.mjs";

function createGovernanceState() {
  return {
    state: {
      activePhase: {
        identifier:
          "15.9",
        title:
          "Conversation Continuity & Governance Intelligence",
        status:
          "incomplete",
      },

      currentObjective:
        "Introduce a deterministic governance state builder.",

      completedWork: [
        "Inspected the current governance-state contract.",
        "Created the pure governance-state builder.",
      ],

      knownWarnings: [
        "Human approval remains required for objective selection.",
      ],

      nextSession: {
        objective:
          "Integrate the governance-state builder into generation.",

        startingInspection:
          "Inspect the generated governance-state diff and focused tests.",
      },
    },
  };
}

describe(
  "buildGovernanceState",
  () => {
    test(
      "returns the exact governance state contract",
      () => {
        const currentGovernanceState =
          createGovernanceState();

        expect(
          buildGovernanceState({
            currentGovernanceState,
          }),
        ).toEqual(
          currentGovernanceState.state,
        );
      },
    );

    test(
      "returns an immutable copy of nested state values",
      () => {
        const currentGovernanceState =
          createGovernanceState();

        const result =
          buildGovernanceState({
            currentGovernanceState,
          });

        expect(result).not.toBe(
          currentGovernanceState.state,
        );

        expect(result.activePhase).not.toBe(
          currentGovernanceState.state.activePhase,
        );

        expect(result.completedWork).not.toBe(
          currentGovernanceState.state.completedWork,
        );

        expect(result.knownWarnings).not.toBe(
          currentGovernanceState.state.knownWarnings,
        );

        expect(result.nextSession).not.toBe(
          currentGovernanceState.state.nextSession,
        );
      },
    );

    test(
      "rejects a non-object governance state",
      () => {
        expect(
          () =>
            buildGovernanceState({
              currentGovernanceState:
                null,
            }),
        ).toThrow(
          "currentGovernanceState must be an object",
        );
      },
    );

    test(
      "rejects a missing state object",
      () => {
        expect(
          () =>
            buildGovernanceState({
              currentGovernanceState:
                {},
            }),
        ).toThrow(
          "currentGovernanceState.state must be an object",
        );
      },
    );

    test(
      "rejects invalid completed work entries",
      () => {
        const currentGovernanceState =
          createGovernanceState();

        currentGovernanceState
          .state
          .completedWork = [
            "",
          ];

        expect(
          () =>
            buildGovernanceState({
              currentGovernanceState,
            }),
        ).toThrow(
          "currentGovernanceState.state.completedWork[0] must be a non-empty string",
        );
      },
    );

    test(
      "rejects invalid next-session values",
      () => {
        const currentGovernanceState =
          createGovernanceState();

        currentGovernanceState
          .state
          .nextSession
          .objective = "";

        expect(
          () =>
            buildGovernanceState({
              currentGovernanceState,
            }),
        ).toThrow(
          "currentGovernanceState.state.nextSession.objective must be a non-empty string",
        );
      },
    );
  },
);
