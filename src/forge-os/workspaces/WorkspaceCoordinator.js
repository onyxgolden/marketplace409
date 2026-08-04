function createActivationResult({
  workspaceIdentity,
  status,
  managerIdentities,
  capabilities,
}) {
  return Object.freeze({
    workspaceIdentity,
    status,
    managerIdentities:
      Object.freeze([
        ...managerIdentities,
      ]),
    capabilities:
      Object.freeze([
        ...capabilities,
      ]),
  });
}

export class WorkspaceCoordinator {
  constructor({
    workspaceRegistry,
    managerRegistry,
  }) {
    if (
      !workspaceRegistry ||
      typeof workspaceRegistry.list !==
        "function" ||
      typeof workspaceRegistry.has !==
        "function"
    ) {
      throw new Error(
        "WorkspaceCoordinator requires a workspaceRegistry.",
      );
    }

    if (
      !managerRegistry ||
      typeof managerRegistry.has !==
        "function" ||
      typeof managerRegistry.hasCapability !==
        "function"
    ) {
      throw new Error(
        "WorkspaceCoordinator requires a managerRegistry.",
      );
    }

    this.workspaceRegistry =
      workspaceRegistry;

    this.managerRegistry =
      managerRegistry;

    Object.freeze(this);
  }

  discover() {
    return this.workspaceRegistry.list();
  }

  activateAll() {
    const discovered =
      this.discover();

    const activated =
      new Set();

    const pending =
      new Map(
        discovered.map(
          (workspace) => [
            workspace.workspaceIdentity,
            workspace,
          ],
        ),
      );

    const results = [];

    while (pending.size > 0) {
      const ready =
        Array.from(
          pending.values(),
        )
          .filter(
            (workspace) =>
              workspace.dependencies.every(
                (dependency) =>
                  activated.has(dependency),
              ),
          )
          .sort(
            (left, right) =>
              left.workspaceIdentity.localeCompare(
                right.workspaceIdentity,
              ),
          );

      if (ready.length === 0) {
        throw new Error(
          "Workspace activation dependencies cannot be resolved.",
        );
      }

      for (const workspace of ready) {
        this.validateWorkspace(
          workspace,
        );

        results.push(
          createActivationResult({
            workspaceIdentity:
              workspace.workspaceIdentity,
            status: "activated",
            managerIdentities:
              workspace.managerIdentities,
            capabilities:
              workspace.capabilities,
          }),
        );

        activated.add(
          workspace.workspaceIdentity,
        );

        pending.delete(
          workspace.workspaceIdentity,
        );
      }
    }

    return Object.freeze(results);
  }

  validateWorkspace(workspace) {
    for (
      const dependency
      of workspace.dependencies
    ) {
      if (
        !this.workspaceRegistry.has(
          dependency,
        )
      ) {
        throw new Error(
          `Unknown workspace dependency: ${dependency}`,
        );
      }
    }

    for (
      const managerIdentity
      of workspace.managerIdentities
    ) {
      if (
        !this.managerRegistry.has(
          managerIdentity,
        )
      ) {
        throw new Error(
          `Unknown workspace manager: ${managerIdentity}`,
        );
      }
    }

    for (
      const capability
      of workspace.capabilities
    ) {
      if (
        !this.managerRegistry.hasCapability(
          capability,
        )
      ) {
        throw new Error(
          `Unknown workspace capability: ${capability}`,
        );
      }
    }

    return true;
  }
}
