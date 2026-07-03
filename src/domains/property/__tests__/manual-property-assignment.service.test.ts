import { describe, expect, it } from "vitest";
import { TransactionReviewItem } from "../../transaction-review";

import { InMemoryPropertyRuleRepository } from "../in-memory-property-rule.repository";
import { ManualPropertyAssignmentService } from "../manual-property-assignment.service";
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

function buildProperty(name: string): Property {
  return {
    id: name.toLowerCase().replace(/\s+/g, "-"),
    name,
  };
}

describe("ManualPropertyAssignmentService", () => {
  it("persists a manual rule when a user assigns a transaction to a property", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const service = new ManualPropertyAssignmentService({
      ruleManagementService: new PropertyRuleManagementService(repository),
    });

    const property = buildProperty("170 John");

    const result = await service.assignTransactionToProperty({
      transaction: buildTransaction(),
      property,
      ownerId: "owner-1",
      organizationId: "organization-1",
    });

    expect(result.property).toBe(property);
    expect(result.rule.type).toBe("manual");
    expect(result.rule.ownerId).toBe("owner-1");
    expect(result.rule.organizationId).toBe("organization-1");
  });

  it("allows future imports to resolve through the existing resolver without resolver changes", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const service = new ManualPropertyAssignmentService({
      ruleManagementService: new PropertyRuleManagementService(repository),
    });

    await service.assignTransactionToProperty({
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
  it("returns an updated reviewed assignment item when a review item is supplied", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const service = new ManualPropertyAssignmentService({
      ruleManagementService: new PropertyRuleManagementService(repository),
    });

    const transaction = buildTransaction();
    const property = buildProperty("170 John");

    const reviewItem = new TransactionReviewItem({
      record: { id: "record-1" },
      transaction,
      resolvedProperty: { name: "Unknown Property" },
      needsAssignment: true,
      confidence: 0,
      suggestedProperties: [property],
      assignmentStatus: "suggested",
      reviewState: "pending",
    });

    const result = await service.assignTransactionToProperty({
      transaction,
      property,
      reviewItem,
    });

    expect(result.reviewItem).toMatchObject({
      resolvedProperty: property,
      needsAssignment: false,
      confidence: 1,
      suggestedProperties: [property],
      assignmentStatus: "assigned",
      reviewState: "reviewed",
    });

    expect(result.reviewItem).not.toBe(reviewItem);
    expect(Object.isFrozen(result.reviewItem)).toBe(true);
  });
});
