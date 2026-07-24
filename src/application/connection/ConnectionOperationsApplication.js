export class ConnectionOperationsApplication {
  constructor({
    connectionReadModelApplication,
  }) {
    if (!connectionReadModelApplication) {
      throw new Error(
        "ConnectionOperationsApplication requires a connection read model application.",
      );
    }

    this.connectionReadModelApplication =
      connectionReadModelApplication;
  }

  async buildConnectionOperations() {
    const dashboard =
      await this.connectionReadModelApplication
        .buildConnectionDashboard();

    return Object.freeze({
      type: "connection-operations",
      status: "ready",
      dashboard,
    });
  }
}

Object.freeze(ConnectionOperationsApplication);
