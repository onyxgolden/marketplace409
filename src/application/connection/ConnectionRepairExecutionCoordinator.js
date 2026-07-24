import {
  findConnectionProvider,
  getConnectionStatusDetails,
} from "../../domains/connection/index.ts";

export class ConnectionRepairExecutionCoordinator {
  constructor({
    connectionRepository,
    credentialReferenceRepository,
    institutionReferenceRepository,
    providerRegistry,
  }) {
    this.connectionRepository =
      connectionRepository;

    this.credentialReferenceRepository =
      credentialReferenceRepository;

    this.institutionReferenceRepository =
      institutionReferenceRepository;

    this.providerRegistry =
      providerRegistry;
  }

  async executeRepair({
    connectionId,
    ownerId,
  }) {
    const context = Object.freeze({
      ownerId,
    });

    const connection =
      await this.connectionRepository.getById(
        connectionId,
        context,
      );

    if (connection === null) {
      throw new Error(
        "Connection not found for repair execution.",
      );
    }

    if (!connection.credentialReferenceId) {
      throw new Error(
        "Connection credential reference is required for repair execution.",
      );
    }

    const credentialReference =
      await this.credentialReferenceRepository.getById(
        connection.credentialReferenceId,
        context,
      );

    if (credentialReference === null) {
      throw new Error(
        "Credential reference not found for repair execution.",
      );
    }

    const institutionReferences =
      await this.institutionReferenceRepository.getAll(
        context,
      );

    const institutionReference =
      institutionReferences.find(
        (candidate) =>
          candidate.connectionId ===
          connection.id,
      ) ?? null;

    if (institutionReference === null) {
      throw new Error(
        "Institution reference not found for repair execution.",
      );
    }

    const provider =
      findConnectionProvider(
        this.providerRegistry,
        connection.provider,
      );

    if (provider === null) {
      throw new Error(
        "Connection provider not found for repair execution.",
      );
    }

    const credentialValidationResult =
      await provider.validateCredentials(
        credentialReference,
      );

    if (!credentialValidationResult.success) {
      return Object.freeze({
        type:
          "connection-repair-execution",
        connectionId:
          connection.id,
        ownerId,
        provider:
          connection.provider,
        previousStatus:
          connection.status,
        status:
          connection.status,
        credentialValid: false,
        synchronized: false,
        repaired: false,
        allowsImport: false,
        requiresUserAction: true,
        recommendedOperation:
          "reauthenticate-connection",
        occurredAt:
          credentialValidationResult
            .occurredAt,
      });
    }

    const status =
      await provider.refreshStatus(
        connection,
      );

    const synchronizationResult =
      await provider.synchronize(
        connection,
      );

    const statusDetails =
      getConnectionStatusDetails(
        status,
      );

    const synchronized =
      synchronizationResult.success;

    const repaired =
      synchronized &&
      statusDetails.allowsImport &&
      !statusDetails.requiresUserAction;

    const allowsImport =
      repaired;

    const requiresUserAction =
      !repaired;

    const recommendedOperation =
      repaired
        ? "import-transactions"
        : statusDetails.requiresUserAction
          ? "reauthenticate-connection"
          : "repair-connection";

    return Object.freeze({
      type:
        "connection-repair-execution",
      connectionId:
        connection.id,
      ownerId,
      provider:
        connection.provider,
      previousStatus:
        connection.status,
      status,
      credentialValid: true,
      synchronized,
      repaired,
      allowsImport,
      requiresUserAction,
      recommendedOperation,
      occurredAt:
        synchronizationResult.occurredAt,
    });
  }
}
