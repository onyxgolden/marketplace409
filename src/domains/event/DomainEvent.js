export function createDomainEvent({
  id,
  eventType,
  entityId,
  entityType,
  actorId = null,
  payload = {},
  occurredAt = new Date().toISOString(),
}) {
  return {
    id,
    eventType,
    entityId,
    entityType,
    actorId,
    payload,
    occurredAt,
  };
}

export function isEventType(event, eventType) {
  return event?.eventType === eventType;
}
