import { BaseRepository } from "@/repositories";
import { mapRelationshipRowToRelationship } from "./relationship.mapper";
import type { Relationship } from "./relationship.types";

class RelationshipRepositoryImpl extends BaseRepository<any> {
  constructor() {
    super("relationships");
  }

  async getAll(): Promise<Relationship[]> {
    const rows = await super.getAll();
    return rows.map(mapRelationshipRowToRelationship);
  }
}

export const RelationshipRepository = new RelationshipRepositoryImpl();
