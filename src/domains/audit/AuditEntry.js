export const AUDIT_ACTIONS = {
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  VIEW: "view",
  SHARE: "share",
};

export function createAuditEntry({
  id,
  entityId,
  entityType,
  action,
  actorId,
  changes = {},
  createdAt = new Date().toISOString(),
}) {
  return {
    id,
    entityId,
    entityType,
    action,
    actorId,
    changes,
    createdAt,
  };
}
