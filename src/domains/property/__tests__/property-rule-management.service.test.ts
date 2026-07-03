import { describe, expect, it } from "vitest";

import { InMemoryPropertyRuleRepository } from "../in-memory-property-rule.repository";
import { PropertyResolverService } from "../property-resolver.service";
import { PropertyRuleManagementService } from "../property-rule-management.service";
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

describe("PropertyRuleManagementService", () => {
  it("creates a reusable manual property rule from a user assignment", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const service = new PropertyRuleManagementService(repository);

    const property = buildProperty("170 John");

    const rule = await service.createManualPropertyRule({
      transaction: buildTransaction(),
      property,
      ownerId: "owner-1",
      organizationId: "organization-1",
    });

    expect(rule.type).toBe("manual");
    expect(rule.property).toBe(property);
    expect(rule.enabled).toBe(true);
    expect(rule.priority).toBe(1_000);
    expect(rule.ownerId).toBe("owner-1");
    expect(rule.organizationId).toBe("organization-1");
    expect(rule.match).toEqual({
      field: "merchantName",
      value: "ABC Plumbing",
      mode: "equals",
    });
  });

  it("allows the resolver to reuse persisted manual rules for future transactions", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const service = new PropertyRuleManagementService(repository);

    await service.createManualPropertyRule({
      transaction: buildTransaction(),
      property: buildProperty("170 John"),
    });

    const resolver = new PropertyResolverService({
      ruleRepository: repository,
    });

    const result = await resolver.resolveTransaction({
      transaction: buildTransaction({
        id: "future-transaction-1",
        providerTransactionId: "future-provider-transaction-1",
        description: "Different repair text",
        merchantName: "ABC Plumbing",
      }),
    });

    expect(result.strategy).toBe("manual_rule");
    expect(result.property.name).toBe("170 John");
  });

  it("falls back to description matching when merchant name is unavailable", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const service = new PropertyRuleManagementService(repository);

    const rule = await service.createManualPropertyRule({
      transaction: buildTransaction({
        merchantName: null,
      }),
      property: buildProperty("170 John"),
    });

    expect(rule.match).toEqual({
      field: "description",
      value: "Repair at 170 John",
      mode: "equals",
    });
  });
});
