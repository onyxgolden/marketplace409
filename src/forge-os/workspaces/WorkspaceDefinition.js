function requireNonEmptyString(value, fieldName) {
  if (
    typeof value !== "string" ||
    value.length === 0
  ) {
    throw new Error(
      `WorkspaceDefinition requires a ${fieldName}.`,
    );
  }
}

function freezeStringCollection(
  value,
  fieldName,
  {
    allowEmpty = true,
  } = {},
) {
  if (!Array.isArray(value)) {
    throw new Error(
      `WorkspaceDefinition ${fieldName} must be an array.`,
    );
  }

  if (!allowEmpty && value.length === 0) {
    throw new Error(
      `WorkspaceDefinition requires at least one ${fieldName} entry.`,
    );
  }

  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0
    ) {
      throw new Error(
        `WorkspaceDefinition ${fieldName} must contain non-empty strings.`,
      );
    }
  }

  if (new Set(value).size !== value.length) {
    throw new Error(
      `WorkspaceDefinition ${fieldName} must be unique.`,
    );
  }

  return Object.freeze([...value]);
}

function freezeObject(value, fieldName) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      `WorkspaceDefinition ${fieldName} must be an object.`,
    );
  }

  return Object.freeze({...value});
}

export class WorkspaceDefinition {
  constructor({
    workspaceIdentity,
    displayName,
    version = {
      major: 1,
      minor: 0,
      patch: 0,
      identifier: "1.0.0",
    },
    managerIdentities,
    capabilities,
    dependencies = [],
    activationRequirements = [],
    metadata = {},
  }) {
    requireNonEmptyString(
      workspaceIdentity,
      "workspaceIdentity",
    );

    requireNonEmptyString(
      displayName,
      "displayName",
    );

    this.workspaceIdentity =
      workspaceIdentity;

    this.displayName =
      displayName;

    this.version =
      freezeObject(version, "version");

    this.managerIdentities =
      freezeStringCollection(
        managerIdentities,
        "managerIdentities",
        {
          allowEmpty: false,
        },
      );

    this.capabilities =
      freezeStringCollection(
        capabilities,
        "capabilities",
        {
          allowEmpty: false,
        },
      );

    this.dependencies =
      freezeStringCollection(
        dependencies,
        "dependencies",
      );

    this.activationRequirements =
      freezeStringCollection(
        activationRequirements,
        "activationRequirements",
      );

    this.metadata =
      freezeObject(metadata, "metadata");

    Object.freeze(this);
  }
}
