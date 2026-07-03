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
}>;

export type ManualPropertyAssignmentResult = Readonly<{
  transaction: Transaction;
  property: Property;
  rule: PropertyResolutionRule;
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
    };
  }
}
