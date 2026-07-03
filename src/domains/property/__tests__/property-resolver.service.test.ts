import { describe, expect, it } from "vitest";

import { InMemoryPropertyRuleRepository } from "../in-memory-property-rule.repository";
import { PropertyResolverService } from "../property-resolver.service";
import type { PropertyResolutionRule } from "../property-resolution-rule.types";
import type { Property } from "../property.types";

import type { Transaction } from "../../transaction";

function buildTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: "transaction-1",
    financialAccountId: "financial-account-1",
    connectionId: "connection-1",
    provider: "plaid",
    providerTransactionId: "provider-transaction-1",
    providerAccountId: "provider-account-1",
    amountCents: 10000,
    currencyCode: "USD",
    date: "2026-07-01",
    description: "Repair at 170 John",
    merchantName: "ABC Plumbing",
    category: [],
    pending: false,
    raw: null,
    createdAt: "2026-07-01T00:00:00.000Z",
    ...overrides,
  };
}

function buildProperty(
  name: string,
): Property {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
  };
}

function buildRule(
  overrides: Partial<PropertyResolutionRule> = {},
): PropertyResolutionRule {
  return {
    id: "rule-1",
    type: "merchant",
    property: buildProperty("170 John"),
    enabled: true,
    priority: 100,
    match: {
      field: "merchantName",
      value: "ABC Plumbing",
      mode: "equals",
    },
    ...overrides,
  };
}

describe("PropertyResolverService", () => {
  it("returns Unknown Property when no rule matches", () => {
    const repository = new InMemoryPropertyRuleRepository();

    const resolver = new PropertyResolverService({
      ruleRepository: repository,
    });

    const result = resolver.resolveTransaction({
      transaction: buildTransaction(),
    });

    expect(result.strategy).toBe(
      "transaction_context_unknown",
    );
    expect(result.property.name).toBe(
      "Unknown Property",
    );
  });

  it("matches a merchant rule", () => {
    const repository = new InMemoryPropertyRuleRepository();

    repository.save(buildRule());

    const resolver = new PropertyResolverService({
      ruleRepository: repository,
    });

    const result = resolver.resolveTransaction({
      transaction: buildTransaction(),
    });

    expect(result.strategy).toBe(
      "merchant_rule",
    );
    expect(result.property.name).toBe(
      "170 John",
    );
  });

  it("prefers manual rules over merchant rules", () => {
    const repository = new InMemoryPropertyRuleRepository();

    repository.save(
      buildRule({
        id: "merchant",
        type: "merchant",
        property: buildProperty("Merchant Property"),
      }),
    );

    repository.save(
      buildRule({
        id: "manual",
        type: "manual",
        property: buildProperty("Manual Property"),
      }),
    );

    const resolver = new PropertyResolverService({
      ruleRepository: repository,
    });

    const result = resolver.resolveTransaction({
      transaction: buildTransaction(),
    });

    expect(result.strategy).toBe(
      "manual_rule",
    );
    expect(result.property.name).toBe(
      "Manual Property",
    );
  });

  it("matches description rules", () => {
    const repository = new InMemoryPropertyRuleRepository();

    repository.save(
      buildRule({
        type: "description",
        property: buildProperty("Description Property"),
        match: {
          field: "description",
          value: "170 John",
          mode: "contains",
        },
      }),
    );

    const resolver = new PropertyResolverService({
      ruleRepository: repository,
    });

    const result = resolver.resolveTransaction({
      transaction: buildTransaction(),
    });

    expect(result.strategy).toBe(
      "description_rule",
    );
    expect(result.property.name).toBe(
      "Description Property",
    );
  });
});
