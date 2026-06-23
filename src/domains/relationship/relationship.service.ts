import { RelationshipRepository } from "./relationship.repository";
import type { Relationship } from "./relationship.types";

class RelationshipServiceImpl {
  async getAll(): Promise<Relationship[]> {
    return RelationshipRepository.getAll();
  }

  isActive(relationship: Pick<Relationship, "end_date">): boolean {
    if (!relationship.end_date) {
      return true;
    }

    return new Date(relationship.end_date) > new Date();
  }
}

export const RelationshipService = new RelationshipServiceImpl();
