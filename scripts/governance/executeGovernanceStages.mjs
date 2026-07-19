function assertNonEmptyString(
  value,
  label,
) {
  if (
    typeof value !== "string" ||
    value.trim().length === 0
  ) {
    throw new TypeError(
      `${label} must be a non-empty string`,
    );
  }
}

function validateStage(
  stage,
  index,
) {
  if (
    stage === null ||
    typeof stage !== "object" ||
    Array.isArray(stage)
  ) {
    throw new TypeError(
      `stage at index ${index} must be an object`,
    );
  }

  assertNonEmptyString(
    stage.name,
    `stage at index ${index} name`,
  );

  assertNonEmptyString(
    stage.scriptPath,
    `stage at index ${index} scriptPath`,
  );

  if (
    stage.args !== undefined &&
    !Array.isArray(stage.args)
  ) {
    throw new TypeError(
      `stage at index ${index} args must be an array`,
    );
  }
}

export function executeGovernanceStages(
  {
    stages,
    executeStage,
  },
) {
  if (!Array.isArray(stages)) {
    throw new TypeError(
      "stages must be an array",
    );
  }

  if (typeof executeStage !== "function") {
    throw new TypeError(
      "executeStage must be a function",
    );
  }

  const results = [];

  for (
    let index = 0;
    index < stages.length;
    index += 1
  ) {
    const stage = stages[index];

    validateStage(
      stage,
      index,
    );

    const args = [
      ...(stage.args ?? []),
    ];

    results.push(
      executeStage(
        stage.name,
        stage.scriptPath,
        args,
      ),
    );
  }

  return Object.freeze(results);
}
