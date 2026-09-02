function requireNonEmptyString(value, fieldName) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`WorkspaceModule requires a ${fieldName}.`);
  }

  return value.trim();
}

function requireNonNegativeInteger(value, fieldName) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `WorkspaceModule requires ${fieldName} to be a non-negative integer.`,
    );
  }

  return value;
}

export class WorkspaceModule {
  constructor({
    moduleIdentity,
    displayName,
    category,
    priority = 100,
    renderTile,
    isVisible = () => true,
  }) {
    this.moduleIdentity = requireNonEmptyString(
      moduleIdentity,
      "moduleIdentity",
    );

    this.displayName = requireNonEmptyString(
      displayName,
      "displayName",
    );

    this.category = requireNonEmptyString(
      category,
      "category",
    );

    this.priority = requireNonNegativeInteger(
      priority,
      "priority",
    );

    if (typeof renderTile !== "function") {
      throw new Error(
        "WorkspaceModule requires a renderTile function.",
      );
    }

    if (typeof isVisible !== "function") {
      throw new Error(
        "WorkspaceModule's isVisible must be a function.",
      );
    }

    this.renderTile = renderTile;
    this.isVisible = isVisible;

    Object.freeze(this);
  }
}
