export class ConnectionReviewExecutionCoordinator {
  constructor({
    connectionRepository,
    credentialReferenceRepository,
    institutionReferenceRepository,
  }) {
    this.connectionRepository =
      connectionRepository;

    this.credentialReferenceRepository =
      credentialReferenceRepository;

    this.institutionReferenceRepository =
      institutionReferenceRepository;
  }

  async executeReview({
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
        "Connection not found for review execution.",
      );
    }

    const credentialReference =
      connection.credentialReferenceId
        ? await this
            .credentialReferenceRepository
            .getById(
              connection.credentialReferenceId,
              context,
            )
        : null;

    const institutionReferences =
      await this
        .institutionReferenceRepository
        .getAll(context);

    const institutionReference =
      institutionReferences.find(
        (candidate) =>
          candidate.connectionId ===
          connection.id,
      ) ?? null;

    const hasCredentialReference =
      credentialReference !== null;

    const hasInstitutionReference =
      institutionReference !== null;

    const status =
      connection.status || "unknown";

    const connected =
      status === "connected";

    const allowsImport =
      connected &&
      hasCredentialReference &&
      hasInstitutionReference;

    const requiresUserAction =
      !allowsImport;

    const severity =
      allowsImport
        ? "healthy"
        : "attention";

    const recommendedOperation =
      allowsImport
        ? "import-transactions"
        : "repair-connection";

    return Object.freeze({
      type:
        "connection-review-execution",
      connectionId:
        connection.id,
      ownerId,
      provider:
        connection.provider || null,
      status,
      severity,
      allowsImport,
      requiresUserAction,
      recommendedOperation,
    });
  }
}
