import { TransactionReviewItem } from "../transaction-review";
import type { Transaction } from "../transaction/transaction.types";
import type { PropertyResolutionRule } from "./property-resolution-rule.types";
import type {
  CreateManualPropertyRuleInput,
  PropertyRuleManagementService,
} from "./property-rule-management.service";
import type { Property } from "./property.types";

export type ManualPropertyAssignmentInput = Readonly<{
  transaction: Transaction;
  property: Property;
  ownerId?: string | null;
  organizationId?: string | null;
  reviewItem?: TransactionReviewItem;
}>;

export type ManualPropertyAssignmentResult = Readonly<{
  transaction: Transaction;
  property: Property;
  rule: PropertyResolutionRule;
  reviewItem: TransactionReviewItem | null;
}>;

type PropertyRuleManagementServiceLike = Pick<
  PropertyRuleManagementService,
  "createManualPropertyRule"
>;

export class ManualPropertyAssignmentService {
  constructor(
    private readonly dependencies: {
      ruleManagementService: PropertyRuleManagementServiceLike;
    },
  ) {}

  async assignTransactionToProperty({
    transaction,
    property,
    ownerId = null,
    organizationId = null,
    reviewItem = undefined,
  }: ManualPropertyAssignmentInput): Promise<ManualPropertyAssignmentResult> {
    const input: CreateManualPropertyRuleInput = {
      transaction,
      property,
      ownerId,
      organizationId,
    };

    const rule =
      await this.dependencies.ruleManagementService.createManualPropertyRule(
        input,
      );

    return {
      transaction,
      property,
      rule,
      reviewItem: reviewItem
        ? new TransactionReviewItem({
            record: reviewItem.record,
            transaction: reviewItem.transaction,
            resolvedProperty: property,
            needsAssignment: false,
            confidence: 1,
            suggestedProperties: reviewItem.suggestedProperties,
            assignmentStatus: "assigned",
            reviewState: "reviewed",
          })
        : null,
    };
  }
}
