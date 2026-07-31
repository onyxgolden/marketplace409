export function createContractProvenance({
  requestId,
  workflowId,
  correlationId,
  causationId,
  parentContractId,
  origin,
  contextVersion,
  evidenceReferences = [],
}) {
  return Object.freeze({
    requestId,
    workflowId,
    correlationId,
    causationId,
    parentContractId,
    origin,
    contextVersion,
    evidenceReferences: Object.freeze([
      ...evidenceReferences,
    ]),
  });
}
