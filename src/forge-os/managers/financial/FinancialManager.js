import {
  createManagerOutcomeContract,
} from "../../contracts/v1/outcomes/index.js";

const MANAGER_IDENTITY =
  "financial-manager";

const BUILD_FINANCIAL_OPERATIONS_CAPABILITY =
  "financial.operations.build";

function freezeOutput(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(
      "FinancialManager requires financial operations output.",
    );
  }

  return Object.freeze({
    ...value,
    actions: Array.isArray(value.actions)
      ? Object.freeze([
          ...value.actions.map(
            (action) =>
              Object.freeze({
                ...action,
              }),
          ),
        ])
      : Object.freeze([]),
    source:
      value.source &&
      typeof value.source === "object" &&
      !Array.isArray(value.source)
        ? Object.freeze({
            ...value.source,
          })
        : Object.freeze({}),
  });
}

export class FinancialManager {
  constructor({
    financialOperationsApplication,
  }) {
    if (
      !financialOperationsApplication ||
      typeof financialOperationsApplication
        .buildFinancialOperations !==
        "function"
    ) {
      throw new Error(
        "FinancialManager requires a financial operations application.",
      );
    }

    this.managerIdentity =
      MANAGER_IDENTITY;

    this.capabilities =
      Object.freeze([
        BUILD_FINANCIAL_OPERATIONS_CAPABILITY,
      ]);

    this.financialOperationsApplication =
      financialOperationsApplication;

    Object.freeze(this);
  }

  async execute(requestContract) {
    const requestedCapability =
      requestContract?.payload
        ?.requestedCapability;

    if (
      requestedCapability !==
      BUILD_FINANCIAL_OPERATIONS_CAPABILITY
    ) {
      throw new Error(
        `Unsupported financial capability: ${requestedCapability}`,
      );
    }

    const operations =
      await this
        .financialOperationsApplication
        .buildFinancialOperations();

    const producedOutput =
      freezeOutput(operations);

    const contextContribution =
      Object.freeze({
        financialOperationsBuilt:
          true,
      });

    return createManagerOutcomeContract({
      contractId:
        "forge.outcome.manager.financial-operations",
      version:
        requestContract.metadata.version,
      description:
        "Reports deterministic financial operations outcome.",
      provenance: {
        requestId:
          requestContract.provenance
            .requestId,
        workflowId:
          requestContract.provenance
            .workflowId,
        correlationId:
          requestContract.provenance
            .correlationId,
        causationId:
          requestContract.metadata
            .contractId,
        parentContractId:
          requestContract.metadata
            .contractId,
        origin: Object.freeze({
          componentType:
            "manager",
          componentId:
            this.managerIdentity,
        }),
        contextVersion:
          requestContract.provenance
            .contextVersion,
        evidenceReferences: [],
      },
      managerIdentity:
        this.managerIdentity,
      capabilityInvoked:
        BUILD_FINANCIAL_OPERATIONS_CAPABILITY,
      completionStatus:
        "completed",
      stateChanged:
        false,
      producedOutput,
      producedEvidence: [],
      resultingRisks: [],
      validationRequirements: [
        "structural-validation",
      ],
      governanceRequirements: [
        "financial-recommendation-review",
      ],
      recoveryRequirements: [],
      additionalAuthorityRequirements: [],
      contextContribution,
      failureClassification:
        undefined,
      timingInformation:
        Object.freeze({
          durationMilliseconds: 0,
        }),
    });
  }
}
