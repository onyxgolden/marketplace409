import {
  createBaseContract,
  createContractMetadata,
  createContractProvenance,
} from "../core/index.js";

function freezeCollection(value) {
  return Array.isArray(value)
    ? Object.freeze([...value])
    : value;
}

export function createEvidenceRecordContract({
  contractId,
  version,
  description,
  provenance,
  evidenceId,
  evidenceType,
  sourceComponent,
  lifecycleState,
  summary,
  validationStatus,
  artifacts = [],
}) {
  const metadata = createContractMetadata({
    contractId,
    contractType: "evidence-record",
    version,
    description,
  });

  const contractProvenance =
    createContractProvenance(provenance);

  const payload = Object.freeze({
    evidenceId,
    evidenceType,
    sourceComponent,
    lifecycleState,
    summary,
    validationStatus,
    artifacts:
      freezeCollection(artifacts),
  });

  return createBaseContract({
    metadata,
    payload,
    provenance: contractProvenance,
  });
}
