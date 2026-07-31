import {
  createManagerOutcomeContract,
} from "../../contracts/v1/outcomes/index.js";

const MANAGER_IDENTITY =
  "planning-manager";

const PLANNING_CAPABILITY =
  "planning.create";

export class PlanningManager {
  constructor() {
    this.managerIdentity =
      MANAGER_IDENTITY;

    this.capabilities = Object.freeze([
      PLANNING_CAPABILITY,
    ]);

    Object.freeze(this);
  }

  async execute(requestContract) {
    const requestedCapability =
      requestContract?.payload
        ?.requestedCapability;

    if (
      requestedCapability !==
      PLANNING_CAPABILITY
    ) {
      throw new Error(
        `Unsupported planning capability: ${requestedCapability}`,
      );
    }

    const producedOutput =
      Object.freeze({
        planState: "created",
        objective:
          requestContract.payload.input
            ?.objective ?? null,
        steps: Object.freeze([]),
        assumptions: Object.freeze([]),
        risks: Object.freeze([]),
      });

    const contextContribution =
      Object.freeze({
        planningCompleted: true,
      });

    return createManagerOutcomeContract({
      contractId:
        "forge.outcome.manager.planning",
      version:
        requestContract.metadata.version,
      description:
        "Reports deterministic planning outcome.",
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
        PLANNING_CAPABILITY,
      completionStatus: "completed",
      stateChanged: false,
      producedOutput,
      producedEvidence: [],
      resultingRisks: [],
      validationRequirements: [
        "structural-validation",
      ],
      governanceRequirements: [
        "planning-authority-review",
      ],
      recoveryRequirements: [],
      additionalAuthorityRequirements: [],
      contextContribution,
      failureClassification: undefined,
      timingInformation:
        Object.freeze({
          durationMilliseconds: 0,
        }),
    });
  }
}
