export function createBaseContract({
  metadata,
  payload,
  provenance,
}) {
  return Object.freeze({
    metadata,
    payload,
    provenance,
  });
}
