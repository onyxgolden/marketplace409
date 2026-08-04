import { TransactionReviewApplication } from "../../application/financial";

import {
  BulkPropertyAssignmentService,
  ManualPropertyAssignmentService,
  PropertyRuleManagementService,
  SupabasePropertyRuleRepository,
} from "../../domains/property";

export function createTransactionReviewApplicationSuite(deps = {}) {
  const ruleRepository =
    deps.ruleRepository ||
    new SupabasePropertyRuleRepository(
      deps.supabaseClient,
    );

  const ruleManagementService =
    deps.ruleManagementService ||
    new PropertyRuleManagementService(ruleRepository);

  const manualAssignmentService =
    deps.manualAssignmentService ||
    new ManualPropertyAssignmentService({
      ruleManagementService,
    });

  const bulkAssignmentService =
    deps.bulkAssignmentService ||
    new BulkPropertyAssignmentService({
      manualAssignmentService,
    });

  const reviewApplication =
    deps.reviewApplication ||
    new TransactionReviewApplication();

  return Object.freeze({
    reviewApplication,
    ruleRepository,
    ruleManagementService,
    manualAssignmentService,
    bulkAssignmentService,
  });
}
