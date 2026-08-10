import {
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import path from "node:path";

import {
  getProgrammerCommand,
} from "@/application/developer/ProgrammerCommandRegistry";

const MAXIMUM_OUTPUT_LENGTH =
  50000;

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

function commandSteps({
  commandId,
  repositoryRoot,
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

  const startedAt =
    new Date();

  const steps = [];
  const definitions =
    commandSteps({
      commandId,
      repositoryRoot:
        normalizedRoot,
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
}
