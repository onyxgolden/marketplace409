import type { Entity } from "@/types/entity";

export type RelationshipType =
  | "owns"
  | "manages"
  | "belongs_to"
  | "linked_to"
  | "secured_by"
  | "funded_by"
  | "guaranteed_by"
  | "insured_by"
  | "filed_with"
  | "generated_by";

export type Relationship = Entity & {
  from_entity_id: string;
  from_entity_type: string;

  to_entity_id: string;
  to_entity_type: string;

  relationship_type: RelationshipType;

  ownership_percentage?: number | null;

  start_date?: string | null;
  end_date?: string | null;

  metadata?: Record<string, unknown> | null;
};
