import fs from "node:fs";
import os from "node:os";

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

    it(
      "fails loudly when reviewed metadata is supplied for a command that does not require session review",
      () => {
        const spawnSyncFn =
          vi.fn();

        expect(
          () =>
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
                  "16.9",
              },
            }),
        ).toThrow(
          "not flagged to accept it",
        );

        expect(
          spawnSyncFn,
        ).not.toHaveBeenCalled();
      },
    );

    it(
      "fails a review-required command when no reviewed metadata was supplied at all",
      () => {
        const spawnSyncFn =
          vi.fn().mockReturnValue({
            status: 0,
            stdout:
              "Review required: phase, objectives, delivered work, validation, completion, and next-session fields were not inferred.",
            stderr: "",
          });

        const result =
          executeProgrammerCommand({
            commandId:
              "prepare-next-session",
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
          result.steps.at(-1)
            .status,
        ).toBe("failing");

        expect(
          result.steps.at(-1)
            .output,
        ).toContain(
          "FORGE INVARIANT VIOLATION",
        );

        expect(
          result.steps.at(-1)
            .output,
        ).toContain(
          "No reviewed metadata was supplied",
        );
      },
    );

    describe(
      "structured application proof (snapshot identity + field-level comparison)",
      () => {
        const NEW_SNAPSHOT_NAME =
          "forge-session-20260811-120000123.json";

        const NEW_SNAPSHOT_RELATIVE_PATH = `governance/snapshots/${NEW_SNAPSHOT_NAME}`;

        const submittedMetadata = {
          phaseIdentifier: "16.9",
          phaseTitle:
            "Reviewed closeout proposal",
          endingObjective:
            "Ship the deterministic closeout proposal workflow.",
          deliveredWork: [
            "Added the deterministic proposal builder.",
          ],
          knownWarnings: [
            "Legacy claimed warning remains pre-existing.",
          ],
          markSessionComplete:
            true,
          nextSessionObjective:
            "Visually verify the populated proposal in the dashboard.",
        };

        function successfulSpawnSyncFn() {
          return vi
            .fn()
            .mockReturnValue({
              status: 0,
              stdout:
                "Reviewed session metadata applied: reviewed-metadata.json",
              stderr: "",
            });
        }

        function twoPhaseListSnapshotNamesFn(
          afterNames,
        ) {
          return vi
            .fn()
            .mockReturnValueOnce(
              new Set(),
            )
            .mockReturnValue(
              new Set(afterNames),
            );
        }

        function matchingSnapshot(
          overrides = {},
        ) {
          return {
            phase: {
              identifier:
                "16.9",
              title:
                "Reviewed closeout proposal",
              status:
                "incomplete",
            },
            objective: {
              startingObjective:
                "REVIEW_REQUIRED",
              endingObjective:
                "Ship the deterministic closeout proposal workflow.",
            },
            work: {
              delivered: [
                "Added the deterministic proposal builder.",
              ],
              knownWarnings: [
                "Legacy claimed warning remains pre-existing.",
              ],
            },
            completion: {
              workComplete:
                true,
              supportedByEvidence:
                true,
              incompleteReason:
                null,
            },
            nextSession: {
              objective:
                "Visually verify the populated proposal in the dashboard.",
              startingInspection:
                "REVIEW_REQUIRED",
            },
            repository: {
              head: "a".repeat(
                40,
              ),
            },
            validation: {
              focusedTests: {
                status:
                  "passing",
              },
              fullTests: {
                status:
                  "passing",
              },
              productionBuild:
                {
                  status:
                    "passing",
                },
            },
            evidence: {
              selectedValidationArtifact:
                {
                  repositoryHead:
                    "a".repeat(
                      40,
                    ),
                },
            },
            ...overrides,
          };
        }

        function completeGovernanceStateFields() {
          return {
            activePhase: {
              identifier: "16.9",
              title:
                "Reviewed closeout proposal",
            },
            currentObjective:
              "Ship the deterministic closeout proposal workflow.",
            nextSession: {
              objective:
                "Visually verify the populated proposal in the dashboard.",
              startingInspection:
                "Inspect the synchronized documents.",
            },
          };
        }

        function syncedStatePointingAt(
          relativeSnapshotPath,
          overrides = {},
        ) {
          return {
            state:
              completeGovernanceStateFields(),
            session: {
              latestSnapshot:
                relativeSnapshotPath,
            },
            synchronization: {
              sourceSnapshot:
                relativeSnapshotPath,
            },
            ...overrides,
          };
        }

        it(
          "passes when the synced state points at this run's own snapshot and every submitted field matches",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(),
                },
              );

            expect(
              result.status,
              JSON.stringify(
                result,
                null,
                2,
              ),
            ).toBe("passing");
          },
        );

        it(
          "fails when the synced state points at a prior, fully populated snapshot instead of the one this run created (stale pointer masking loss)",
          () => {
            const priorRunSnapshotPath =
              "governance/snapshots/forge-session-20260810-090000000.json";

            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  // Deliberately a FULLY POPULATED state -- no
                  // REVIEW_REQUIRED anywhere -- but sourced from a
                  // different (prior) session's snapshot. A naive
                  // "no REVIEW_REQUIRED values" check would pass this;
                  // the identity check must not.
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        priorRunSnapshotPath,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(),
                },
              );

            expect(
              result.status,
            ).toBe("failing");

            expect(
              result.steps.at(-1)
                .output,
            ).toContain(
              "different snapshot",
            );
          },
        );

        it(
          "detects a stale snapshot path even when only the synchronization.sourceSnapshot pointer disagrees",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () => ({
                      state:
                        completeGovernanceStateFields(),
                      session: {
                        latestSnapshot:
                          NEW_SNAPSHOT_RELATIVE_PATH,
                      },
                      synchronization:
                        {
                          sourceSnapshot:
                            "governance/snapshots/forge-session-stale.json",
                        },
                    }),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(),
                },
              );

            expect(
              result.status,
            ).toBe("failing");

            expect(
              result.steps.at(-1)
                .output,
            ).toContain(
              "different snapshot",
            );
          },
        );

        it(
          "detects changed deliveredWork even though the snapshot otherwise matches",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(
                        {
                          work: {
                            delivered:
                              [
                                "A DIFFERENT item that was not submitted.",
                              ],
                            knownWarnings:
                              [
                                "Legacy claimed warning remains pre-existing.",
                              ],
                          },
                        },
                      ),
                },
              );

            expect(
              result.status,
            ).toBe("failing");

            expect(
              result.steps.at(-1)
                .output,
            ).toContain(
              'Field "deliveredWork" was not applied as submitted',
            );
          },
        );

        it(
          "detects changed knownWarnings even though the snapshot otherwise matches",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(
                        {
                          work: {
                            delivered:
                              [
                                "Added the deterministic proposal builder.",
                              ],
                            knownWarnings:
                              [],
                          },
                        },
                      ),
                },
              );

            expect(
              result.status,
            ).toBe("failing");

            expect(
              result.steps.at(-1)
                .output,
            ).toContain(
              'Field "knownWarnings" was not applied as submitted',
            );
          },
        );

        it(
          "detects incorrect completion resolution when markSessionComplete was approved but the snapshot never resolved workComplete to true",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(
                        {
                          completion:
                            {
                              workComplete: false,
                              supportedByEvidence: false,
                              incompleteReason:
                                "Validation evidence does not yet cover a passing result for the current commit.",
                            },
                        },
                      ),
                },
              );

            expect(
              result.status,
            ).toBe("failing");

            expect(
              result.steps.at(-1)
                .output,
            ).toContain(
              'Field "markSessionComplete" was not applied as submitted',
            );
          },
        );

        it(
          "does not flag markSessionComplete when the snapshot correctly resolves it to false because validation evidence does not cover the current commit, matching what was actually submitted",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    {
                      ...submittedMetadata,
                      markSessionComplete: false,
                    },
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(
                        {
                          completion:
                            {
                              workComplete: false,
                              supportedByEvidence: false,
                              incompleteReason:
                                "Human review is required.",
                            },
                        },
                      ),
                },
              );

            expect(
              result.status,
              JSON.stringify(
                result,
                null,
                2,
              ),
            ).toBe("passing");
          },
        );

        it(
          "exact-match layer: treats fields the reviewer did not submit as not-compared, never as false mismatches (separate from the completeness policy below)",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  // Only two fields submitted -- everything else is
                  // intentionally omitted and must not be compared.
                  reviewedMetadata:
                    {
                      phaseIdentifier:
                        "16.9",
                      markSessionComplete: false,
                    },
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(
                        {
                          // Everything the reviewer did NOT submit is
                          // still REVIEW_REQUIRED -- that must be fine.
                          objective:
                            {
                              startingObjective:
                                "REVIEW_REQUIRED",
                              endingObjective:
                                "REVIEW_REQUIRED",
                            },
                          work: {
                            delivered:
                              [],
                            knownWarnings:
                              [],
                          },
                          nextSession:
                            {
                              objective:
                                "REVIEW_REQUIRED",
                              startingInspection:
                                "REVIEW_REQUIRED",
                            },
                          completion:
                            {
                              workComplete: false,
                              supportedByEvidence: false,
                              incompleteReason:
                                null,
                            },
                        },
                      ),
                },
              );

            expect(
              result.status,
              JSON.stringify(
                result,
                null,
                2,
              ),
            ).toBe("passing");
          },
        );

        describe(
          "completeness policy (reuses requiresHumanReview from scripts/conversation/requiresHumanReview.mjs)",
          () => {
            it(
              "fails when an exact-match-passing but sparse payload omits a policy-required field, leaving it REVIEW_REQUIRED",
              () => {
                const result =
                  executeProgrammerCommand(
                    {
                      commandId:
                        "prepare-next-session",
                      repositoryRoot:
                        process.cwd(),
                      spawnSyncFn:
                        successfulSpawnSyncFn(),
                      vercelEnvironment:
                        undefined,
                      // Only phaseIdentifier submitted. phaseTitle,
                      // currentObjective, and both nextSession fields
                      // were never supplied, so the resulting state
                      // still shows them REVIEW_REQUIRED. The
                      // exact-match layer has nothing to complain
                      // about (nothing submitted for those fields
                      // disagrees with the snapshot) -- only the
                      // completeness policy catches this.
                      reviewedMetadata:
                        {
                          phaseIdentifier:
                            "16.9",
                          markSessionComplete: false,
                        },
                      listSnapshotNamesFn:
                        twoPhaseListSnapshotNamesFn(
                          [
                            NEW_SNAPSHOT_NAME,
                          ],
                        ),
                      readSyncedGovernanceStateFn:
                        () =>
                          syncedStatePointingAt(
                            NEW_SNAPSHOT_RELATIVE_PATH,
                            {
                              state: {
                                activePhase:
                                  {
                                    identifier:
                                      "16.9",
                                    title:
                                      "REVIEW_REQUIRED",
                                  },
                                currentObjective:
                                  "REVIEW_REQUIRED",
                                nextSession:
                                  {
                                    objective:
                                      "REVIEW_REQUIRED",
                                    startingInspection:
                                      "REVIEW_REQUIRED",
                                  },
                              },
                            },
                          ),
                      readSnapshotFn:
                        () =>
                          matchingSnapshot(
                            {
                              phase: {
                                identifier:
                                  "16.9",
                                title:
                                  "REVIEW_REQUIRED",
                                status:
                                  "incomplete",
                              },
                              objective:
                                {
                                  startingObjective:
                                    "REVIEW_REQUIRED",
                                  endingObjective:
                                    "REVIEW_REQUIRED",
                                },
                              nextSession:
                                {
                                  objective:
                                    "REVIEW_REQUIRED",
                                  startingInspection:
                                    "REVIEW_REQUIRED",
                                },
                              completion:
                                {
                                  workComplete: false,
                                  supportedByEvidence: false,
                                  incompleteReason:
                                    null,
                                },
                            },
                          ),
                    },
                  );

                expect(
                  result.status,
                ).toBe("failing");

                expect(
                  result.steps.at(
                    -1,
                  ).output,
                ).toContain(
                  "still requires human review",
                );
              },
            );

            it(
              "passes when only the truly optional knownWarnings field is omitted, with every policy-required field populated",
              () => {
                const result =
                  executeProgrammerCommand(
                    {
                      commandId:
                        "prepare-next-session",
                      repositoryRoot:
                        process.cwd(),
                      spawnSyncFn:
                        successfulSpawnSyncFn(),
                      vercelEnvironment:
                        undefined,
                      reviewedMetadata:
                        {
                          phaseIdentifier:
                            "16.9",
                          phaseTitle:
                            "Reviewed closeout proposal",
                          endingObjective:
                            "Ship the deterministic closeout proposal workflow.",
                          nextSessionObjective:
                            "Visually verify the populated proposal in the dashboard.",
                          nextSessionStartingInspection:
                            "Inspect the synchronized documents.",
                          // knownWarnings intentionally omitted -- it
                          // is not part of requiresHumanReview's policy.
                          markSessionComplete: false,
                        },
                      listSnapshotNamesFn:
                        twoPhaseListSnapshotNamesFn(
                          [
                            NEW_SNAPSHOT_NAME,
                          ],
                        ),
                      readSyncedGovernanceStateFn:
                        () =>
                          syncedStatePointingAt(
                            NEW_SNAPSHOT_RELATIVE_PATH,
                          ),
                      readSnapshotFn:
                        () =>
                          matchingSnapshot(
                            {
                              work: {
                                delivered:
                                  [],
                                knownWarnings:
                                  [],
                              },
                              nextSession:
                                {
                                  objective:
                                    "Visually verify the populated proposal in the dashboard.",
                                  startingInspection:
                                    "Inspect the synchronized documents.",
                                },
                              completion:
                                {
                                  workComplete: false,
                                  supportedByEvidence: false,
                                  incompleteReason:
                                    null,
                                },
                            },
                          ),
                    },
                  );

                expect(
                  result.status,
                  JSON.stringify(
                    result,
                    null,
                    2,
                  ),
                ).toBe("passing");
              },
            );

            it(
              "passes for legitimately incomplete work: workComplete false with incompleteReason explaining why, as long as required governance fields are populated",
              () => {
                const result =
                  executeProgrammerCommand(
                    {
                      commandId:
                        "prepare-next-session",
                      repositoryRoot:
                        process.cwd(),
                      spawnSyncFn:
                        successfulSpawnSyncFn(),
                      vercelEnvironment:
                        undefined,
                      reviewedMetadata:
                        {
                          phaseIdentifier:
                            "16.9",
                          phaseTitle:
                            "Reviewed closeout proposal",
                          endingObjective:
                            "Ship the deterministic closeout proposal workflow.",
                          nextSessionObjective:
                            "Visually verify the populated proposal in the dashboard.",
                          nextSessionStartingInspection:
                            "Inspect the synchronized documents.",
                          incompleteReason:
                            "Focused tests were not run this session.",
                          markSessionComplete: false,
                        },
                      listSnapshotNamesFn:
                        twoPhaseListSnapshotNamesFn(
                          [
                            NEW_SNAPSHOT_NAME,
                          ],
                        ),
                      readSyncedGovernanceStateFn:
                        () =>
                          syncedStatePointingAt(
                            NEW_SNAPSHOT_RELATIVE_PATH,
                          ),
                      readSnapshotFn:
                        () =>
                          matchingSnapshot(
                            {
                              nextSession:
                                {
                                  objective:
                                    "Visually verify the populated proposal in the dashboard.",
                                  startingInspection:
                                    "Inspect the synchronized documents.",
                                },
                              completion:
                                {
                                  workComplete: false,
                                  supportedByEvidence: false,
                                  incompleteReason:
                                    "Focused tests were not run this session.",
                                },
                            },
                          ),
                    },
                  );

                expect(
                  result.status,
                  JSON.stringify(
                    result,
                    null,
                    2,
                  ),
                ).toBe("passing");
              },
            );

            it(
              "passes when the proposal is fully populated -- both the exact-match and completeness checks agree",
              () => {
                const result =
                  executeProgrammerCommand(
                    {
                      commandId:
                        "prepare-next-session",
                      repositoryRoot:
                        process.cwd(),
                      spawnSyncFn:
                        successfulSpawnSyncFn(),
                      vercelEnvironment:
                        undefined,
                      reviewedMetadata:
                        submittedMetadata,
                      listSnapshotNamesFn:
                        twoPhaseListSnapshotNamesFn(
                          [
                            NEW_SNAPSHOT_NAME,
                          ],
                        ),
                      readSyncedGovernanceStateFn:
                        () =>
                          syncedStatePointingAt(
                            NEW_SNAPSHOT_RELATIVE_PATH,
                          ),
                      readSnapshotFn:
                        () =>
                          matchingSnapshot(),
                    },
                  );

                expect(
                  result.status,
                  JSON.stringify(
                    result,
                    null,
                    2,
                  ),
                ).toBe("passing");

                expect(
                  result.steps.at(
                    -1,
                  ).output,
                ).not.toContain(
                  "FORGE INVARIANT VIOLATION",
                );
              },
            );
          },
        );

        it(
          "preserves the spawned command line on every step for diagnosis",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        NEW_SNAPSHOT_RELATIVE_PATH,
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(),
                },
              );

            expect(
              result.steps.at(-1)
                .command,
            ).toContain(
              "runEngineeringConversationSession.mjs",
            );
          },
        );

        it(
          "does not leak the reviewed-metadata temp file path in failure output",
          () => {
            const result =
              executeProgrammerCommand(
                {
                  commandId:
                    "prepare-next-session",
                  repositoryRoot:
                    process.cwd(),
                  spawnSyncFn:
                    successfulSpawnSyncFn(),
                  vercelEnvironment:
                    undefined,
                  reviewedMetadata:
                    submittedMetadata,
                  listSnapshotNamesFn:
                    twoPhaseListSnapshotNamesFn(
                      [
                        NEW_SNAPSHOT_NAME,
                      ],
                    ),
                  readSyncedGovernanceStateFn:
                    () =>
                      syncedStatePointingAt(
                        "governance/snapshots/forge-session-stale.json",
                      ),
                  readSnapshotFn:
                    () =>
                      matchingSnapshot(),
                },
              );

            expect(
              result.status,
            ).toBe("failing");

            expect(
              result.steps.at(-1)
                .output,
            ).not.toContain(
              "forge-reviewed-metadata-",
            );

            expect(
              result.steps.at(-1)
                .output,
            ).not.toContain(
              os.tmpdir(),
            );
          },
        );
      },
    );
  },
);
