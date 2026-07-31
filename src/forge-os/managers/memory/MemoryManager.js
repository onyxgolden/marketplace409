import {
  createManagerOutcomeContract,
} from "../../contracts/v1/outcomes/index.js";

const MANAGER_IDENTITY =
  "memory-manager";

const MEMORY_RETRIEVAL_CAPABILITY =
  "memory.retrieve";

export class MemoryManager {
  constructor() {
    this.managerIdentity = MANAGER_IDENTITY;

    this.capabilities = Object.freeze([
      MEMORY_RETRIEVAL_CAPABILITY,
    ]);

    Object.freeze(this);
  }

  async execute(requestContract) {
    const requestedCapability =
      requestContract?.payload
        ?.requestedCapability;

    if (
      requestedCapability !==
      MEMORY_RETRIEVAL_CAPABILITY
    ) {
      throw new Error(
        `Unsupported memory capability: ${requestedCapability}`,
      );
    }

    const producedOutput =
      Object.freeze({
        memoryState: "retrieved",
        records: Object.freeze([]),
        observations: Object.freeze([]),
      });

    const contextContribution =
      Object.freeze({
        memoryRetrievalCompleted: true,
      });

    const timingInformation =
      Object.freeze({
        durationMilliseconds: 0,
      });

    return createManagerOutcomeContract({
      contractId:
        "forge.outcome.manager.memory-retrieval",
      version:
        requestContract.metadata.version,
      description:
        "Reports deterministic memory retrieval outcome.",
      provenance: {
        requestId:
          requestContract.provenance.requestId,
        workflowId:
          requestContract.provenance.workflowId,
        correlationId:
          requestContract.provenance.correlationId,
        causationId:
          requestContract.metadata.contractId,
        parentContractId:
          requestContract.metadata.contractId,
        origin: Object.freeze({
          componentType: "manager",
          componentId:
            this.managerIdentity,
        }),
        contextVersion:
          requestContract.provenance.contextVersion,
        evidenceReferences: [],
      },
      managerIdentity:
        this.managerIdentity,
      capabilityInvoked:
        MEMORY_RETRIEVAL_CAPABILITY,
      completionStatus: "completed",
      stateChanged: false,
      producedOutput,
      producedEvidence: [],
      resultingRisks: [],
      validationRequirements: [
        "structural-validation",
      ],
      governanceRequirements: [],
      recoveryRequirements: [],
      additionalAuthorityRequirements: [],
      contextContribution,
      failureClassification: undefined,
      timingInformation,
    });
  }
}
