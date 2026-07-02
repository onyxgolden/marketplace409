import type {
  ConnectionImportOrchestratorDependencies,
  ConnectionImportOrchestratorInput,
  ConnectionImportOrchestratorResult,
} from "./connection-import-orchestrator.types";

import {
  toConnectionImportOrchestratorResult,
} from "./connection-import-orchestrator.types";

export class ConnectionImportOrchestrator {
  private readonly provider: ConnectionImportOrchestratorDependencies["provider"];

  constructor(dependencies: ConnectionImportOrchestratorDependencies) {
    this.provider = dependencies.provider;
  }

  async importConnection(
    input: ConnectionImportOrchestratorInput,
  ): Promise<ConnectionImportOrchestratorResult> {
    if (input.connection.provider !== this.provider.provider) {
      throw new Error("Connection provider does not match orchestrator provider.");
    }

    const result = await this.provider.importData(input.connection);

    return toConnectionImportOrchestratorResult(result);
  }
}
