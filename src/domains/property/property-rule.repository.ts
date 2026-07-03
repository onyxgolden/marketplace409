import type {
  PropertyResolutionRule,
  PropertyResolutionRuleContext,
} from "./property-resolution-rule.types";

export interface PropertyRuleRepository {
  findRules(
    context?: PropertyResolutionRuleContext,
  ): Promise<readonly PropertyResolutionRule[]>;

  save(
    rule: PropertyResolutionRule,
  ): Promise<PropertyResolutionRule>;

  saveMany(
    rules: readonly PropertyResolutionRule[],
  ): Promise<readonly PropertyResolutionRule[]>;
}
