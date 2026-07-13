import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();

const commitPattern = /^[0-9a-f]{7,40}$/;

const validationIdPattern =
  /^forge-validation-\d{8}-\d{6}$/;

const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const validationCategories = [
  "focusedTests",
  "fullTests",
  "productionBuild",
];

const validationStatuses = new Set([
  "not-run",
  "passing",
  "failing",
]);

const commandStatuses = new Set([
  "passing",
  "failing",
]);

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function assert(condition, message) {
  if (!condition) {
    fail(message);
  }
}

function isObject(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

function assertExactKeys(
  value,
  expectedKeys,
  location,
) {
  assert(
    isObject(value),
    `${location} must be an object`,
  );

  const actualKeys =
    Object.keys(value).sort();

  const expected =
    [...expectedKeys].sort();

  assert(
    JSON.stringify(actualKeys) ===
      JSON.stringify(expected),
    `${location} keys do not match the contract. ` +
      `Expected ${expected.join(", ")}; ` +
      `received ${actualKeys.join(", ")}`,
  );
}

function assertString(
  value,
  location,
  {
    allowNull = false,
    allowEmpty = false,
  } = {},
) {
  if (
    allowNull &&
    value === null
  ) {
    return;
  }

  assert(
    typeof value === "string",
    `${location} must be a string`,
  );

  if (!allowEmpty) {
    assert(
      value.length > 0,
      `${location} must be a non-empty string`,
    );
  }
}

function assertBoolean(
  value,
  location,
) {
  assert(
    typeof value === "boolean",
    `${location} must be boolean`,
  );
}

function assertDateTime(
  value,
  location,
) {
  assert(
    typeof value === "string" &&
      dateTimePattern.test(value),
    `${location} must be an ISO-8601 timestamp`,
  );

  assert(
    !Number.isNaN(Date.parse(value)),
    `${location} must be a valid timestamp`,
  );
}

function assertStringArray(
  value,
  location,
  {
    allowEmptyStrings = false,
  } = {},
) {
  assert(
    Array.isArray(value),
    `${location} must be an array`,
  );

  for (
    const [index, item]
    of value.entries()
  ) {
    assertString(
      item,
      `${location}[${index}]`,
      {
        allowEmpty:
          allowEmptyStrings,
      },
    );
  }
}

function assertTimestampOrder(
  startedAt,
  completedAt,
  location,
) {
  assert(
    Date.parse(completedAt) >=
      Date.parse(startedAt),
    `${location}.completedAt must not precede startedAt`,
  );
}

function validateRepositoryState(
  value,
  location,
) {
  assertExactKeys(
    value,
    [
      "branch",
      "head",
      "originMain",
      "headMatchesOriginMain",
      "workingTreeClean",
      "gitStatus",
    ],
    location,
  );

  assertString(
    value.branch,
    `${location}.branch`,
  );

  assert(
    typeof value.head === "string" &&
      commitPattern.test(value.head),
    `${location}.head must be a Git commit hash`,
  );

  assert(
    typeof value.originMain === "string" &&
      commitPattern.test(value.originMain),
    `${location}.originMain must be a Git commit hash`,
  );

  assertBoolean(
    value.headMatchesOriginMain,
    `${location}.headMatchesOriginMain`,
  );

  assertBoolean(
    value.workingTreeClean,
    `${location}.workingTreeClean`,
  );

  assertStringArray(
    value.gitStatus,
    `${location}.gitStatus`,
  );

  assert(
    value.headMatchesOriginMain ===
      (value.head === value.originMain),
    `${location}.headMatchesOriginMain disagrees with repository hashes`,
  );

  assert(
    value.workingTreeClean ===
      (value.gitStatus.length === 0),
    `${location}.workingTreeClean disagrees with gitStatus`,
  );
}

function validateCommandEvidence(
  value,
  index,
) {
  const location =
    `artifact.commands[${index}]`;

  assertExactKeys(
    value,
    [
      "category",
      "command",
      "args",
      "workingDirectory",
      "startedAt",
      "completedAt",
      "exitCode",
      "status",
      "summary",
    ],
    location,
  );

  assert(
    validationCategories.includes(
      value.category,
    ),
    `${location}.category is invalid`,
  );

  assertString(
    value.command,
    `${location}.command`,
  );

  assertStringArray(
    value.args,
    `${location}.args`,
    {
      allowEmptyStrings: true,
    },
  );

  assertString(
    value.workingDirectory,
    `${location}.workingDirectory`,
  );

  assertDateTime(
    value.startedAt,
    `${location}.startedAt`,
  );

  assertDateTime(
    value.completedAt,
    `${location}.completedAt`,
  );

  assertTimestampOrder(
    value.startedAt,
    value.completedAt,
    location,
  );

  assert(
    value.exitCode === null ||
      Number.isInteger(
        value.exitCode,
      ),
    `${location}.exitCode must be an integer or null`,
  );

  assert(
    commandStatuses.has(
      value.status,
    ),
    `${location}.status is invalid`,
  );

  assertString(
    value.summary,
    `${location}.summary`,
    {
      allowNull: true,
    },
  );

  if (
    value.status === "passing"
  ) {
    assert(
      value.exitCode === 0,
      `${location} cannot pass unless exitCode is 0`,
    );
  }

  if (
    value.status === "failing"
  ) {
    assert(
      value.exitCode === null ||
        value.exitCode !== 0,
      `${location} cannot fail with exitCode 0`,
    );
  }
}

function validateResult(
  value,
  category,
  commands,
  referencedIndexes,
) {
  const location =
    `artifact.results.${category}`;

  assertExactKeys(
    value,
    [
      "status",
      "commandIndexes",
      "summary",
    ],
    location,
  );

  assert(
    validationStatuses.has(
      value.status,
    ),
    `${location}.status is invalid`,
  );

  assert(
    Array.isArray(
      value.commandIndexes,
    ),
    `${location}.commandIndexes must be an array`,
  );

  const uniqueIndexes =
    new Set(value.commandIndexes);

  assert(
    uniqueIndexes.size ===
      value.commandIndexes.length,
    `${location}.commandIndexes must be unique`,
  );

  assertString(
    value.summary,
    `${location}.summary`,
    {
      allowNull: true,
    },
  );

  if (
    value.status === "not-run"
  ) {
    assert(
      value.commandIndexes.length === 0,
      `${location} must not reference commands when status is not-run`,
    );

    assert(
      value.summary === null,
      `${location}.summary must be null when status is not-run`,
    );

    return;
  }

  assert(
    value.commandIndexes.length > 0,
    `${location} must reference at least one executed command`,
  );

  const categoryCommands =
    value.commandIndexes.map(
      (commandIndex) => {
        assert(
          Number.isInteger(
            commandIndex,
          ) &&
            commandIndex >= 0,
          `${location}.commandIndexes must contain non-negative integers`,
        );

        assert(
          commandIndex <
            commands.length,
          `${location}.commandIndexes contains an out-of-range index`,
        );

        assert(
          !referencedIndexes.has(
            commandIndex,
          ),
          `artifact.commands[${commandIndex}] is referenced by more than one result`,
        );

        referencedIndexes.add(
          commandIndex,
        );

        const command =
          commands[commandIndex];

        assert(
          command.category ===
            category,
          `artifact.commands[${commandIndex}].category does not match ${category}`,
        );

        return command;
      },
    );

  if (
    value.status === "passing"
  ) {
    assert(
      categoryCommands.every(
        (command) =>
          command.status ===
            "passing" &&
          command.exitCode === 0,
      ),
      `${location} cannot pass unless all referenced commands passed`,
    );
  }

  if (
    value.status === "failing"
  ) {
    assert(
      categoryCommands.some(
        (command) =>
          command.status ===
            "failing",
      ),
      `${location} cannot fail unless at least one referenced command failed`,
    );
  }
}

const suppliedPath =
  process.argv[2];

if (!suppliedPath) {
  fail(
    "Usage: node scripts/governance/validateValidationEvidence.mjs <validation-evidence-path>",
  );
}

const artifactPath =
  path.resolve(
    repositoryRoot,
    suppliedPath,
  );

const relativeArtifactPath =
  path.relative(
    repositoryRoot,
    artifactPath,
  );

assert(
  relativeArtifactPath !== ".." &&
    !relativeArtifactPath.startsWith(
      `..${path.sep}`,
    ) &&
    !path.isAbsolute(
      relativeArtifactPath,
    ),
  "Validation evidence path must remain inside the repository",
);

assert(
  fs.existsSync(
    artifactPath,
  ),
  `Validation evidence does not exist: ${relativeArtifactPath}`,
);

let artifact;

try {
  artifact =
    JSON.parse(
      fs.readFileSync(
        artifactPath,
        "utf8",
      ),
    );
} catch (error) {
  fail(
    `Validation evidence is not valid JSON: ${error.message}`,
  );
}

assertExactKeys(
  artifact,
  [
    "schemaVersion",
    "validationId",
    "capturedAt",
    "startedAt",
    "completedAt",
    "repository",
    "commands",
    "results",
  ],
  "artifact",
);

assert(
  artifact.schemaVersion === "1.0",
  "artifact.schemaVersion must equal 1.0",
);

assert(
  typeof artifact.validationId ===
    "string" &&
    validationIdPattern.test(
      artifact.validationId,
    ),
  "artifact.validationId must use forge-validation-YYYYMMDD-HHMMSS",
);

assertDateTime(
  artifact.capturedAt,
  "artifact.capturedAt",
);

assertDateTime(
  artifact.startedAt,
  "artifact.startedAt",
);

assertDateTime(
  artifact.completedAt,
  "artifact.completedAt",
);

assertTimestampOrder(
  artifact.startedAt,
  artifact.completedAt,
  "artifact",
);

assert(
  Date.parse(
    artifact.capturedAt,
  ) >=
    Date.parse(
      artifact.completedAt,
    ),
  "artifact.capturedAt must not precede completedAt",
);

assertExactKeys(
  artifact.repository,
  [
    "before",
    "after",
  ],
  "artifact.repository",
);

validateRepositoryState(
  artifact.repository.before,
  "artifact.repository.before",
);

validateRepositoryState(
  artifact.repository.after,
  "artifact.repository.after",
);

assert(
  artifact.repository.before.branch ===
    artifact.repository.after.branch,
  "Repository branch changed during validation",
);

assert(
  artifact.repository.before.head ===
    artifact.repository.after.head,
  "Repository HEAD changed during validation",
);

assert(
  artifact.repository.before.originMain ===
    artifact.repository.after.originMain,
  "Repository origin/main changed during validation",
);

assert(
  Array.isArray(
    artifact.commands,
  ),
  "artifact.commands must be an array",
);

for (
  const [index, command]
  of artifact.commands.entries()
) {
  validateCommandEvidence(
    command,
    index,
  );

  assert(
    Date.parse(
      command.startedAt,
    ) >=
      Date.parse(
        artifact.startedAt,
      ),
    `artifact.commands[${index}].startedAt precedes artifact.startedAt`,
  );

  assert(
    Date.parse(
      command.completedAt,
    ) <=
      Date.parse(
        artifact.completedAt,
      ),
    `artifact.commands[${index}].completedAt exceeds artifact.completedAt`,
  );
}

assertExactKeys(
  artifact.results,
  validationCategories,
  "artifact.results",
);

const referencedIndexes =
  new Set();

for (
  const category
  of validationCategories
) {
  validateResult(
    artifact.results[category],
    category,
    artifact.commands,
    referencedIndexes,
  );
}

assert(
  referencedIndexes.size ===
    artifact.commands.length,
  "Every command must be referenced by exactly one validation result",
);

console.log(
  `VALID VALIDATION EVIDENCE: ${relativeArtifactPath}`,
);

console.log(
  `Validation ID: ${artifact.validationId}`,
);

console.log(
  `Repository HEAD: ${artifact.repository.before.head}`,
);
