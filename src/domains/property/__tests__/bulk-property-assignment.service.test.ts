import { describe, expect, it } from "vitest";
import { TransactionReviewItem } from "../../transaction-review";

import { BulkPropertyAssignmentService } from "../bulk-property-assignment.service";
import { InMemoryPropertyRuleRepository } from "../in-memory-property-rule.repository";
import { ManualPropertyAssignmentService } from "../manual-property-assignment.service";
import { PropertyRuleManagementService } from "../property-rule-management.service";
import type { Property } from "../property.types";

import type { Transaction } from "../../transaction";

function buildTransaction(
  id: string,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id,
    financialAccountId: "financial-account-1",
    connectionId: "connection-1",
    provider: "plaid",
    providerTransactionId: `provider-${id}`,
    providerAccountId: "provider-account-1",
    amountCents: 10000,
    currencyCode: "USD",
    date: "2026-07-01",
    description: `Repair ${id}`,
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

describe("BulkPropertyAssignmentService", () => {
  it("assigns multiple transactions to one property using the existing manual assignment service", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const manualAssignmentService = new ManualPropertyAssignmentService({
      ruleManagementService: new PropertyRuleManagementService(repository),
    });

    const service = new BulkPropertyAssignmentService({
      manualAssignmentService,
    });

    const property = buildProperty("170 John");

    const result = await service.assignTransactionsToProperty({
      assignments: [
        {
          transaction: buildTransaction("transaction-1"),
          property,
        },
        {
          transaction: buildTransaction("transaction-2"),
          property,
        },
      ],
      ownerId: "owner-1",
      organizationId: "organization-1",
    });

    expect(result.assignments).toHaveLength(2);
    expect(result.assignedCount).toBe(2);
    expect(result.failedCount).toBe(0);

    expect(result.assignments[0].property).toBe(property);
    expect(result.assignments[1].property).toBe(property);

    expect(result.assignments[0].rule.ownerId).toBe("owner-1");
    expect(result.assignments[1].rule.organizationId).toBe("organization-1");
  });

  it("returns updated reviewed assignment items for supplied review items", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const manualAssignmentService = new ManualPropertyAssignmentService({
      ruleManagementService: new PropertyRuleManagementService(repository),
    });

    const service = new BulkPropertyAssignmentService({
      manualAssignmentService,
    });

    const property = buildProperty("170 John");
    const transaction = buildTransaction("transaction-1");

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

    const result = await service.assignTransactionsToProperty({
      assignments: [
        {
          transaction,
          property,
          reviewItem,
        },
      ],
    });

    expect(result.assignments[0].reviewItem).toMatchObject({
      resolvedProperty: property,
      needsAssignment: false,
      confidence: 1,
      assignmentStatus: "assigned",
      reviewState: "reviewed",
    });

    expect(result.assignments[0].reviewItem).not.toBe(reviewItem);
  });

  it("rejects empty bulk assignments", async () => {
    const repository = new InMemoryPropertyRuleRepository();

    const manualAssignmentService = new ManualPropertyAssignmentService({
      ruleManagementService: new PropertyRuleManagementService(repository),
    });

    const service = new BulkPropertyAssignmentService({
      manualAssignmentService,
    });

    await expect(
      service.assignTransactionsToProperty({
        assignments: [],
      }),
    ).rejects.toThrow("Bulk property assignment requires at least one assignment.");
  });
});
