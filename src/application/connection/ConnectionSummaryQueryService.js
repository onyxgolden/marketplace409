import {
  createConnectionCollection,
  findConnectionProvider,
  getConnectionStatusDetails,
} from "../../domains/connection";

export class ConnectionSummaryQueryService {
  constructor({
    connectionQueryService,
    institutionReferenceRepository,
    providerRegistry,
  } = {}) {
    if (
      !connectionQueryService ||
      typeof connectionQueryService.findConnections !== "function"
    ) {
      throw new Error(
        "ConnectionSummaryQueryService requires a connection query service.",
      );
    }

    if (
      !institutionReferenceRepository ||
      typeof institutionReferenceRepository.getAll !== "function"
    ) {
      throw new Error(
        "ConnectionSummaryQueryService requires an institution reference repository.",
      );
    }

    if (
      !providerRegistry ||
      !Array.isArray(providerRegistry.providers)
    ) {
      throw new Error(
        "ConnectionSummaryQueryService requires a connection provider registry.",
      );
    }

    this.connectionQueryService =
      connectionQueryService;

    this.institutionReferenceRepository =
      institutionReferenceRepository;

    this.providerRegistry =
      providerRegistry;

    Object.freeze(this);
  }

  async getConnectionCollection(ownerId) {
    const connections =
      await this.connectionQueryService.findConnections(
        ownerId,
      );

    const institutionReferences =
      await this.institutionReferenceRepository.getAll({
        ownerId,
      });

    const institutionByConnectionId = new Map(
      institutionReferences.map(
        (institutionReference) => [
          institutionReference.connectionId,
          institutionReference,
        ],
      ),
    );

    const summaries = await Promise.all(
      connections.map(async (connection) => {
        const provider = findConnectionProvider(
          this.providerRegistry,
          connection.provider,
        );

        if (!provider) {
          throw new Error(
            `Connection provider is not registered: ${connection.provider}`,
          );
        }

        const institution =
          institutionByConnectionId.get(
            connection.id,
          );

        if (!institution) {
          throw new Error(
            `Institution reference is required for connection: ${connection.id}`,
          );
        }

        const providerCapabilities =
          provider.capabilities();

        const capabilities = Object.freeze({
          ...providerCapabilities,
          connectionId: connection.id,
          capabilities: Object.freeze([
            ...providerCapabilities.capabilities,
          ]),
        });

        const health = Object.freeze({
          ...(await provider.reportHealth(
            connection,
          )),
        });

        const statusDetails = Object.freeze({
          ...getConnectionStatusDetails(
            connection.status,
          ),
        });

        return Object.freeze({
          connection,
          statusDetails,
          capabilities,
          institution,
          health,
          createdAt: connection.createdAt,
          updatedAt: connection.updatedAt,
        });
      }),
    );

    const collection = createConnectionCollection(
      Object.freeze(summaries),
    );

    return Object.freeze({
      ...collection,
      connections: Object.freeze([
        ...collection.connections,
      ]),
    });
  }
}

Object.freeze(ConnectionSummaryQueryService);
