export function createIdentity({
  id,
  entityId,
  entityType,
  externalIds = {},
  tenantId = null,
  createdBy = null,
  updatedBy = null,
}) {
  return {
    id,
    entityId,
    entityType,
    externalIds,
    tenantId,
    createdBy,
    updatedBy,
  };
}

export function hasExternalId(identity, provider) {
  return Boolean(identity?.externalIds?.[provider]);
}
