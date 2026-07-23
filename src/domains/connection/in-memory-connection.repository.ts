import type {
  ConnectionPersistenceContext,
  ConnectionRepository,
} from "./connection.repository";
import type { Connection } from "./connection.types";

export class InMemoryConnectionRepository implements ConnectionRepository {
  private readonly connections = new Map<string, Connection>();

  async save(
    connection: Connection,
    _context?: ConnectionPersistenceContext,
  ): Promise<Connection> {
    this.connections.set(connection.id, connection);
    return connection;
  }

  async getById(
    id: string,
    _context?: ConnectionPersistenceContext,
  ): Promise<Connection | null> {
    return this.connections.get(id) ?? null;
  }

  async getAll(
    _context?: ConnectionPersistenceContext,
  ): Promise<readonly Connection[]> {
    return [...this.connections.values()];
  }
}
