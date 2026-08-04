import {
  createManagerOutcomeContract,
} from "../../contracts/v1/outcomes/index.js";

const MANAGER_IDENTITY =
  "transaction-review-manager";

const CAPABILITIES = Object.freeze({
  MANUAL:
    "transaction.assignment.manual",
  BULK:
    "transaction.assignment.bulk",
});

function freezeRecord(value) {
  if (
    value === null ||
    typeof value !== "object"
  ) {
    return value;
  }

  if (Array.isArray(value)) {
    return Object.freeze(
      value.map(freezeRecord),
    );
  }

  return Object.freeze(
    Object.fromEntries(
      Object.entries(value).map(
        ([key, entry]) => [
          key,
          freezeRecord(entry),
        ],
      ),
    ),
  );
}

function validateDependencies({
  manualAssignmentService,
  bulkAssignmentService,
}) {
  if (
    !manualAssignmentService ||
    typeof manualAssignmentService
      .assignTransactionToProperty !==
      "function"
  ) {
    throw new Error(
      "TransactionReviewManager requires a manual assignment service.",
    );
  }

  if (
    !bulkAssignmentService ||
    typeof bulkAssignmentService
      .assignTransactionsToProperty !==
      "function"
  ) {
    throw new Error(
      "TransactionReviewManager requires a bulk assignment service.",
    );
  }
}

function buildOutcome({
  requestContract,
  managerIdentity,
  capabilityInvoked,
  producedOutput,
  contextContribution,
}) {
  return createManagerOutcomeContract({
    contractId:
      `forge.outcome.manager.${capabilityInvoked}`,
    version:
      requestContract.metadata.version,
    description:
      "Reports deterministic transaction assignment outcome.",
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
          managerIdentity,
      }),
      contextVersion:
        requestContract.provenance
          .contextVersion,
      evidenceReferences: [],
    },
    managerIdentity,
    capabilityInvoked,
    completionStatus:
      "completed",
    stateChanged:
      true,
    producedOutput,
    producedEvidence: [],
    resultingRisks: [],
    validationRequirements: [
      "structural-validation",
      "assignment-result-validation",
    ],
    governanceRequirements: [
      "transaction-assignment-review",
    ],
    recoveryRequirements: [],
    additionalAuthorityRequirements: [
      "transaction-assignment-authority",
    ],
    contextContribution,
    failureClassification:
      undefined,
    timingInformation:
      Object.freeze({
        durationMilliseconds: 0,
      }),
  });
}

export class TransactionReviewManager {
  constructor({
    manualAssignmentService,
    bulkAssignmentService,
  }) {
    validateDependencies({
      manualAssignmentService,
      bulkAssignmentService,
    });

    this.managerIdentity =
      MANAGER_IDENTITY;

    this.capabilities =
      Object.freeze([
        CAPABILITIES.MANUAL,
        CAPABILITIES.BULK,
      ]);

    this.manualAssignmentService =
      manualAssignmentService;

    this.bulkAssignmentService =
      bulkAssignmentService;

    Object.freeze(this);
  }

  async execute(requestContract) {
    const requestedCapability =
      requestContract?.payload
        ?.requestedCapability;

    switch (requestedCapability) {
      case CAPABILITIES.MANUAL:
        return this.executeManual(
          requestContract,
        );

      case CAPABILITIES.BULK:
        return this.executeBulk(
          requestContract,
        );

      default:
        throw new Error(
          `Unsupported transaction review capability: ${requestedCapability}`,
        );
    }
  }

  async executeManual(requestContract) {
    const input =
      requestContract.payload.input ?? {};

    const result =
      await this.manualAssignmentService
        .assignTransactionToProperty(
          input,
        );

    const producedOutput =
      freezeRecord(result);

    return buildOutcome({
      requestContract,
      managerIdentity:
        this.managerIdentity,
      capabilityInvoked:
        CAPABILITIES.MANUAL,
      producedOutput,
      contextContribution:
        Object.freeze({
          manualTransactionAssignmentCompleted:
            true,
        }),
    });
  }

  async executeBulk(requestContract) {
    const input =
      requestContract.payload.input ?? {};

    const result =
      await this.bulkAssignmentService
        .assignTransactionsToProperty(
          input,
        );

    const producedOutput =
      freezeRecord(result);

    return buildOutcome({
      requestContract,
      managerIdentity:
        this.managerIdentity,
      capabilityInvoked:
        CAPABILITIES.BULK,
      producedOutput,
      contextContribution:
        Object.freeze({
          bulkTransactionAssignmentCompleted:
            true,
          assignedCount:
            Number(
              result?.assignedCount ?? 0,
            ),
        }),
    });
  }
}
