import type {
  PropertyResolutionRule,
  PropertyResolutionRuleContext,
} from "./property-resolution-rule.types";

export interface PropertyRuleRepository {
  findRules(
    context?: PropertyResolutionRuleContext,
  ): readonly PropertyResolutionRule[];

  save(
    rule: PropertyResolutionRule,
  ): PropertyResolutionRule;

  saveMany(
    rules: readonly PropertyResolutionRule[],
  ): readonly PropertyResolutionRule[];
}
