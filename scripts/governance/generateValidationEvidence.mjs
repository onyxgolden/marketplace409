import {
  execFileSync,
  spawnSync,
} from "node:child_process";

import fs from "node:fs";
import path from "node:path";

import {
  writeValidatedArtifact,
} from "./writeValidatedArtifact.mjs";

const repositoryRoot =
  process.cwd();

const validationDirectory =
  "governance/validation";

const validatorRelativePath =
  "scripts/governance/validateValidationEvidence.mjs";

const maximumSummaryLength =
  4000;

const testFilePattern =
  /\.(?:test|spec)\.(?:js|jsx|mjs|ts|tsx)$/;

function fail(message) {
  throw new Error(message);
}

function runGit(
  args,
  {
    allowFailure = false,
  } = {},
) {
  try {
    return execFileSync(
      "git",
      args,
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    ).trimEnd();
  } catch (error) {
    if (allowFailure) {
      return null;
    }

    const detail =
      error.stderr
        ?.toString()
        .trim() ||
      error.message ||
      "Unknown Git command failure";

    fail(
      `git ${args.join(" ")} failed: ${detail}`,
    );
  }
}

function parseStatusLines(
  statusOutput,
) {
  if (!statusOutput) {
    return [];
  }

  return statusOutput
    .split("\n")
    .map(
      (line) =>
        line.trimEnd(),
    )
    .filter(Boolean);
}

function captureRepositoryState() {
  const branch =
    runGit([
      "branch",
      "--show-current",
    ]);

  const head =
    runGit([
      "rev-parse",
      "HEAD",
    ]);

  const originMain =
    runGit([
      "rev-parse",
      "origin/main",
    ]);

  const gitStatus =
    parseStatusLines(
      runGit([
        "status",
        "--short",
      ]),
    );

  return {
    branch,
    head,
    originMain,
    headMatchesOriginMain:
      head === originMain,
    workingTreeClean:
      gitStatus.length === 0,
    gitStatus,
  };
}

function toValidationTimestamp(
  date,
) {
  const year =
    date
      .getUTCFullYear();

  const month =
    String(
      date.getUTCMonth() + 1,
    ).padStart(2, "0");

  const day =
    String(
      date.getUTCDate(),
    ).padStart(2, "0");

  const hours =
    String(
      date.getUTCHours(),
    ).padStart(2, "0");

  const minutes =
    String(
      date.getUTCMinutes(),
    ).padStart(2, "0");

  const seconds =
    String(
      date.getUTCSeconds(),
    ).padStart(2, "0");

  return (
    `${year}${month}${day}-` +
    `${hours}${minutes}${seconds}`
  );
}

function normalizeFocusedTestPath(
  suppliedPath,
) {
  if (
    typeof suppliedPath !==
      "string" ||
    suppliedPath.length === 0
  ) {
    fail(
      "Focused test paths must be non-empty strings.",
    );
  }

  const absolutePath =
    path.resolve(
      repositoryRoot,
      suppliedPath,
    );

  const relativePath =
    path.relative(
      repositoryRoot,
      absolutePath,
    );

  if (
    relativePath === ".." ||
    relativePath.startsWith(
      `..${path.sep}`,
    ) ||
    path.isAbsolute(
      relativePath,
    )
  ) {
    fail(
      `Focused test path must remain inside the repository: ${suppliedPath}`,
    );
  }

  if (
    !fs.existsSync(
      absolutePath,
    )
  ) {
    fail(
      `Focused test path does not exist: ${relativePath}`,
    );
  }

  const fileStatus =
    fs.statSync(
      absolutePath,
    );

  if (
    !fileStatus.isFile()
  ) {
    fail(
      `Focused validation requires test files, not directories: ${relativePath}`,
    );
  }

  if (
    !testFilePattern.test(
      relativePath,
    )
  ) {
    fail(
      `Focused validation path is not an approved test file: ${relativePath}`,
    );
  }

  return relativePath;
}

function parseArguments(
  suppliedArguments,
) {
  const focusedTests = [];

  let runFullTests =
    false;

  let runProductionBuild =
    false;

  for (
    let index = 0;
    index <
      suppliedArguments.length;
    index += 1
  ) {
    const argument =
      suppliedArguments[index];

    if (
      argument === "--focused"
    ) {
      const focusedStart =
        focusedTests.length;

      while (
        index + 1 <
          suppliedArguments.length &&
        !suppliedArguments[
          index + 1
        ].startsWith("--")
      ) {
        index += 1;

        focusedTests.push(
          normalizeFocusedTestPath(
            suppliedArguments[index],
          ),
        );
      }

      if (
        focusedTests.length ===
          focusedStart
      ) {
        fail(
          "--focused requires at least one repository test file.",
        );
      }

      continue;
    }

    if (
      argument === "--full"
    ) {
      if (runFullTests) {
        fail(
          "--full may be specified only once.",
        );
      }

      runFullTests =
        true;

      continue;
    }

    if (
      argument === "--build"
    ) {
      if (
        runProductionBuild
      ) {
        fail(
          "--build may be specified only once.",
        );
      }

      runProductionBuild =
        true;

      continue;
    }

    fail(
      `Unknown validation option: ${argument}`,
    );
  }

  if (
    focusedTests.length === 0 &&
    !runFullTests &&
    !runProductionBuild
  ) {
    fail(
      "At least one approved validation category must be requested.",
    );
  }

  return {
    focusedTests:
      [...new Set(
        focusedTests,
      )],
    runFullTests,
    runProductionBuild,
  };
}

function createCommandDefinitions({
  focusedTests,
  runFullTests,
  runProductionBuild,
}) {
  const definitions = [];

  if (
    focusedTests.length > 0
  ) {
    definitions.push({
      category:
        "focusedTests",
      command:
        "npx",
      args: [
        "vitest",
        "run",
        ...focusedTests,
      ],
    });
  }

  if (runFullTests) {
    definitions.push({
      category:
        "fullTests",
      command:
        "npx",
      args: [
        "vitest",
        "run",
      ],
    });
  }

  if (
    runProductionBuild
  ) {
    definitions.push({
      category:
        "productionBuild",
      command:
        "npm",
      args: [
        "run",
        "build",
      ],
    });
  }

  return definitions;
}

function boundedSummary(
  output,
) {
  const ansiEscapePattern =
    /\u001B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

  const normalized =
    output
      .replace(
        /\r\n?/g,
        "\n",
      )
      .replace(
        ansiEscapePattern,
        "",
      )
      .split("\n")
      .map(
        (line) =>
          line.trimEnd(),
      )
      .join("\n")
      .trim();

  if (
    normalized.length === 0
  ) {
    return null;
  }

  if (
    normalized.length <=
      maximumSummaryLength
  ) {
    return normalized;
  }

  return (
    "[output truncated]\n" +
    normalized.slice(
      -maximumSummaryLength,
    )
  );
}

function executeCommand({
  category,
  command,
  args,
}) {
  const startedAt =
    new Date();

  console.log("");
  console.log(
    `===== ${category} =====`,
  );

  console.log(
    [
      command,
      ...args,
    ].join(" "),
  );

  const result =
    spawnSync(
      command,
      args,
      {
        cwd:
          repositoryRoot,
        encoding:
          "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
        maxBuffer:
          20 * 1024 * 1024,
        shell:
          false,
      },
    );

  const completedAt =
    new Date();

  if (result.stdout) {
    process.stdout.write(
      result.stdout,
    );
  }

  if (result.stderr) {
    process.stderr.write(
      result.stderr,
    );
  }

  const combinedOutput =
    [
      result.stdout,
      result.stderr,
      result.error
        ?.message,
    ]
      .filter(Boolean)
      .join("\n");

  const exitCode =
    Number.isInteger(
      result.status,
    )
      ? result.status
      : null;

  const status =
    !result.error &&
    exitCode === 0
      ? "passing"
      : "failing";

  return {
    category,
    command,
    args: [
      ...args,
    ],
    workingDirectory:
      ".",
    startedAt:
      startedAt
        .toISOString(),
    completedAt:
      completedAt
        .toISOString(),
    exitCode,
    status,
    summary:
      boundedSummary(
        combinedOutput,
      ),
  };
}

function buildValidationResult(
  category,
  commands,
) {
  const commandIndexes =
    commands
      .map(
        (
          command,
          index,
        ) => ({
          command,
          index,
        }),
      )
      .filter(
        ({ command }) =>
          command.category ===
            category,
      )
      .map(
        ({ index }) =>
          index,
      );

  if (
    commandIndexes.length === 0
  ) {
    return {
      status:
        "not-run",
      commandIndexes: [],
      summary:
        null,
    };
  }

  const categoryCommands =
    commandIndexes.map(
      (index) =>
        commands[index],
    );

  const status =
    categoryCommands.every(
      (command) =>
        command.status ===
          "passing",
    )
      ? "passing"
      : "failing";

  const summaries =
    categoryCommands
      .map(
        (command) =>
          command.summary,
      )
      .filter(Boolean);

  return {
    status,
    commandIndexes,
    summary:
      summaries.length > 0
        ? summaries.join(
            "\n\n",
          )
        : status ===
            "passing"
          ? "Validation command completed successfully."
          : "Validation command failed without captured output.",
  };
}

function validateCandidate(
  candidateRelativePath,
) {
  const validatorPath =
    path.resolve(
      repositoryRoot,
      validatorRelativePath,
    );

  if (
    !fs.existsSync(
      validatorPath,
    )
  ) {
    fail(
      `Validation evidence validator does not exist: ${validatorRelativePath}`,
    );
  }

  const result =
    spawnSync(
      process.execPath,
      [
        validatorPath,
        candidateRelativePath,
      ],
      {
        cwd:
          repositoryRoot,
        encoding:
          "utf8",
        stdio: [
          "ignore",
          "pipe",
          "pipe",
        ],
      },
    );

  if (result.stdout) {
    process.stdout.write(
      result.stdout,
    );
  }

  if (result.stderr) {
    process.stderr.write(
      result.stderr,
    );
  }

  if (result.error) {
    fail(
      `Validation evidence validator could not run: ${result.error.message}`,
    );
  }

  if (
    result.status !== 0
  ) {
    fail(
      `Validation evidence candidate failed production validation with exit code ${result.status}.`,
    );
  }
}

function repositoryStatesAreStable(
  before,
  after,
) {
  return (
    before.branch ===
      after.branch &&
    before.head ===
      after.head &&
    before.originMain ===
      after.originMain
  );
}

function repositoryEvidenceIsEligible(
  before,
  after,
) {
  return (
    repositoryStatesAreStable(
      before,
      after,
    ) &&
    before.branch ===
      "main" &&
    before.workingTreeClean ===
      true &&
    after.workingTreeClean ===
      true &&
    before.headMatchesOriginMain ===
      true &&
    after.headMatchesOriginMain ===
      true
  );
}

function generateValidationEvidence(
  suppliedArguments,
) {
  const options =
    parseArguments(
      suppliedArguments,
    );

  const commandDefinitions =
    createCommandDefinitions(
      options,
    );

  const startedAt =
    new Date();

  const repositoryBefore =
    captureRepositoryState();

  const commands =
    commandDefinitions.map(
      executeCommand,
    );

  const repositoryAfter =
    captureRepositoryState();

  const completedAt =
    new Date();

  const timestamp =
    toValidationTimestamp(
      startedAt,
    );

  const validationId =
    `forge-validation-${timestamp}`;

  const artifact = {
    schemaVersion:
      "1.0",
    validationId,
    capturedAt:
      new Date()
        .toISOString(),
    startedAt:
      startedAt
        .toISOString(),
    completedAt:
      completedAt
        .toISOString(),

    repository: {
      before:
        repositoryBefore,
      after:
        repositoryAfter,
    },

    commands,

    results: {
      focusedTests:
        buildValidationResult(
          "focusedTests",
          commands,
        ),

      fullTests:
        buildValidationResult(
          "fullTests",
          commands,
        ),

      productionBuild:
        buildValidationResult(
          "productionBuild",
          commands,
        ),
    },
  };

  const destinationPath =
    path.join(
      validationDirectory,
      `${validationId}.json`,
    );

  const writtenPath =
    writeValidatedArtifact({
      repositoryRoot,
      destinationPath,
      content:
        `${JSON.stringify(
          artifact,
          null,
          2,
        )}\n`,
      validateCandidate,
    });

  console.log("");
  console.log(
    "FORGE validation evidence generated.",
  );

  console.log(
    `Artifact: ${writtenPath}`,
  );

  console.log(
    `Repository HEAD: ${repositoryBefore.head}`,
  );

  console.log(
    `Repository stable: ${
      repositoryStatesAreStable(
        repositoryBefore,
        repositoryAfter,
      )
        ? "yes"
        : "no"
    }`,
  );

  console.log(
    `Eligible clean committed state: ${
      repositoryEvidenceIsEligible(
        repositoryBefore,
        repositoryAfter,
      )
        ? "yes"
        : "no"
    }`,
  );

  const allCommandsPassed =
    commands.every(
      (command) =>
        command.status ===
          "passing",
    );

  if (
    !allCommandsPassed
  ) {
    fail(
      "One or more validation commands failed. Failing evidence was preserved.",
    );
  }

  if (
    !repositoryEvidenceIsEligible(
      repositoryBefore,
      repositoryAfter,
    )
  ) {
    fail(
      "Validation commands passed, but the artifact is not eligible proof for a clean synchronized main commit.",
    );
  }

  return writtenPath;
}

try {
  generateValidationEvidence(
    process.argv.slice(2),
  );
} catch (error) {
  console.error(
    `FAIL: ${error.message}`,
  );

  process.exit(1);
}
