import type { PropertyRuleRepository } from "./property-rule.repository";
import type { PropertyResolutionRule } from "./property-resolution-rule.types";
import type { Property } from "./property.types";
import type { Transaction } from "../transaction/transaction.types";

export type CreateManualPropertyRuleInput = Readonly<{
  transaction: Transaction;
  property: Property;
  ownerId?: string | null;
  organizationId?: string | null;
}>;

export class PropertyRuleManagementService {
  constructor(
    private readonly ruleRepository: PropertyRuleRepository,
  ) {}

  async createManualPropertyRule({
    transaction,
    property,
    ownerId = null,
    organizationId = null,
  }: CreateManualPropertyRuleInput): Promise<PropertyResolutionRule> {
    const merchantName = transaction.merchantName?.trim();

    const rule: PropertyResolutionRule = {
      id: this.createManualRuleId({
        transactionId: transaction.id,
        propertyId: property.id,
      }),
      type: "manual",
      property,
      priority: 1_000,
      ownerId,
      organizationId,
      enabled: true,
      match: merchantName
        ? {
            field: "merchantName",
            value: merchantName,
            mode: "equals",
          }
        : {
            field: "description",
            value: transaction.description.trim(),
            mode: "equals",
          },
    };

    return this.ruleRepository.save(rule);
  }

  private createManualRuleId({
    transactionId,
    propertyId,
  }: {
    transactionId: string;
    propertyId: string;
  }): string {
    return `manual-property-rule:${propertyId}:${transactionId}`;
  }
}
