import {
  FinancialManager,
} from "./financial/index.js";

import {
  TransactionReviewManager,
} from "./transaction-review/index.js";

function validateDependencies({
  managerRegistry,
  forgeApplicationSuite,
}) {
  if (
    !managerRegistry ||
    typeof managerRegistry.register !== "function"
  ) {
    throw new Error(
      "Authenticated business manager registration requires a manager registry.",
    );
  }

  if (
    !forgeApplicationSuite ||
    typeof forgeApplicationSuite !== "object"
  ) {
    throw new Error(
      "Authenticated business manager registration requires a FORGE application suite.",
    );
  }

  const financialOperationsApplication =
    forgeApplicationSuite
      .financialApplicationSuite
      ?.financialOperationsApplication;

  const manualAssignmentService =
    forgeApplicationSuite
      .transactionReviewApplicationSuite
      ?.manualAssignmentService;

  const bulkAssignmentService =
    forgeApplicationSuite
      .transactionReviewApplicationSuite
      ?.bulkAssignmentService;

  return {
    financialOperationsApplication,
    manualAssignmentService,
    bulkAssignmentService,
  };
}

export function registerAuthenticatedBusinessManagers({
  managerRegistry,
  forgeApplicationSuite,
}) {
  const {
    financialOperationsApplication,
    manualAssignmentService,
    bulkAssignmentService,
  } = validateDependencies({
    managerRegistry,
    forgeApplicationSuite,
  });

  const financialManager =
    new FinancialManager({
      financialOperationsApplication,
    });

  const transactionReviewManager =
    new TransactionReviewManager({
      manualAssignmentService,
      bulkAssignmentService,
    });

  const financialRegistration =
    managerRegistry.register(
      financialManager,
    );

  const transactionReviewRegistration =
    managerRegistry.register(
      transactionReviewManager,
    );

  return Object.freeze({
    managerRegistry,
    registrations: Object.freeze([
      financialRegistration,
      transactionReviewRegistration,
    ]),
    registeredManagerIdentities:
      Object.freeze([
        financialRegistration.managerIdentity,
        transactionReviewRegistration.managerIdentity,
      ]),
  });
}
