export class ConnectionQueryService {
  constructor({
    connectionRepository,
  } = {}) {
    if (
      !connectionRepository ||
      typeof connectionRepository.getAll !== "function"
    ) {
      throw new Error(
        "ConnectionQueryService requires a connection repository.",
      );
    }

    this.connectionRepository = connectionRepository;

    Object.freeze(this);
  }

  async findConnections(ownerId) {
    if (
      typeof ownerId !== "string" ||
      ownerId.trim().length === 0
    ) {
      throw new Error("Owner id is required");
    }

    return this.connectionRepository.getAll({
      ownerId,
    });
  }
}

Object.freeze(ConnectionQueryService);
