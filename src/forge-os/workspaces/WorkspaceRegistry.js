import {
  WorkspaceDefinition,
} from "./WorkspaceDefinition.js";

export class WorkspaceRegistry {
  constructor() {
    this.workspaces = new Map();
  }

  register(workspace) {
    if (
      !(workspace instanceof WorkspaceDefinition)
    ) {
      throw new Error(
        "WorkspaceRegistry requires a WorkspaceDefinition.",
      );
    }

    if (
      this.workspaces.has(
        workspace.workspaceIdentity,
      )
    ) {
      throw new Error(
        `Workspace already registered: ${workspace.workspaceIdentity}`,
      );
    }

    this.workspaces.set(
      workspace.workspaceIdentity,
      workspace,
    );

    return workspace;
  }

  get(workspaceIdentity) {
    return (
      this.workspaces.get(
        workspaceIdentity,
      ) ?? null
    );
  }

  has(workspaceIdentity) {
    return this.workspaces.has(
      workspaceIdentity,
    );
  }

  list() {
    return Object.freeze(
      Array.from(
        this.workspaces.values(),
      ).sort(
        (left, right) =>
          left.workspaceIdentity.localeCompare(
            right.workspaceIdentity,
          ),
      ),
    );
  }
}
