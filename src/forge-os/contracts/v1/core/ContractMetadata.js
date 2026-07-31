export function createContractMetadata({
  contractId,
  contractType,
  version,
  description,
}) {
  return Object.freeze({
    contractId,
    contractType,
    version,
    description,
  });
}
