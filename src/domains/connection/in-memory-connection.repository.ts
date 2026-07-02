import type { ConnectionRepository } from "./connection.repository";
import type { Connection } from "./connection.types";

export class InMemoryConnectionRepository implements ConnectionRepository {
  private readonly connections = new Map<string, Connection>();

  save(connection: Connection): void {
    this.connections.set(connection.id, connection);
  }

  getById(id: string): Connection | null {
    return this.connections.get(id) ?? null;
  }

  getAll(): Connection[] {
    return [...this.connections.values()];
  }
}
