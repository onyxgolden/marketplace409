import { WorkspaceModule } from "./WorkspaceModule.js";

export class WorkspaceRegistry {
  constructor() {
    this.modules = new Map();
  }

  register(workspaceModule) {
    if (!(workspaceModule instanceof WorkspaceModule)) {
      throw new Error(
        "WorkspaceRegistry requires a WorkspaceModule.",
      );
    }

    const { moduleIdentity } = workspaceModule;

    if (this.modules.has(moduleIdentity)) {
      throw new Error(
        `Workspace module already registered: ${moduleIdentity}`,
      );
    }

    this.modules.set(
      moduleIdentity,
      workspaceModule,
    );

    return workspaceModule;
  }

  get(moduleIdentity) {
    return this.modules.get(moduleIdentity) || null;
  }

  has(moduleIdentity) {
    return this.modules.has(moduleIdentity);
  }

  list() {
    return Object.freeze(
      Array.from(this.modules.values()).sort(
        (left, right) =>
          left.priority - right.priority ||
          left.moduleIdentity.localeCompare(
            right.moduleIdentity,
          ),
      ),
    );
  }
}
