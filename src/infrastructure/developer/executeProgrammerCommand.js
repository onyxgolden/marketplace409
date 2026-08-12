import {
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  getProgrammerCommand,
} from "@/application/developer/ProgrammerCommandRegistry";

import {
  validateReviewedSessionMetadata,
} from "../../../scripts/governance/reviewedSessionMetadataContract.mjs";

import {
  compareSnapshotToReviewedMetadata,
} from "./compareSnapshotToReviewedMetadata";

import {
  requiresHumanReview,
} from "../../../scripts/conversation/requiresHumanReview.mjs";

const MAXIMUM_OUTPUT_LENGTH =
  50000;

/**
 * The collector's own "Reviewed session metadata applied: ..." console
 * line (see scripts/governance/collectSessionEvidence.mjs) is retained as
 * human-readable observability inside step output -- it is naturally
 * present there because executeShadowGovernanceTransaction writes the
 * collector's stdout straight through, with no special handling needed
 * here. It is deliberately NOT used to gate pass/fail below: a stdout
 * substring is easy to satisfy without the metadata actually reaching the
 * snapshot governance state was generated from, and it says nothing about
 * whether that snapshot is the one THIS run created versus a prior one
 * left over from an earlier session. The structured checks below --
 * identifying this run's own snapshot via a before/after directory diff,
 * confirming the synced state points at it, and comparing its fields
 * against the exact normalized payload submitted -- are the real
 * invariant.
 */

function trimOutput(value) {
  const ansiEscapePattern =
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

  const output =
    String(value || "")
      .replace(
        ansiEscapePattern,
        "",
      )
      .replace(/\r\n?/g, "\n")
      .trim();

  if (
    output.length <=
      MAXIMUM_OUTPUT_LENGTH
  ) {
    return output;
  }

  return [
    "[Earlier output truncated]",
    output.slice(
      -MAXIMUM_OUTPUT_LENGTH,
    ),
  ].join("\n");
}

function runStep({
  repositoryRoot,
  command,
  args,
  nodeEnvironment,
  spawnSyncFn,
}) {
  const result =
    spawnSyncFn(
      command,
      args,
      {
        cwd:
          repositoryRoot,
        encoding:
          "utf8",
        env: {
          ...process.env,
          ...(nodeEnvironment
            ? {
                NODE_ENV:
                  nodeEnvironment,
              }
            : {}),
        },
        shell:
          false,
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
        maxBuffer:
          20 * 1024 * 1024,
        timeout:
          15 * 60 * 1000,
      },
    );

  const output =
    trimOutput(
      [
        result.stdout,
        result.stderr,
        result.error?.message,
      ]
        .filter(Boolean)
        .join("\n"),
    );

  const exitCode =
    Number.isInteger(
      result.status,
    )
      ? result.status
      : 1;

  return {
    command: [
      command,
      ...args,
    ].join(" "),
    exitCode,
    status:
      exitCode === 0 &&
      !result.error
        ? "passing"
        : "failing",
    output,
  };
}

function findLatestValidationEvidence(
  repositoryRoot,
) {
  const validationDirectory =
    path.resolve(
      /* turbopackIgnore: true */
      repositoryRoot,
      "governance/validation",
    );

  if (
    !fs.existsSync(
      validationDirectory,
    )
  ) {
    throw new Error(
      "No validation evidence directory exists.",
    );
  }

  const candidates =
    fs.readdirSync(
      validationDirectory,
    )
      .filter(
        (name) =>
          /^forge-validation-\d{8}-\d{6}\.json$/.test(
            name,
          ),
      )
      .sort();

  const latest =
    candidates.at(-1);

  if (!latest) {
    throw new Error(
      "No validation evidence artifact is available.",
    );
  }

  return path.join(
    "governance/validation",
    latest,
  );
}

function writeReviewedMetadataFile(
  reviewedMetadata,
) {
  const normalizedMetadata =
    validateReviewedSessionMetadata(
      reviewedMetadata,
    );

  const tempDirectory =
    fs.mkdtempSync(
      path.join(
        os.tmpdir(),
        "forge-reviewed-metadata-",
      ),
    );

  const tempPath =
    path.join(
      tempDirectory,
      "reviewed-session-metadata.json",
    );

  fs.writeFileSync(
    tempPath,
    JSON.stringify(
      normalizedMetadata,
      null,
      2,
    ),
    "utf8",
  );

  return {
    path: tempPath,
    normalizedMetadata,
  };
}

const SNAPSHOT_DIRECTORY_RELATIVE_PATH =
  "governance/snapshots";

const GOVERNANCE_STATE_RELATIVE_PATH =
  "governance/state/current-governance-state.json";

function listSnapshotNames(
  repositoryRoot,
) {
  const snapshotDirectory =
    path.join(
      repositoryRoot,
      SNAPSHOT_DIRECTORY_RELATIVE_PATH,
    );

  if (
    !fs.existsSync(
      snapshotDirectory,
    )
  ) {
    return new Set();
  }

  return new Set(
    fs.readdirSync(
      snapshotDirectory,
    ).filter((name) =>
      name.endsWith(".json"),
    ),
  );
}

function readSyncedGovernanceState(
  repositoryRoot,
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          repositoryRoot,
          GOVERNANCE_STATE_RELATIVE_PATH,
        ),
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

function readSnapshotFile(
  repositoryRoot,
  relativeSnapshotPath,
) {
  try {
    return JSON.parse(
      fs.readFileSync(
        path.join(
          repositoryRoot,
          relativeSnapshotPath,
        ),
        "utf8",
      ),
    );
  } catch {
    return null;
  }
}

/**
 * The real invariant: does the snapshot THIS run created -- identified by
 * diffing governance/snapshots/ before and after, exactly like
 * executeShadowGovernanceTransaction.mjs's own identifyNewSnapshot() --
 * actually carry the reviewer's submitted payload, and does the
 * synchronized governance state (which the bootstrap reads fresh from
 * disk) point at that exact snapshot rather than a prior one? A stale but
 * fully-populated state from an earlier session would fail this even
 * though it would satisfy a naive "no REVIEW_REQUIRED values" check.
 */
function evaluateReviewedMetadataApplication({
  reviewedMetadata,
  normalizedReviewedMetadata,
  repositoryRoot,
  snapshotsBeforeRun,
  listSnapshotNamesFn,
  readSyncedGovernanceStateFn,
  readSnapshotFn,
}) {
  if (reviewedMetadata === null) {
    return [
      "No reviewed metadata was supplied with this request.",
    ];
  }

  const snapshotsAfterRun =
    listSnapshotNamesFn(
      repositoryRoot,
    );

  const newSnapshotNames = [
    ...snapshotsAfterRun,
  ].filter(
    (name) =>
      !snapshotsBeforeRun.has(
        name,
      ),
  );

  if (newSnapshotNames.length !== 1) {
    return [
      `Expected exactly one new governance snapshot from this run; found ${newSnapshotNames.length}.`,
    ];
  }

  const newSnapshotRelativePath = `${SNAPSHOT_DIRECTORY_RELATIVE_PATH}/${newSnapshotNames[0]}`;

  const snapshot =
    readSnapshotFn(
      repositoryRoot,
      newSnapshotRelativePath,
    );

  if (!snapshot) {
    return [
      "The governance snapshot created by this run could not be read.",
    ];
  }

  const reasons = [];

  const syncedState =
    readSyncedGovernanceStateFn(
      repositoryRoot,
    );

  const syncedLatestSnapshot =
    syncedState?.session
      ?.latestSnapshot ?? null;

  const syncedSourceSnapshot =
    syncedState?.synchronization
      ?.sourceSnapshot ?? null;

  if (
    !syncedState ||
    syncedLatestSnapshot !==
      newSnapshotRelativePath ||
    syncedSourceSnapshot !==
      newSnapshotRelativePath
  ) {
    reasons.push(
      "The synchronized governance state references a different snapshot than the one this run created -- it may be stale.",
    );
  }

  const mismatches =
    compareSnapshotToReviewedMetadata(
      snapshot,
      normalizedReviewedMetadata,
    );

  for (const mismatch of mismatches) {
    reasons.push(
      `Field "${mismatch.field}" was not applied as submitted (expected ${mismatch.expected}, found ${mismatch.actual}).`,
    );
  }

  // The exact-match check above proves THIS run's payload landed. It
  // cannot, by itself, prove the payload was actually complete: a sparse
  // submission that omits a policy-required field will match itself
  // perfectly while leaving that field REVIEW_REQUIRED. requiresHumanReview
  // is the same completeness policy buildConversationState.mjs applies to
  // the generated bootstrap -- reused here, not reimplemented, so both
  // checks can never drift apart.
  if (
    syncedState &&
    requiresHumanReview(
      syncedState,
    )
  ) {
    reasons.push(
      "The synchronized governance state still requires human review: a policy-required phase, objective, or next-session field remains REVIEW_REQUIRED.",
    );
  }

  return reasons;
}

function commandSteps({
  commandId,
  repositoryRoot,
  reviewedMetadataPath,
}) {
  switch (commandId) {
    case "repository-status":
      return [
        {
          command: "git",
          args: [
            "status",
            "--short",
            "--branch",
          ],
        },
        {
          command: "git",
          args: [
            "log",
            "-8",
            "--oneline",
            "--decorate",
          ],
        },
      ];

    case "full-tests":
      return [
        {
          command: "npx",
          args: [
            "vitest",
            "run",
          ],
          nodeEnvironment:
            "test",
        },
      ];

    case "production-build":
      return [
        {
          command: "npm",
          args: [
            "run",
            "build",
          ],
          nodeEnvironment:
            "production",
        },
      ];

    case "generate-validation-evidence":
      return [
        {
          command:
            process.execPath,
          args: [
            "scripts/governance/generateValidationEvidence.mjs",
            "--full",
            "--build",
          ],
        },
      ];

    case "prepare-next-session":
      return [
        {
          command:
            process.execPath,
          args: [
            "scripts/orchestration/runEngineeringConversationSession.mjs",
            findLatestValidationEvidence(
              repositoryRoot,
            ),
            ...(reviewedMetadataPath
              ? [reviewedMetadataPath]
              : []),
          ],
        },
      ];

    case "complete-session-closeout":
      return [
        {
          command:
            process.execPath,
          args: [
            "scripts/governance/generateValidationEvidence.mjs",
            "--full",
            "--build",
          ],
        },
        {
          command:
            process.execPath,
          args: [
            "scripts/orchestration/runEngineeringConversationSession.mjs",
            "__LATEST_VALIDATION_EVIDENCE__",
            ...(reviewedMetadataPath
              ? [reviewedMetadataPath]
              : []),
          ],
        },
      ];

    default:
      throw new Error(
        "Unsupported programmer command.",
      );
  }
}

export function executeProgrammerCommand({
  commandId,
  repositoryRoot =
    process.cwd(),
  spawnSyncFn =
    spawnSync,
  vercelEnvironment =
    process.env.VERCEL,
  reviewedMetadata =
    null,
  listSnapshotNamesFn =
    listSnapshotNames,
  readSyncedGovernanceStateFn =
    readSyncedGovernanceState,
  readSnapshotFn =
    readSnapshotFile,
} = {}) {
  const definition =
    getProgrammerCommand(
      commandId,
    );

  if (!definition) {
    throw new Error(
      "Programmer command is not allowlisted.",
    );
  }

  if (
    reviewedMetadata !== null &&
    !definition.requiresSessionReview
  ) {
    throw new Error(
      `Reviewed session metadata was supplied for "${commandId}", which is not flagged to accept it. Refusing to run.`,
    );
  }

  if (
    vercelEnvironment === "1"
  ) {
    throw new Error(
      "Repository commands are disabled on Vercel. Run this dashboard from the authorized local FORGE workstation.",
    );
  }

  const normalizedRoot =
    path.resolve(
      /* turbopackIgnore: true */
      repositoryRoot,
    );

  if (
    !fs.existsSync(
      path.join(
        /* turbopackIgnore: true */
        normalizedRoot,
        ".git",
      ),
    )
  ) {
    throw new Error(
      "The programmer command must run from the marketplace409 repository.",
    );
  }

  let reviewedMetadataPath =
    null;

  let normalizedReviewedMetadata =
    null;

  if (
    reviewedMetadata !== null &&
    definition.requiresSessionReview
  ) {
    const written =
      writeReviewedMetadataFile(
        reviewedMetadata,
      );

    reviewedMetadataPath =
      written.path;

    normalizedReviewedMetadata =
      written.normalizedMetadata;
  }

  const snapshotsBeforeRun =
    definition.requiresSessionReview
      ? listSnapshotNamesFn(
          normalizedRoot,
        )
      : null;

  try {
    const startedAt =
      new Date();

    const steps = [];
    const definitions =
      commandSteps({
        commandId,
        repositoryRoot:
          normalizedRoot,
        reviewedMetadataPath,
      });

    for (
      const definitionStep
      of definitions
    ) {
      const resolvedStep =
        definitionStep.args.includes(
          "__LATEST_VALIDATION_EVIDENCE__",
        )
          ? {
              ...definitionStep,
              args:
                definitionStep.args.map(
                  (argument) =>
                    argument ===
                      "__LATEST_VALIDATION_EVIDENCE__"
                      ? findLatestValidationEvidence(
                          normalizedRoot,
                        )
                      : argument,
                ),
            }
          : definitionStep;

      const result =
        runStep({
          repositoryRoot:
            normalizedRoot,
          command:
            resolvedStep.command,
          args:
            resolvedStep.args,
          nodeEnvironment:
            resolvedStep
              .nodeEnvironment,
          spawnSyncFn,
        });

      steps.push(result);

      if (
        result.status !==
          "passing"
      ) {
        break;
      }
    }

    if (
      definition.requiresSessionReview &&
      steps.length ===
        definitions.length
    ) {
      const finalIndex =
        steps.length - 1;

      const finalStep =
        steps[finalIndex];

      if (
        finalStep.status ===
          "passing"
      ) {
        const violationReasons =
          evaluateReviewedMetadataApplication({
            reviewedMetadata,
            normalizedReviewedMetadata,
            repositoryRoot:
              normalizedRoot,
            snapshotsBeforeRun,
            listSnapshotNamesFn,
            readSyncedGovernanceStateFn,
            readSnapshotFn,
          });

        if (
          violationReasons.length >
          0
        ) {
          steps[finalIndex] = {
            ...finalStep,
            status:
              "failing",
            output: [
              "FORGE INVARIANT VIOLATION: this command requires owner-reviewed session metadata.",
              ...violationReasons,
              "Reopen \"Review & run\", approve the proposal, and try again.",
              "",
              finalStep.output,
            ].join("\n"),
          };
        }
      }
    }

    const completedAt =
      new Date();

    const status =
      steps.length ===
        definitions.length &&
      steps.every(
        (step) =>
          step.status ===
            "passing",
      )
        ? "passing"
        : "failing";

    return Object.freeze({
      commandId,
      label:
        definition.label,
      status,
      startedAt:
        startedAt.toISOString(),
      completedAt:
        completedAt.toISOString(),
      steps:
        steps.map(
          (step) =>
            Object.freeze({
              ...step,
            }),
        ),
    });
  } finally {
    if (
      reviewedMetadataPath
    ) {
      fs.rmSync(
        path.dirname(
          reviewedMetadataPath,
        ),
        {
          recursive: true,
          force: true,
        },
      );
    }
  }
}
