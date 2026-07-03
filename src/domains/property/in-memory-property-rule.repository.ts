import type { PropertyRuleRepository } from "./property-rule.repository";

import type {
  PropertyResolutionRule,
  PropertyResolutionRuleContext,
} from "./property-resolution-rule.types";

export class InMemoryPropertyRuleRepository
  implements PropertyRuleRepository {
  private readonly rules = new Map<string, PropertyResolutionRule>();

  async save(
    rule: PropertyResolutionRule,
  ): Promise<PropertyResolutionRule> {
    this.rules.set(rule.id, rule);
    return rule;
  }

  async saveMany(
    rules: readonly PropertyResolutionRule[],
  ): Promise<readonly PropertyResolutionRule[]> {
    for (const rule of rules) {
      await this.save(rule);
    }

    return rules;
  }

  async findRules(
    context: PropertyResolutionRuleContext = {},
  ): Promise<readonly PropertyResolutionRule[]> {
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
