import {
  selectEligibleValidationEvidence,
} from "./selectEligibleValidationEvidence.mjs";

const validationCategories = [
  "focusedTests",
  "fullTests",
  "productionBuild",
];

function assertObject(
  value,
  location,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new TypeError(
      `${location} must be an object`,
    );
  }
}

function createNotRunResult() {
  return {
    status: "not-run",
    command: null,
    summary: null,
  };
}

function createNotRunValidation() {
  return {
    focusedTests:
      createNotRunResult(),

    fullTests:
      createNotRunResult(),

    productionBuild:
      createNotRunResult(),
  };
}

function formatCommand(
  commandEvidence,
  location,
) {
  assertObject(
    commandEvidence,
    location,
  );

  if (
    typeof commandEvidence.command !==
      "string" ||
    commandEvidence.command.length === 0
  ) {
    throw new TypeError(
      `${location}.command must be a non-empty string`,
    );
  }

  if (
    !Array.isArray(
      commandEvidence.args,
    ) ||
    commandEvidence.args.some(
      (argument) =>
        typeof argument !==
          "string",
    )
  ) {
    throw new TypeError(
      `${location}.args must be an array of strings`,
    );
  }

  return [
    commandEvidence.command,
    ...commandEvidence.args,
  ].join(" ");
}

function normalizeResult(
  category,
  artifact,
) {
  const result =
    artifact.results[category];

  assertObject(
    result,
    `artifact.results.${category}`,
  );

  if (
    result.status === "not-run"
  ) {
    return (
      createNotRunResult()
    );
  }

  if (
    ![
      "passing",
      "failing",
    ].includes(
      result.status,
    )
  ) {
    throw new TypeError(
      `artifact.results.${category}.status is invalid`,
    );
  }

  if (
    !Array.isArray(
      result.commandIndexes,
    ) ||
    result.commandIndexes.length ===
      0
  ) {
    throw new TypeError(
      `artifact.results.${category}.commandIndexes must reference executed commands`,
    );
  }

  const commandStrings =
    result.commandIndexes.map(
      (
        commandIndex,
        index,
      ) => {
        if (
          !Number.isInteger(
            commandIndex,
          ) ||
          commandIndex < 0 ||
          commandIndex >=
            artifact.commands.length
        ) {
          throw new TypeError(
            `artifact.results.${category}.commandIndexes[${index}] is invalid`,
          );
        }

        const command =
          artifact.commands[
            commandIndex
          ];

        if (
          command.category !==
            category
        ) {
          throw new Error(
            `artifact.commands[${commandIndex}].category does not match ${category}`,
          );
        }

        return formatCommand(
          command,
          `artifact.commands[${commandIndex}]`,
        );
      },
    );

  return {
    status:
      result.status,

    command:
      commandStrings.join(
        " && ",
      ),

    summary:
      result.summary ??
      null,
  };
}

function normalizeSelectedArtifact(
  selected,
) {
  assertObject(
    selected,
    "selection.selected",
  );

  assertObject(
    selected.artifact,
    "selection.selected.artifact",
  );

  const artifact =
    selected.artifact;

  if (
    typeof selected.path !==
      "string" ||
    selected.path.length === 0
  ) {
    throw new TypeError(
      "selection.selected.path must be a non-empty string",
    );
  }

  if (
    typeof artifact.validationId !==
      "string" ||
    artifact.validationId.length ===
      0
  ) {
    throw new TypeError(
      "selection.selected.artifact.validationId must be a non-empty string",
    );
  }

  if (
    typeof artifact.completedAt !==
      "string" ||
    artifact.completedAt.length ===
      0
  ) {
    throw new TypeError(
      "selection.selected.artifact.completedAt must be a non-empty string",
    );
  }

  assertObject(
    artifact.repository,
    "selection.selected.artifact.repository",
  );

  assertObject(
    artifact.repository.before,
    "selection.selected.artifact.repository.before",
  );

  const head =
    artifact.repository.before.head;

  if (
    typeof head !== "string" ||
    head.length === 0
  ) {
    throw new TypeError(
      "selection.selected.artifact.repository.before.head must be a non-empty string",
    );
  }

  return {
    path:
      selected.path,

    validationId:
      artifact.validationId,

    completedAt:
      artifact.completedAt,

    repositoryHead:
      head,
  };
}

export function buildSessionValidationEvidence({
  repositoryRoot =
    process.cwd(),

  selectEvidence =
    selectEligibleValidationEvidence,
} = {}) {
  if (
    typeof selectEvidence !==
      "function"
  ) {
    throw new TypeError(
      "selectEvidence must be a function",
    );
  }

  const selection =
    selectEvidence({
      repositoryRoot,
    });

  assertObject(
    selection,
    "selection",
  );

  if (
    selection.selected ===
      null
  ) {
    return {
      validation:
        createNotRunValidation(),

      selectedArtifact:
        null,
    };
  }

  assertObject(
    selection.selected.artifact,
    "selection.selected.artifact",
  );

  const artifact =
    selection.selected.artifact;

  assertObject(
    artifact.results,
    "selection.selected.artifact.results",
  );

  if (
    !Array.isArray(
      artifact.commands,
    )
  ) {
    throw new TypeError(
      "selection.selected.artifact.commands must be an array",
    );
  }

  const validation = {};

  for (
    const category
    of validationCategories
  ) {
    validation[category] =
      normalizeResult(
        category,
        artifact,
      );
  }

  return {
    validation,

    selectedArtifact:
      normalizeSelectedArtifact(
        selection.selected,
      ),
  };
}
