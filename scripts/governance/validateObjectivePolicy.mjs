import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = process.cwd();

const defaultPolicyPath =
  "governance/policies/objective-policy.json";

const capabilitiesPath =
  "governance/policies/capabilities.json";

function fail(message) {
  throw new Error(message);
}

function assertObject(
  value,
  location,
) {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    fail(`${location} must be an object`);
  }
}

function assertString(
  value,
  location,
) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    fail(
      `${location} must be a non-empty string`,
    );
  }
}

function assertStringArray(
  value,
  location,
) {
  if (
    !Array.isArray(value) ||
    value.some(
      (item) =>
        typeof item !== "string" ||
        item.length === 0,
    )
  ) {
    fail(
      `${location} must be an array of non-empty strings`,
    );
  }
}

function readJson(
  suppliedPath,
  label,
) {
  const absolutePath = path.resolve(
    repositoryRoot,
    suppliedPath,
  );

  if (!fs.existsSync(absolutePath)) {
    fail(
      `${label} does not exist: ${suppliedPath}`,
    );
  }

  try {
    return JSON.parse(
      fs.readFileSync(
        absolutePath,
        "utf8",
      ),
    );
  } catch (error) {
    fail(
      `${label} is not valid JSON: ${error.message}`,
    );
  }
}

export function validateObjectivePolicy(
  objectivePolicy,
  capabilitiesPolicy,
) {
  assertObject(
    objectivePolicy,
    "objectivePolicy",
  );

  assertObject(
    capabilitiesPolicy,
    "capabilitiesPolicy",
  );

  assertString(
    objectivePolicy.version,
    "objectivePolicy.version",
  );

  assertString(
    objectivePolicy.description,
    "objectivePolicy.description",
  );

  if (
    objectivePolicy.defaultAuthority !==
    "human"
  ) {
    fail(
      "objectivePolicy.defaultAuthority must equal human",
    );
  }

  if (
    objectivePolicy.recommendationMode !==
    "advisory-only"
  ) {
    fail(
      "objectivePolicy.recommendationMode must equal advisory-only",
    );
  }

  if (
    objectivePolicy.selectionAllowed !==
    false
  ) {
    fail(
      "objectivePolicy.selectionAllowed must remain false",
    );
  }

  assertObject(
    capabilitiesPolicy.capabilities,
    "capabilitiesPolicy.capabilities",
  );

  if (
    capabilitiesPolicy.capabilities
      .selectNextObjective !== false
  ) {
    fail(
      "capabilitiesPolicy.capabilities.selectNextObjective must remain false",
    );
  }

  assertObject(
    objectivePolicy.roadmapPosition,
    "objectivePolicy.roadmapPosition",
  );

  assertString(
    objectivePolicy.roadmapPosition
      .nextPhaseIdentifier,
    "objectivePolicy.roadmapPosition.nextPhaseIdentifier",
  );

  if (
    !Array.isArray(
      objectivePolicy.phases,
    ) ||
    objectivePolicy.phases.length === 0
  ) {
    fail(
      "objectivePolicy.phases must be a non-empty array",
    );
  }

  assertStringArray(
    objectivePolicy.rules,
    "objectivePolicy.rules",
  );

  const phaseIdentifiers = [];
  const phasesByIdentifier = new Map();

  objectivePolicy.phases.forEach(
    (phase, index) => {
      const location =
        `objectivePolicy.phases[${index}]`;

      assertObject(
        phase,
        location,
      );

      assertString(
        phase.identifier,
        `${location}.identifier`,
      );

      assertString(
        phase.title,
        `${location}.title`,
      );

      assertString(
        phase.objective,
        `${location}.objective`,
      );

      if (
        ![
          "planned",
          "active",
          "blocked",
          "incomplete",
          "complete",
        ].includes(phase.status)
      ) {
        fail(
          `${location}.status is invalid`,
        );
      }

      assertStringArray(
        phase.prerequisites,
        `${location}.prerequisites`,
      );

      if (
        phasesByIdentifier.has(
          phase.identifier,
        )
      ) {
        fail(
          `Duplicate phase identifier: ${phase.identifier}`,
        );
      }

      phaseIdentifiers.push(
        phase.identifier,
      );

      phasesByIdentifier.set(
        phase.identifier,
        phase,
      );
    },
  );

  for (
    const [
      phaseIdentifier,
      phase,
    ]
    of phasesByIdentifier
  ) {
    for (
      const prerequisite
      of phase.prerequisites
    ) {
      if (
        !phasesByIdentifier.has(
          prerequisite,
        )
      ) {
        fail(
          `Phase ${phaseIdentifier} references undefined prerequisite ${prerequisite}`,
        );
      }

      if (
        phaseIdentifiers.indexOf(
          prerequisite,
        ) >=
        phaseIdentifiers.indexOf(
          phaseIdentifier,
        )
      ) {
        fail(
          `Phase ${phaseIdentifier} prerequisite ${prerequisite} must appear earlier in the policy`,
        );
      }
    }
  }

  const nextPhaseIdentifier =
    objectivePolicy.roadmapPosition
      .nextPhaseIdentifier;

  const nextPhase =
    phasesByIdentifier.get(
      nextPhaseIdentifier,
    );

  if (!nextPhase) {
    fail(
      "objectivePolicy.roadmapPosition.nextPhaseIdentifier must identify a defined phase",
    );
  }

  if (
    nextPhase.status === "complete"
  ) {
    fail(
      "The next roadmap phase may not already be complete",
    );
  }

  const incompletePrerequisites =
    nextPhase.prerequisites.filter(
      (prerequisite) =>
        phasesByIdentifier.get(
          prerequisite,
        ).status !== "complete",
    );

  if (
    incompletePrerequisites.length > 0
  ) {
    fail(
      `The next roadmap phase has incomplete prerequisites: ${incompletePrerequisites.join(", ")}`,
    );
  }

  return {
    version:
      objectivePolicy.version,
    phaseCount:
      objectivePolicy.phases.length,
    nextPhaseIdentifier,
  };
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
  const suppliedPolicyPath =
    process.argv[2] ??
    defaultPolicyPath;

  try {
    const objectivePolicy =
      readJson(
        suppliedPolicyPath,
        "Objective policy",
      );

    const capabilitiesPolicy =
      readJson(
        capabilitiesPath,
        "Capabilities policy",
      );

    const result =
      validateObjectivePolicy(
        objectivePolicy,
        capabilitiesPolicy,
      );

    console.log(
      `VALID OBJECTIVE POLICY: ${suppliedPolicyPath}`,
    );

    console.log(
      `Version: ${result.version}`,
    );

    console.log(
      `Phases: ${result.phaseCount}`,
    );

    console.log(
      `Next phase: ${result.nextPhaseIdentifier}`,
    );
  } catch (error) {
    console.error(
      `INVALID OBJECTIVE POLICY: ${error.message}`,
    );

    process.exitCode = 1;
  }
}
