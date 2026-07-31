import {
  createManagerOutcomeContract,
} from "../../contracts/v1/outcomes/index.js";

const MANAGER_IDENTITY =
  "repository-intelligence-manager";

const REPOSITORY_INSPECTION_CAPABILITY =
  "repository.inspect";

export class RepositoryIntelligenceManager {
  constructor() {
    this.managerIdentity = MANAGER_IDENTITY;
    this.capabilities = Object.freeze([
      REPOSITORY_INSPECTION_CAPABILITY,
    ]);

    Object.freeze(this);
  }

  async execute(requestContract) {
    const requestedCapability =
      requestContract?.payload
        ?.requestedCapability;

    if (
      requestedCapability !==
      REPOSITORY_INSPECTION_CAPABILITY
    ) {
      throw new Error(
        `Unsupported repository intelligence capability: ${requestedCapability}`,
      );
    }

    const producedOutput = Object.freeze({
      repositoryState: "inspected",
      branch: "unknown",
      dirty: "unknown",
      commit: "unknown",
      observations: Object.freeze([]),
    });

    const contextContribution =
      Object.freeze({
        repositoryInspectionCompleted: true,
      });

    const timingInformation =
      Object.freeze({
        durationMilliseconds: 0,
      });

    return createManagerOutcomeContract({
      contractId:
        "forge.outcome.manager.repository-inspection",
      version: requestContract.metadata.version,
      description:
        "Reports deterministic repository inspection outcome.",
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
          componentId: this.managerIdentity,
        }),
        contextVersion:
          requestContract.provenance
            .contextVersion,
        evidenceReferences: [],
      },
      managerIdentity: this.managerIdentity,
      capabilityInvoked:
        REPOSITORY_INSPECTION_CAPABILITY,
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
