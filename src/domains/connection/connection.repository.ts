import type { Connection } from "./connection.types";

export type ConnectionPersistenceContext = Readonly<{
  ownerId: string;
}>;

export interface ConnectionRepository {
  save(
    connection: Connection,
    context?: ConnectionPersistenceContext,
  ): Promise<Connection>;

  getById(
    id: string,
    context?: ConnectionPersistenceContext,
  ): Promise<Connection | null>;

  getAll(
    context?: ConnectionPersistenceContext,
  ): Promise<readonly Connection[]>;
}
