import { PropertyId } from "./property-id";
import type { PropertyRuleRepository } from "./property-rule.repository";
import type {
  PropertyResolutionRule,
  PropertyResolutionRuleType,
} from "./property-resolution-rule.types";
import type { Property } from "./property.types";
import type { Transaction } from "../transaction/transaction.types";

export type PropertyResolutionStrategy =
  | "explicit_source_name"
  | "explicit_assignment_rule"
  | "manual_rule"
  | "merchant_rule"
  | "description_rule"
  | "provider_metadata_rule"
  | "learned_rule"
  | "transaction_context_unknown";

export type PropertyResolutionResult = Readonly<{
  property: Property;
  strategy: PropertyResolutionStrategy;
  confidence: number;
  explanation: string;
}>;

export type TransactionPropertyResolutionInput = Readonly<{
  transaction: Transaction;
  ownerId?: string | null;
  organizationId?: string | null;
}>;

const RULE_TYPE_PRECEDENCE: readonly PropertyResolutionRuleType[] = [
  "explicit_assignment",
  "manual",
  "merchant",
  "description",
  "provider_metadata",
  "learned",
];

const RULE_TYPE_STRATEGY: Record<
  PropertyResolutionRuleType,
  PropertyResolutionStrategy
> = {
  explicit_assignment: "explicit_assignment_rule",
  manual: "manual_rule",
  merchant: "merchant_rule",
  description: "description_rule",
  provider_metadata: "provider_metadata_rule",
  learned: "learned_rule",
};

export class PropertyResolverService {
  static readonly UNKNOWN_PROPERTY_NAME = "Unknown Property";

  private readonly ruleRepository: PropertyRuleRepository | null;

  constructor({
    ruleRepository = null,
  }: {
    ruleRepository?: PropertyRuleRepository | null;
  } = {}) {
    this.ruleRepository = ruleRepository;
  }

  static fromSourceName({
    sourceName,
    sourceSystem = null,
  }: {
    sourceName: string;
    sourceSystem?: string | null;
  }): Property {
    return this.resolveFromSourceName({
      sourceName,
      sourceSystem,
    }).property;
  }

  static resolveFromSourceName({
    sourceName,
    sourceSystem = null,
  }: {
    sourceName: string;
    sourceSystem?: string | null;
  }): PropertyResolutionResult {
    const name = sourceName.trim();

    return {
      property: {
        id: PropertyId.fromSourceName(name).toString(),
        name,
        sourceSystem,
        sourceName: name,
      },
      strategy: "explicit_source_name",
      confidence: 1,
      explanation: "Resolved from an explicit source property name.",
    };
  }

  static resolveTransaction(
    input: TransactionPropertyResolutionInput,
  ): PropertyResolutionResult {
    return new PropertyResolverService().resolveTransaction(input);
  }

  resolveTransaction({
    transaction,
    ownerId = null,
    organizationId = null,
  }: TransactionPropertyResolutionInput): PropertyResolutionResult {
    const matchedRule = this.findMatchingRule({
      transaction,
      ownerId,
      organizationId,
    });

    if (matchedRule != null) {
      return {
        property: matchedRule.property,
        strategy: RULE_TYPE_STRATEGY[matchedRule.type],
        confidence: this.confidenceForRule(matchedRule),
        explanation: `Resolved by ${matchedRule.type} property rule.`,
      };
    }

    const property = this.createUnknownProperty({
      sourceSystem: transaction.provider,
      ownerId,
      organizationId,
    });

    return {
      property,
      strategy: "transaction_context_unknown",
      confidence: 0,
      explanation:
        "No property assignment rule matched the transaction context.",
    };
  }

  private findMatchingRule({
    transaction,
    ownerId,
    organizationId,
  }: {
    transaction: Transaction;
    ownerId: string | null;
    organizationId: string | null;
  }): PropertyResolutionRule | null {
    const rules =
      this.ruleRepository?.findRules({
        ownerId,
        organizationId,
      }) ?? [];

    for (const ruleType of RULE_TYPE_PRECEDENCE) {
      const match = rules.find(
        (rule) =>
          rule.type === ruleType &&
          this.ruleMatchesTransaction(rule, transaction),
      );

      if (match != null) {
        return match;
      }
    }

    return null;
  }

  private ruleMatchesTransaction(
    rule: PropertyResolutionRule,
    transaction: Transaction,
  ): boolean {
    const transactionValue = this.getTransactionFieldValue(
      transaction,
      rule.match.field,
    );

    if (transactionValue == null) {
      return false;
    }

    const actual = transactionValue.trim().toLowerCase();
    const expected = rule.match.value.trim().toLowerCase();

    if (actual.length === 0 || expected.length === 0) {
      return false;
    }

    if (rule.match.mode === "equals") {
      return actual === expected;
    }

    return actual.includes(expected);
  }

  private getTransactionFieldValue(
    transaction: Transaction,
    field: string,
  ): string | null {
    if (field === "description") {
      return transaction.description;
    }

    if (field === "merchantName") {
      return transaction.merchantName;
    }

    if (field.startsWith("raw.")) {
      return this.getRawTransactionFieldValue(
        transaction.raw,
        field.slice("raw.".length),
      );
    }

    return null;
  }

  private getRawTransactionFieldValue(
    raw: Record<string, unknown> | null,
    field: string,
  ): string | null {
    const value = raw?.[field];

    if (typeof value === "string") {
      return value;
    }

    if (
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return String(value);
    }

    return null;
  }

  private confidenceForRule(
    rule: PropertyResolutionRule,
  ): number {
    if (rule.type === "learned") {
      return 0.7;
    }

    if (rule.type === "provider_metadata") {
      return 0.8;
    }

    return 1;
  }

  private createUnknownProperty({
    sourceSystem,
    ownerId,
    organizationId,
  }: {
    sourceSystem: string;
    ownerId: string | null;
    organizationId: string | null;
  }): Property {
    return {
      id: PropertyId.fromSourceName(
        PropertyResolverService.UNKNOWN_PROPERTY_NAME,
      ).toString(),
      name: PropertyResolverService.UNKNOWN_PROPERTY_NAME,
      sourceSystem,
      sourceName: null,
      owner_id: ownerId,
      organization_id: organizationId,
    };
  }
}
