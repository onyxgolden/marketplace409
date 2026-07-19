import {
  describe,
  expect,
  test,
  vi,
} from "vitest";

import {
  executeGovernanceStages,
} from "../executeGovernanceStages.mjs";

describe(
  "executeGovernanceStages",
  () => {
    test(
      "executes stages deterministically in declared order",
      () => {
        const calls = [];

        const executeStage = vi.fn(
          (
            name,
            scriptPath,
            args,
          ) => {
            calls.push({
              name,
              scriptPath,
              args: [...args],
            });

            return `${name}-result`;
          },
        );

        const result =
          executeGovernanceStages({
            stages: [
              {
                name:
                  "COLLECT SESSION EVIDENCE",
                scriptPath:
                  "scripts/governance/collectSessionEvidence.mjs",
              },
              {
                name:
                  "VALIDATE SESSION SNAPSHOT",
                scriptPath:
                  "scripts/governance/validateSessionSnapshot.mjs",
                args: [
                  "governance/snapshots/example.json",
                ],
              },
            ],
            executeStage,
          });

        expect(calls).toEqual([
          {
            name:
              "COLLECT SESSION EVIDENCE",
            scriptPath:
              "scripts/governance/collectSessionEvidence.mjs",
            args: [],
          },
          {
            name:
              "VALIDATE SESSION SNAPSHOT",
            scriptPath:
              "scripts/governance/validateSessionSnapshot.mjs",
            args: [
              "governance/snapshots/example.json",
            ],
          },
        ]);

        expect(result).toEqual([
          "COLLECT SESSION EVIDENCE-result",
          "VALIDATE SESSION SNAPSHOT-result",
        ]);

        expect(
          Object.isFrozen(result),
        ).toBe(true);
      },
    );

    test(
      "stops immediately when a stage fails",
      () => {
        const executeStage = vi.fn(
          (name) => {
            if (name === "SECOND") {
              throw new Error(
                "stage failure",
              );
            }

            return name;
          },
        );

        expect(() =>
          executeGovernanceStages({
            stages: [
              {
                name: "FIRST",
                scriptPath:
                  "scripts/first.mjs",
              },
              {
                name: "SECOND",
                scriptPath:
                  "scripts/second.mjs",
              },
              {
                name: "THIRD",
                scriptPath:
                  "scripts/third.mjs",
              },
            ],
            executeStage,
          }),
        ).toThrow("stage failure");

        expect(
          executeStage,
        ).toHaveBeenCalledTimes(2);
      },
    );

    test.each([
      {
        stages: null,
        executeStage: () => {},
        message:
          "stages must be an array",
      },
      {
        stages: [],
        executeStage: null,
        message:
          "executeStage must be a function",
      },
    ])(
      "rejects invalid executor input",
      ({
        stages,
        executeStage,
        message,
      }) => {
        expect(() =>
          executeGovernanceStages({
            stages,
            executeStage,
          }),
        ).toThrow(message);
      },
    );

    test.each([
      {
        stage: null,
        message:
          "stage at index 0 must be an object",
      },
      {
        stage: {},
        message:
          "stage at index 0 name must be a non-empty string",
      },
      {
        stage: {
          name: "TEST",
        },
        message:
          "stage at index 0 scriptPath must be a non-empty string",
      },
      {
        stage: {
          name: "TEST",
          scriptPath:
            "scripts/test.mjs",
          args: "invalid",
        },
        message:
          "stage at index 0 args must be an array",
      },
    ])(
      "rejects an invalid stage definition",
      ({
        stage,
        message,
      }) => {
        expect(() =>
          executeGovernanceStages({
            stages: [stage],
            executeStage: () => {},
          }),
        ).toThrow(message);
      },
    );

    test(
      "does not mutate stage definitions or argument arrays",
      () => {
        const args = [
          "snapshot.json",
        ];

        const stage = {
          name: "VALIDATE",
          scriptPath:
            "scripts/validate.mjs",
          args,
        };

        executeGovernanceStages({
          stages: [stage],
          executeStage: (
            name,
            scriptPath,
            stageArgs,
          ) => {
            stageArgs.push(
              "executor-mutation",
            );

            return {
              name,
              scriptPath,
            };
          },
        });

        expect(args).toEqual([
          "snapshot.json",
        ]);

        expect(stage).toEqual({
          name: "VALIDATE",
          scriptPath:
            "scripts/validate.mjs",
          args: [
            "snapshot.json",
          ],
        });
      },
    );
  },
);
