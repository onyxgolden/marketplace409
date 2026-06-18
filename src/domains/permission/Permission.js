export const PERMISSION_ACTIONS = {
  VIEW: "view",
  CREATE: "create",
  UPDATE: "update",
  DELETE: "delete",
  SHARE: "share",
  ADMIN: "admin",
};

export function createPermission({
  id,
  entityId,
  entityType,
  principalId,
  principalType,
  actions = [],
  createdAt = new Date().toISOString(),
}) {
  return {
    id,
    entityId,
    entityType,
    principalId,
    principalType,
    actions,
    createdAt,
  };
}

export function canPerform(permission, action) {
  return Boolean(permission?.actions?.includes(action));
}
