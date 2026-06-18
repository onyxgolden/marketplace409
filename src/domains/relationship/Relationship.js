export const RELATIONSHIP_TYPES = {
  OWNS: "owns",
  MANAGES: "manages",
  BELONGS_TO: "belongs_to",
  LINKED_TO: "linked_to",
  SECURED_BY: "secured_by",
  FUNDED_BY: "funded_by",
  GUARANTEED_BY: "guaranteed_by",
  INSURED_BY: "insured_by",
  FILED_WITH: "filed_with",
  GENERATED_BY: "generated_by",
};

export function createRelationship({
  id,
  fromEntityId,
  fromEntityType,
  toEntityId,
  toEntityType,
  relationshipType,
  ownershipPercentage = null,
  startDate = null,
  endDate = null,
  metadata = {},
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
}) {
  return {
    id,
    fromEntityId,
    fromEntityType,
    toEntityId,
    toEntityType,
    relationshipType,
    ownershipPercentage,
    startDate,
    endDate,
    metadata,
    createdAt,
    updatedAt,
  };
}

export function isActiveRelationship(relationship) {
  if (!relationship?.endDate) return true;

  return new Date(relationship.endDate) > new Date();
}
