import type { Connection } from "./connection.types";

export interface ConnectionRepository {
  save(connection: Connection): void;
  getById(id: string): Connection | null;
  getAll(): Connection[];
}
