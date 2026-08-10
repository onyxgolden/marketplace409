import {
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  executeProgrammerCommand,
} from "./executeProgrammerCommand";

describe(
  "executeProgrammerCommand",
  () => {
    it(
      "runs only the registered repository-status steps",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              "## main...origin/main\n",
            stderr: "",
          });

        const result =
          executeProgrammerCommand({
            commandId:
              "repository-status",
            repositoryRoot:
              process.cwd(),
            spawnSyncFn,
            vercelEnvironment:
              undefined,
          });

        expect(
          result.status,
        ).toBe("passing");

        expect(
          result.steps,
        ).toHaveLength(2);

        expect(
          spawnSyncFn,
        ).toHaveBeenCalledTimes(2);

        expect(
          spawnSyncFn.mock.calls[0][0],
        ).toBe("git");

        expect(
          spawnSyncFn.mock.calls[0][1],
        ).toEqual([
          "status",
          "--short",
          "--branch",
        ]);
      },
    );

    it(
      "removes terminal color codes from displayed output",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              "\u001b[32mPASS\u001b[39m\n",
            stderr: "",
          });

        const result =
          executeProgrammerCommand({
            commandId:
              "repository-status",
            repositoryRoot:
              process.cwd(),
            spawnSyncFn,
            vercelEnvironment:
              undefined,
          });

        expect(
          result.steps[0].output,
        ).toBe("PASS");

        expect(
          result.steps[0].output,
        ).not.toContain(
          "\u001b",
        );
      },
    );

    it(
      "rejects an unregistered command",
      () => {
        expect(
          () =>
            executeProgrammerCommand({
              commandId:
                "arbitrary-shell-command",
              repositoryRoot:
                process.cwd(),
            }),
        ).toThrow(
          "Programmer command is not allowlisted.",
        );
      },
    );

    it(
      "disables execution on Vercel",
      () => {
        expect(
          () =>
            executeProgrammerCommand({
              commandId:
                "repository-status",
              repositoryRoot:
                process.cwd(),
              vercelEnvironment:
                "1",
            }),
        ).toThrow(
          "Repository commands are disabled on Vercel.",
        );
      },
    );

    it(
      "stops after a failing command step",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 1,
            stdout: "",
            stderr:
              "Repository unavailable.",
          });

        const result =
          executeProgrammerCommand({
            commandId:
              "repository-status",
            repositoryRoot:
              process.cwd(),
            spawnSyncFn,
            vercelEnvironment:
              undefined,
          });

        expect(
          result.status,
        ).toBe("failing");

        expect(
          result.steps,
        ).toHaveLength(1);

        expect(
          spawnSyncFn,
        ).toHaveBeenCalledOnce();
      },
    );
  },
);
