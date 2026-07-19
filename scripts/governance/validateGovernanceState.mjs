import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  GOVERNANCE_MODES,
} from "./loadGovernanceMode.mjs";

const repositoryRoot = process.cwd();

const commitPattern = /^[0-9a-f]{7,40}$/;
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
  throw new Error(message);
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

function assertAllowedKeys(value, allowedKeys, location) {
  assert(isObject(value), `${location} must be an object`);

  for (const key of Object.keys(value)) {
    assert(
      allowedKeys.has(key),
      `${location}.${key} is not permitted`,
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

function readJson(relativePath, label) {
  const absolutePath = path.resolve(repositoryRoot, relativePath);

  assert(
    fs.existsSync(absolutePath),
    `${label} does not exist: ${relativePath}`,
  );

  try {
    return JSON.parse(fs.readFileSync(absolutePath, "utf8"));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function assertNullableDateTime(value, location) {
  assert(
    value === null ||
      (typeof value === "string" && dateTimePattern.test(value)),
    `${location} must be null or an ISO-8601 timestamp`,
  );
}

function validateValidationResult(value, location) {
  assertRequiredKeys(value, ["status"], location);

  assertAllowedKeys(
    value,
    new Set(["status", "command", "summary"]),
    location,
  );

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

export function validateGovernanceState(
  governanceState,
  {
    promotionState,
    capabilitiesPolicy,
    editableSectionsPolicy,
    sessionSnapshot = null,
  },
) {
  assertExactKeys(
    governanceState,
    [
      "schemaVersion",
      "repository",
      "session",
      "state",
      "validation",
      "completion",
      "authority",
      "synchronization",
    ],
    "governanceState",
  );

  assert(
    governanceState.schemaVersion === "1.0",
    "governanceState.schemaVersion must equal 1.0",
  );

  assertExactKeys(
    governanceState.repository,
    [
      "branch",
      "head",
      "originMain",
      "workingTreeClean",
      "headMatchesOriginMain",
    ],
    "governanceState.repository",
  );

  assertString(
    governanceState.repository.branch,
    "governanceState.repository.branch",
  );

  assert(
    commitPattern.test(governanceState.repository.head),
    "governanceState.repository.head must be a Git commit hash",
  );

  assert(
    commitPattern.test(governanceState.repository.originMain),
    "governanceState.repository.originMain must be a Git commit hash",
  );

  assertBoolean(
    governanceState.repository.workingTreeClean,
    "governanceState.repository.workingTreeClean",
  );

  assertBoolean(
    governanceState.repository.headMatchesOriginMain,
    "governanceState.repository.headMatchesOriginMain",
  );

  assert(
    governanceState.repository.headMatchesOriginMain ===
      (
        governanceState.repository.head ===
        governanceState.repository.originMain
      ),
    "governanceState.repository.headMatchesOriginMain disagrees with repository hashes",
  );

  assertExactKeys(
    governanceState.session,
    [
      "latestSnapshot",
      "lastUpdated",
    ],
    "governanceState.session",
  );

  assertString(
    governanceState.session.latestSnapshot,
    "governanceState.session.latestSnapshot",
    { allowNull: true },
  );

  assertNullableDateTime(
    governanceState.session.lastUpdated,
    "governanceState.session.lastUpdated",
  );

  assertExactKeys(
    governanceState.state,
    [
      "activePhase",
      "currentObjective",
      "completedWork",
      "knownWarnings",
      "nextSession",
    ],
    "governanceState.state",
  );

  assertExactKeys(
    governanceState.state.activePhase,
    [
      "identifier",
      "title",
      "status",
    ],
    "governanceState.state.activePhase",
  );

  assertString(
    governanceState.state.activePhase.identifier,
    "governanceState.state.activePhase.identifier",
  );

  assertString(
    governanceState.state.activePhase.title,
    "governanceState.state.activePhase.title",
  );

  assert(
    phaseStatuses.has(
      governanceState.state.activePhase.status,
    ),
    "governanceState.state.activePhase.status is invalid",
  );

  assertString(
    governanceState.state.currentObjective,
    "governanceState.state.currentObjective",
  );

  assertStringArray(
    governanceState.state.completedWork,
    "governanceState.state.completedWork",
  );

  assertStringArray(
    governanceState.state.knownWarnings,
    "governanceState.state.knownWarnings",
  );

  assertExactKeys(
    governanceState.state.nextSession,
    [
      "objective",
      "startingInspection",
    ],
    "governanceState.state.nextSession",
  );

  assertString(
    governanceState.state.nextSession.objective,
    "governanceState.state.nextSession.objective",
  );

  assertString(
    governanceState.state.nextSession.startingInspection,
    "governanceState.state.nextSession.startingInspection",
  );

  assertExactKeys(
    governanceState.validation,
    [
      "focusedTests",
      "fullTests",
      "productionBuild",
    ],
    "governanceState.validation",
  );

  validateValidationResult(
    governanceState.validation.focusedTests,
    "governanceState.validation.focusedTests",
  );

  validateValidationResult(
    governanceState.validation.fullTests,
    "governanceState.validation.fullTests",
  );

  validateValidationResult(
    governanceState.validation.productionBuild,
    "governanceState.validation.productionBuild",
  );

  assertRequiredKeys(
    governanceState.completion,
    [
      "workComplete",
      "supportedByEvidence",
    ],
    "governanceState.completion",
  );

  assertAllowedKeys(
    governanceState.completion,
    new Set([
      "workComplete",
      "supportedByEvidence",
      "incompleteReason",
    ]),
    "governanceState.completion",
  );

  assertBoolean(
    governanceState.completion.workComplete,
    "governanceState.completion.workComplete",
  );

  assertBoolean(
    governanceState.completion.supportedByEvidence,
    "governanceState.completion.supportedByEvidence",
  );

  if (
    Object.hasOwn(
      governanceState.completion,
      "incompleteReason",
    )
  ) {
    assert(
      governanceState.completion.incompleteReason === null ||
        (
          typeof governanceState.completion.incompleteReason ===
            "string" &&
          governanceState.completion.incompleteReason.length > 0
        ),
      "governanceState.completion.incompleteReason must be null or a non-empty string",
    );
  }

  if (
    governanceState.completion.workComplete ||
    governanceState.completion.supportedByEvidence
  ) {
    assert(
      governanceState.completion.workComplete &&
        governanceState.completion.supportedByEvidence,
      "Completion requires both workComplete and supportedByEvidence",
    );
  }

  if (!governanceState.completion.workComplete) {
    assert(
      Object.hasOwn(
        governanceState.completion,
        "incompleteReason",
      ) &&
        typeof governanceState.completion.incompleteReason ===
          "string" &&
        governanceState.completion.incompleteReason.length > 0,
      "Incomplete work requires completion.incompleteReason",
    );
  }

  assertExactKeys(
    governanceState.authority,
    [
      "defaultAuthority",
      "promotionStateVersion",
      "capabilitiesVersion",
      "editableSectionsVersion",
    ],
    "governanceState.authority",
  );

  assert(
    governanceState.authority.defaultAuthority === "human",
    "governanceState.authority.defaultAuthority must equal human",
  );

  for (const field of [
    "promotionStateVersion",
    "capabilitiesVersion",
    "editableSectionsVersion",
  ]) {
    assertString(
      governanceState.authority[field],
      `governanceState.authority.${field}`,
    );
  }

  assertExactKeys(
    governanceState.synchronization,
    [
      "mode",
      "stateGeneratedAt",
      "sourceSnapshot",
      "rendererVersion",
    ],
    "governanceState.synchronization",
  );

  assert(
    GOVERNANCE_MODES.includes(
      governanceState.synchronization.mode,
    ),
    "governanceState.synchronization.mode must be a supported governance mode",
  );

  assertNullableDateTime(
    governanceState.synchronization.stateGeneratedAt,
    "governanceState.synchronization.stateGeneratedAt",
  );

  assertString(
    governanceState.synchronization.sourceSnapshot,
    "governanceState.synchronization.sourceSnapshot",
    { allowNull: true },
  );

  assertString(
    governanceState.synchronization.rendererVersion,
    "governanceState.synchronization.rendererVersion",
    { allowNull: true },
  );

  assert(
    governanceState.session.latestSnapshot ===
      governanceState.synchronization.sourceSnapshot,
    "session.latestSnapshot and synchronization.sourceSnapshot must match",
  );

  if (governanceState.session.latestSnapshot !== null) {
    assert(
      sessionSnapshot !== null,
      "sessionSnapshot is required when session.latestSnapshot is not null",
    );

    const snapshot =
      sessionSnapshot;

    assert(
      snapshot.schemaVersion === "1.0",
      "Referenced session snapshot schemaVersion must equal 1.0",
    );

    assertString(
      snapshot.sessionId,
      "Referenced session snapshot sessionId",
    );

    assertString(
      snapshot.repository?.head,
      "Referenced session snapshot repository.head",
    );

    assertString(
      snapshot.repository?.branch,
      "Referenced session snapshot repository.branch",
    );

    assertString(
      snapshot.evidence?.capturedAt,
      "Referenced session snapshot evidence.capturedAt",
    );
  }

  assert(
    isObject(promotionState),
    "promotionState must be an object",
  );

  assert(
    isObject(capabilitiesPolicy),
    "capabilitiesPolicy must be an object",
  );

  assert(
    isObject(editableSectionsPolicy),
    "editableSectionsPolicy must be an object",
  );

  assert(
    promotionState.version ===
      governanceState.authority.promotionStateVersion,
    "authority.promotionStateVersion disagrees with promotion-state.json",
  );

  assert(
    promotionState.defaultAuthority ===
      governanceState.authority.defaultAuthority,
    "authority.defaultAuthority disagrees with promotion-state.json",
  );

  assert(
    capabilitiesPolicy.version ===
      governanceState.authority.capabilitiesVersion,
    "authority.capabilitiesVersion disagrees with capabilities.json",
  );

  assert(
    editableSectionsPolicy.version ===
      governanceState.authority.editableSectionsVersion,
    "authority.editableSectionsVersion disagrees with editable-sections.json",
  );

  assert(
    capabilitiesPolicy.defaultPolicy === "deny",
    "Capabilities policy must remain deny by default",
  );

  assert(
    editableSectionsPolicy.defaultPolicy === "deny",
    "Editable-sections policy must remain deny by default",
  );

  assert(
    capabilitiesPolicy.capabilities.updateShadowDocuments ===
      true,
    "Capabilities policy must permit shadow-document updates",
  );

  assert(
    capabilitiesPolicy.capabilities.updateAuthoritativeDocuments ===
      false,
    "Capabilities policy must deny authoritative-document updates",
  );

  assert(
    capabilitiesPolicy.capabilities.changeGovernancePolicy ===
      false,
    "Capabilities policy must deny governance-policy changes",
  );

  assert(
    capabilitiesPolicy.capabilities.selectNextObjective ===
      false,
    "Capabilities policy must deny next-objective selection",
  );

  const reviewRequiredValues = [
    governanceState.state.activePhase.identifier,
    governanceState.state.activePhase.title,
    governanceState.state.currentObjective,
    governanceState.state.nextSession.objective,
    governanceState.state.nextSession.startingInspection,
  ];

  if (
    reviewRequiredValues.some(
      (value) => value === "REVIEW_REQUIRED",
    )
  ) {
    assert(
      governanceState.state.activePhase.status ===
        "incomplete",
      "REVIEW_REQUIRED state must use incomplete phase status",
    );

    assert(
      governanceState.completion.workComplete === false,
      "REVIEW_REQUIRED state may not mark work complete",
    );

    assert(
      governanceState.completion.supportedByEvidence ===
        false,
      "REVIEW_REQUIRED state may not claim completion evidence",
    );
  }

  if (governanceState.synchronization.rendererVersion === null) {
    assert(
      governanceState.synchronization.stateGeneratedAt ===
        null,
      "stateGeneratedAt must remain null until a renderer version exists",
    );
  }

  return Object.freeze({
    repositoryHead:
      governanceState.repository.head,

    governanceMode:
      governanceState.synchronization.mode,
  });
}

function normalizeRepositoryPath(
  suppliedPath,
  label,
) {
  assertString(
    suppliedPath,
    label,
  );

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

  assert(
    relativePath !== ".." &&
      !relativePath.startsWith(
        `..${path.sep}`,
      ) &&
      !path.isAbsolute(
        relativePath,
      ),
    `${label} must remain inside the repository`,
  );

  return relativePath;
}

function isDirectExecution() {
  const suppliedScriptPath =
    process.argv[1];

  if (!suppliedScriptPath) {
    return false;
  }

  return (
    import.meta.url ===
    pathToFileURL(
      path.resolve(
        suppliedScriptPath,
      ),
    ).href
  );
}

if (isDirectExecution()) {
  const suppliedPath =
    process.argv[2] ??
    "governance/state/current-governance-state.json";

  try {
    const statePath =
      normalizeRepositoryPath(
        suppliedPath,
        "Governance state path",
      );

    const governanceState =
      readJson(
        statePath,
        "Governance state",
      );

    const promotionState =
      readJson(
        "governance/state/promotion-state.json",
        "Promotion state",
      );

    const capabilitiesPolicy =
      readJson(
        "governance/policies/capabilities.json",
        "Capabilities policy",
      );

    const editableSectionsPolicy =
      readJson(
        "governance/policies/editable-sections.json",
        "Editable-sections policy",
      );

    const sessionSnapshot =
      governanceState.session?.latestSnapshot ===
      null
        ? null
        : readJson(
            normalizeRepositoryPath(
              governanceState.session
                ?.latestSnapshot,
              "Referenced session snapshot path",
            ),
            "Referenced session snapshot",
          );

    validateGovernanceState(
      governanceState,
      {
        promotionState,
        capabilitiesPolicy,
        editableSectionsPolicy,
        sessionSnapshot,
      },
    );

    console.log(
      `VALID GOVERNANCE STATE: ${statePath}`,
    );
  } catch (error) {
    console.error(
      `FAIL: ${error.message}`,
    );

    process.exitCode = 1;
  }
}
