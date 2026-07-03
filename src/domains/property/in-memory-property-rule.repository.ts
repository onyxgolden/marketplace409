import type { PropertyRuleRepository } from "./property-rule.repository";

import type {
  PropertyResolutionRule,
  PropertyResolutionRuleContext,
} from "./property-resolution-rule.types";

export class InMemoryPropertyRuleRepository
  implements PropertyRuleRepository {
  private readonly rules = new Map<string, PropertyResolutionRule>();

  save(
    rule: PropertyResolutionRule,
  ): PropertyResolutionRule {
    this.rules.set(rule.id, rule);
    return rule;
  }

  saveMany(
    rules: readonly PropertyResolutionRule[],
  ): readonly PropertyResolutionRule[] {
    for (const rule of rules) {
      this.save(rule);
    }

    return rules;
  }

  findRules(
    context: PropertyResolutionRuleContext = {},
  ): readonly PropertyResolutionRule[] {
    const {
      ownerId = null,
      organizationId = null,
    } = context;

    return Array.from(this.rules.values())
      .filter((rule) => rule.enabled !== false)
      .filter((rule) => {
        if (
          rule.ownerId != null &&
          rule.ownerId !== ownerId
        ) {
          return false;
        }

        if (
          rule.organizationId != null &&
          rule.organizationId !== organizationId
        ) {
          return false;
        }

        return true;
      })
      .sort(
        (left, right) =>
          (right.priority ?? 0) -
          (left.priority ?? 0),
      );
  }
}
