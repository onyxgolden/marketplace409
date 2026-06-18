export const FORGE_OBJECT_STATUS = {
  ACTIVE: "active",
  ARCHIVED: "archived",
  DELETED: "deleted",
  DRAFT: "draft",
};

export function createForgeObject({
  id,
  objectType,
  ownerId = null,
  status = FORGE_OBJECT_STATUS.ACTIVE,
  tags = [],
  metadata = {},
  createdAt = new Date().toISOString(),
  updatedAt = new Date().toISOString(),
}) {
  return {
    id,
    objectType,
    ownerId,
    status,
    tags,
    metadata,
    createdAt,
    updatedAt,
  };
}

export function isActiveForgeObject(object) {
  return object?.status === FORGE_OBJECT_STATUS.ACTIVE;
}
