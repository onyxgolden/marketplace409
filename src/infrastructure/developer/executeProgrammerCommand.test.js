import fs from "node:fs";

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
      "runs tests with the test Node environment",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              "Tests passed.",
            stderr: "",
          });

        executeProgrammerCommand({
          commandId:
            "full-tests",
          repositoryRoot:
            process.cwd(),
          spawnSyncFn,
          vercelEnvironment:
            undefined,
        });

        expect(
          spawnSyncFn.mock.calls[0][2]
            .env.NODE_ENV,
        ).toBe("test");
      },
    );

    it(
      "runs builds with the production Node environment",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              "Build passed.",
            stderr: "",
          });

        executeProgrammerCommand({
          commandId:
            "production-build",
          repositoryRoot:
            process.cwd(),
          spawnSyncFn,
          vercelEnvironment:
            undefined,
        });

        expect(
          spawnSyncFn.mock.calls[0][2]
            .env.NODE_ENV,
        ).toBe(
          "production",
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
      "writes reviewed session metadata to a temp file, passes its path to the session script, and cleans it up",
      () => {
        let capturedMetadataPath = null;
        let capturedMetadataContents = null;

        const spawnSyncFn =
          vi.fn(
            (
              command,
              args,
            ) => {
              const metadataArg =
                args.find(
                  (arg) =>
                    arg.endsWith(
                      "reviewed-session-metadata.json",
                    ),
                );

              if (metadataArg) {
                capturedMetadataPath =
                  metadataArg;

                capturedMetadataContents =
                  JSON.parse(
                    fs.readFileSync(
                      metadataArg,
                      "utf8",
                    ),
                  );
              }

              return {
                status: 0,
                stdout:
                  "ok",
                stderr: "",
              };
            },
          );

        executeProgrammerCommand({
          commandId:
            "prepare-next-session",
          repositoryRoot:
            process.cwd(),
          spawnSyncFn,
          vercelEnvironment:
            undefined,
          reviewedMetadata: {
            phaseIdentifier:
              "Phase 16",
            markSessionComplete: true,
          },
        });

        expect(
          capturedMetadataPath,
        ).toMatch(
          /reviewed-session-metadata\.json$/,
        );

        expect(
          capturedMetadataContents,
        ).toEqual({
          phaseIdentifier:
            "Phase 16",
          markSessionComplete: true,
        });

        expect(
          fs.existsSync(
            capturedMetadataPath,
          ),
        ).toBe(false);
      },
    );

    it(
      "ignores reviewed metadata for commands that do not require session review",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              "## main...origin/main\n",
            stderr: "",
          });

        executeProgrammerCommand({
          commandId:
            "repository-status",
          repositoryRoot:
            process.cwd(),
          spawnSyncFn,
          vercelEnvironment:
            undefined,
          reviewedMetadata: {
            phaseIdentifier:
              "Phase 16",
          },
        });

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
      "rejects invalid reviewed metadata before running any command steps",
      () => {
        const spawnSyncFn =
          vi.fn();

        expect(
          () =>
            executeProgrammerCommand({
              commandId:
                "complete-session-closeout",
              repositoryRoot:
                process.cwd(),
              spawnSyncFn,
              vercelEnvironment:
                undefined,
              reviewedMetadata: {
                phaseIdentifier: 12345,
              },
            }),
        ).toThrow(
          "phaseIdentifier must be a string",
        );

        expect(
          spawnSyncFn,
        ).not.toHaveBeenCalled();
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
