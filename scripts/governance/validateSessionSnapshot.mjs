import fs from "node:fs";
import path from "node:path";

const repositoryRoot = process.cwd();

const commitPattern = /^[0-9a-f]{7,40}$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

const phaseStatuses = new Set([
  "planned",
  "active",
  "blocked",
  "incomplete",
  "complete",
]);

const validationStatuses = new Set([
  "not-run",
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

function assertExactKeys(value, expectedKeys, location) {
  assert(isObject(value), `${location} must be an object`);

  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();

  assert(
    JSON.stringify(actualKeys) === JSON.stringify(expected),
    `${location} keys do not match the contract. ` +
      `Expected ${expected.join(", ")}; received ${actualKeys.join(", ")}`,
  );
}

function assertRequiredKeys(value, requiredKeys, location) {
  assert(isObject(value), `${location} must be an object`);

  for (const key of requiredKeys) {
    assert(
      Object.hasOwn(value, key),
      `${location}.${key} is required`,
    );
  }
}

function assertString(value, location, { allowNull = false } = {}) {
  if (allowNull && value === null) {
    return;
  }

  assert(
    typeof value === "string" && value.length > 0,
    `${location} must be a non-empty string`,
  );
}

function assertBoolean(value, location) {
  assert(
    typeof value === "boolean",
    `${location} must be boolean`,
  );
}

function assertStringArray(value, location) {
  assert(Array.isArray(value), `${location} must be an array`);

  for (const [index, item] of value.entries()) {
    assertString(item, `${location}[${index}]`);
  }
}

function validateValidationResult(value, location) {
  assertRequiredKeys(value, ["status"], location);

  const allowedKeys = new Set(["status", "command", "summary"]);

  for (const key of Object.keys(value)) {
    assert(
      allowedKeys.has(key),
      `${location}.${key} is not permitted`,
    );
  }

  assert(
    validationStatuses.has(value.status),
    `${location}.status is invalid`,
  );

  if (Object.hasOwn(value, "command")) {
    assert(
      value.command === null ||
        (typeof value.command === "string" &&
          value.command.length > 0),
      `${location}.command must be null or a non-empty string`,
    );
  }

  if (Object.hasOwn(value, "summary")) {
    assert(
      value.summary === null ||
        (typeof value.summary === "string" &&
          value.summary.length > 0),
      `${location}.summary must be null or a non-empty string`,
    );
  }
}

const suppliedPath = process.argv[2];

if (!suppliedPath) {
  fail(
    "Usage: node scripts/governance/validateSessionSnapshot.mjs <snapshot-path>",
  );
}

const snapshotPath = path.resolve(repositoryRoot, suppliedPath);

assert(
  fs.existsSync(snapshotPath),
  `Snapshot does not exist: ${path.relative(repositoryRoot, snapshotPath)}`,
);

let snapshot;

try {
  snapshot = JSON.parse(fs.readFileSync(snapshotPath, "utf8"));
} catch (error) {
  fail(`Snapshot is not valid JSON: ${error.message}`);
}

assertExactKeys(
  snapshot,
  [
    "schemaVersion",
    "sessionId",
    "sessionDate",
    "phase",
    "objective",
    "repository",
    "work",
    "validation",
    "completion",
    "nextSession",
    "evidence",
  ],
  "snapshot",
);

assert(
  snapshot.schemaVersion === "1.0",
  "snapshot.schemaVersion must equal 1.0",
);

assertString(snapshot.sessionId, "snapshot.sessionId");

assert(
  typeof snapshot.sessionDate === "string" &&
    datePattern.test(snapshot.sessionDate),
  "snapshot.sessionDate must use YYYY-MM-DD",
);

assertExactKeys(
  snapshot.phase,
  ["identifier", "title", "status"],
  "snapshot.phase",
);

assertString(snapshot.phase.identifier, "snapshot.phase.identifier");
assertString(snapshot.phase.title, "snapshot.phase.title");

assert(
  phaseStatuses.has(snapshot.phase.status),
  "snapshot.phase.status is invalid",
);

assertExactKeys(
  snapshot.objective,
  ["startingObjective", "endingObjective"],
  "snapshot.objective",
);

assertString(
  snapshot.objective.startingObjective,
  "snapshot.objective.startingObjective",
);

assertString(
  snapshot.objective.endingObjective,
  "snapshot.objective.endingObjective",
);

assertRequiredKeys(
  snapshot.repository,
  ["head", "originMain", "branch", "workingTreeClean"],
  "snapshot.repository",
);

const repositoryAllowedKeys = new Set([
  "head",
  "originMain",
  "branch",
  "workingTreeClean",
  "implementationCommit",
  "governanceCommit",
]);

for (const key of Object.keys(snapshot.repository)) {
  assert(
    repositoryAllowedKeys.has(key),
    `snapshot.repository.${key} is not permitted`,
  );
}

assert(
  commitPattern.test(snapshot.repository.head),
  "snapshot.repository.head must be a Git commit hash",
);

assert(
  commitPattern.test(snapshot.repository.originMain),
  "snapshot.repository.originMain must be a Git commit hash",
);

assertString(snapshot.repository.branch, "snapshot.repository.branch");

assertBoolean(
  snapshot.repository.workingTreeClean,
  "snapshot.repository.workingTreeClean",
);

for (const field of [
  "implementationCommit",
  "governanceCommit",
]) {
  if (Object.hasOwn(snapshot.repository, field)) {
    const value = snapshot.repository[field];

    assert(
      value === null ||
        (typeof value === "string" && commitPattern.test(value)),
      `snapshot.repository.${field} must be null or a Git commit hash`,
    );
  }
}

assertRequiredKeys(
  snapshot.work,
  ["delivered", "modifiedFiles"],
  "snapshot.work",
);

const workAllowedKeys = new Set([
  "delivered",
  "modifiedFiles",
  "knownWarnings",
]);

for (const key of Object.keys(snapshot.work)) {
  assert(
    workAllowedKeys.has(key),
    `snapshot.work.${key} is not permitted`,
  );
}

assertStringArray(
  snapshot.work.delivered,
  "snapshot.work.delivered",
);

assertStringArray(
  snapshot.work.modifiedFiles,
  "snapshot.work.modifiedFiles",
);

if (Object.hasOwn(snapshot.work, "knownWarnings")) {
  assertStringArray(
    snapshot.work.knownWarnings,
    "snapshot.work.knownWarnings",
  );
}

assertExactKeys(
  snapshot.validation,
  ["focusedTests", "fullTests", "productionBuild"],
  "snapshot.validation",
);

validateValidationResult(
  snapshot.validation.focusedTests,
  "snapshot.validation.focusedTests",
);

validateValidationResult(
  snapshot.validation.fullTests,
  "snapshot.validation.fullTests",
);

validateValidationResult(
  snapshot.validation.productionBuild,
  "snapshot.validation.productionBuild",
);

assertRequiredKeys(
  snapshot.completion,
  ["workComplete", "supportedByEvidence"],
  "snapshot.completion",
);

const completionAllowedKeys = new Set([
  "workComplete",
  "supportedByEvidence",
  "incompleteReason",
]);

for (const key of Object.keys(snapshot.completion)) {
  assert(
    completionAllowedKeys.has(key),
    `snapshot.completion.${key} is not permitted`,
  );
}

assertBoolean(
  snapshot.completion.workComplete,
  "snapshot.completion.workComplete",
);

assertBoolean(
  snapshot.completion.supportedByEvidence,
  "snapshot.completion.supportedByEvidence",
);

if (Object.hasOwn(snapshot.completion, "incompleteReason")) {
  const value = snapshot.completion.incompleteReason;

  assert(
    value === null ||
      (typeof value === "string" && value.length > 0),
    "snapshot.completion.incompleteReason must be null or a non-empty string",
  );
}

assertExactKeys(
  snapshot.nextSession,
  ["objective", "startingInspection"],
  "snapshot.nextSession",
);

assertString(
  snapshot.nextSession.objective,
  "snapshot.nextSession.objective",
);

assertString(
  snapshot.nextSession.startingInspection,
  "snapshot.nextSession.startingInspection",
);

assertExactKeys(
  snapshot.evidence,
  [
    "capturedAt",
    "latestCommit",
    "headMatchesOriginMain",
    "gitStatus",
    "selectedValidationArtifact",
  ],
  "snapshot.evidence",
);

assert(
  typeof snapshot.evidence.capturedAt === "string" &&
    dateTimePattern.test(snapshot.evidence.capturedAt),
  "snapshot.evidence.capturedAt must be an ISO-8601 timestamp",
);

assertExactKeys(
  snapshot.evidence.latestCommit,
  ["hash", "subject", "committedAt"],
  "snapshot.evidence.latestCommit",
);

const latestCommit = snapshot.evidence.latestCommit;

assert(
  latestCommit.hash === null ||
    (typeof latestCommit.hash === "string" &&
      commitPattern.test(latestCommit.hash)),
  "snapshot.evidence.latestCommit.hash must be null or a Git commit hash",
);

assertString(
  latestCommit.subject,
  "snapshot.evidence.latestCommit.subject",
  { allowNull: true },
);

assert(
  latestCommit.committedAt === null ||
    (typeof latestCommit.committedAt === "string" &&
      dateTimePattern.test(latestCommit.committedAt)),
  "snapshot.evidence.latestCommit.committedAt must be null or an ISO-8601 timestamp",
);

assertBoolean(
  snapshot.evidence.headMatchesOriginMain,
  "snapshot.evidence.headMatchesOriginMain",
);

assertStringArray(
  snapshot.evidence.gitStatus,
  "snapshot.evidence.gitStatus",
);

const selectedValidationArtifact =
  snapshot.evidence
    .selectedValidationArtifact;

assert(
  selectedValidationArtifact === null ||
    isObject(
      selectedValidationArtifact,
    ),
  "snapshot.evidence.selectedValidationArtifact must be null or an object",
);

if (
  selectedValidationArtifact !== null
) {
  assertExactKeys(
    selectedValidationArtifact,
    [
      "path",
      "validationId",
      "completedAt",
      "repositoryHead",
    ],
    "snapshot.evidence.selectedValidationArtifact",
  );

  assertString(
    selectedValidationArtifact.path,
    "snapshot.evidence.selectedValidationArtifact.path",
  );

  assert(
    /^forge-validation-\d{8}-\d{6}$/.test(
      selectedValidationArtifact
        .validationId,
    ),
    "snapshot.evidence.selectedValidationArtifact.validationId is invalid",
  );

  assert(
    typeof selectedValidationArtifact
      .completedAt === "string" &&
      dateTimePattern.test(
        selectedValidationArtifact
          .completedAt,
      ),
    "snapshot.evidence.selectedValidationArtifact.completedAt must be an ISO-8601 timestamp",
  );

  assert(
    commitPattern.test(
      selectedValidationArtifact
        .repositoryHead,
    ),
    "snapshot.evidence.selectedValidationArtifact.repositoryHead must be a Git commit hash",
  );

  assert(
    selectedValidationArtifact
      .repositoryHead ===
      snapshot.repository.head,
    "snapshot.evidence.selectedValidationArtifact.repositoryHead must match snapshot.repository.head",
  );

  assert(
    selectedValidationArtifact.path ===
      `governance/validation/${selectedValidationArtifact.validationId}.json`,
    "snapshot.evidence.selectedValidationArtifact.path must match its validationId",
  );
}

assert(
  snapshot.evidence.headMatchesOriginMain ===
    (snapshot.repository.head === snapshot.repository.originMain),
  "snapshot.evidence.headMatchesOriginMain disagrees with repository hashes",
);

assert(
  snapshot.repository.workingTreeClean ===
    (snapshot.evidence.gitStatus.length === 0),
  "snapshot.repository.workingTreeClean disagrees with evidence.gitStatus",
);

if (
  snapshot.completion.workComplete ||
  snapshot.completion.supportedByEvidence
) {
  assert(
    snapshot.completion.workComplete &&
      snapshot.completion.supportedByEvidence,
    "Completion requires both workComplete and supportedByEvidence",
  );
}

console.log(
  `VALID SESSION SNAPSHOT: ${path.relative(repositoryRoot, snapshotPath)}`,
);
