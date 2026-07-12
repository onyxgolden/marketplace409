function assertObject(value, location) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(`${location} must be an object`);
  }
}

function displayValue(
  value,
  fallback = "Not recorded",
) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return fallback;
  }

  return String(value);
}

function displayWorkingTree(workingTreeClean) {
  if (workingTreeClean === true) {
    return "clean";
  }

  if (workingTreeClean === false) {
    return "dirty";
  }

  return "Not recorded";
}

function displayValidationResult(result) {
  assertObject(result, "validation result");

  const status = displayValue(result.status);

  if (
    result.summary === null ||
    result.summary === undefined ||
    result.summary === ""
  ) {
    return status;
  }

  return `${status} — ${result.summary}`;
}

export function buildRepositoryState(
  governanceState,
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const repository = governanceState.repository;

  assertObject(
    repository,
    "governanceState.repository",
  );

  return [
    "## Repository State",
    "",
    "| Check                 | Result       |",
    "| --------------------- | ------------ |",
    `| Branch                | ${displayValue(
      repository.branch,
    )} |`,
    `| HEAD                  | ${displayValue(
      repository.head,
    )} |`,
    `| origin/main           | ${displayValue(
      repository.originMain,
    )} |`,
    `| Working tree          | ${displayWorkingTree(
      repository.workingTreeClean,
    )} |`,
    "| Implementation commit | Not recorded |",
    "| Governance commit     | Not recorded |",
  ].join("\n");
}

export function buildRepositoryHealth(
  governanceState,
) {
  assertObject(
    governanceState,
    "governanceState",
  );

  const repository = governanceState.repository;
  const validation = governanceState.validation;

  assertObject(
    repository,
    "governanceState.repository",
  );

  assertObject(
    validation,
    "governanceState.validation",
  );

  return [
    "## Repository Health",
    "",
    "| Check            | Result |",
    "| ---------------- | ------ |",
    `| Branch           | ${displayValue(
      repository.branch,
    )} |`,
    `| HEAD             | ${displayValue(
      repository.head,
    )} |`,
    `| origin/main      | ${displayValue(
      repository.originMain,
    )} |`,
    `| Working tree     | ${displayWorkingTree(
      repository.workingTreeClean,
    )} |`,
    `| Focused tests    | ${displayValidationResult(
      validation.focusedTests,
    )} |`,
    `| Full tests       | ${displayValidationResult(
      validation.fullTests,
    )} |`,
    `| Production build | ${displayValidationResult(
      validation.productionBuild,
    )} |`,
  ].join("\n");
}
