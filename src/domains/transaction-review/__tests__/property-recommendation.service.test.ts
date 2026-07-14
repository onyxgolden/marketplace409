import { describe, expect, test } from "vitest";

import type { Property } from "../../property/property.types";
import type { Transaction } from "../../transaction/transaction.types";
import { PropertyRecommendationService } from "../property-recommendation.service";

function createTransaction(
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: "transaction-1",
    financialAccountId: "account-1",
    connectionId: "connection-1",
    provider: "test",
    providerTransactionId: "provider-transaction-1",
    providerAccountId: "provider-account-1",
    amountCents: 12500,
    currencyCode: "USD",
    date: "2026-07-13",
    description: "Plumbing repair at 4800 Kent Ave",
    merchantName: "Reliable Plumbing",
    category: ["repairs"],
    pending: false,
    raw: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    ...overrides,
  };
}

describe("PropertyRecommendationService", () => {
  test("ranks matching properties and returns immutable suggestions", () => {
    const properties: Property[] = [
      {
        id: "property-b",
        name: "Kent Avenue Duplex",
        address: "4800 Kent Ave",
      },
      {
        id: "property-a",
        name: "Oak Street House",
        address: "100 Oak Street",
      },
    ];

    const result = new PropertyRecommendationService().recommend({
      transaction: createTransaction(),
      properties,
    });

    expect(result.suggestedProperties).toEqual([properties[0]]);
    expect(result.confidence).toBe(1);
    expect(result.recommendations[0]).toMatchObject({
      property: properties[0],
      score: 1,
      explanation:
        "Transaction context contains the property address.",
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.recommendations)).toBe(true);
    expect(Object.isFrozen(result.suggestedProperties)).toBe(true);
  });

  test("uses property names and raw provider metadata", () => {
    const property: Property = {
      id: "property-1",
      name: "Maple Apartments",
    };

    const result = new PropertyRecommendationService().recommend({
      transaction: createTransaction({
        description: "Monthly landscaping",
        raw: {
          memo: "Maple Apartments landscaping",
        },
      }),
      properties: [property],
    });

    expect(result.suggestedProperties).toEqual([property]);
    expect(result.confidence).toBe(0.9);
  });

  test("returns no suggestions when transaction context does not match", () => {
    const result = new PropertyRecommendationService().recommend({
      transaction: createTransaction({
        description: "Office software subscription",
        merchantName: "Software Company",
      }),
      properties: [
        {
          id: "property-1",
          name: "Maple Apartments",
          address: "200 Maple Street",
        },
      ],
    });

    expect(result.recommendations).toEqual([]);
    expect(result.suggestedProperties).toEqual([]);
    expect(result.confidence).toBe(0);
  });

  test("limits and deterministically orders equal-scoring suggestions", () => {
    const properties: Property[] = [
      {
        id: "property-b",
        name: "Building B",
        city: "Springfield",
      },
      {
        id: "property-a",
        name: "Building A",
        city: "Springfield",
      },
    ];

    const result = new PropertyRecommendationService().recommend({
      transaction: createTransaction({
        description: "Utility bill Springfield",
      }),
      properties,
      limit: 1,
    });

    expect(result.suggestedProperties).toEqual([properties[1]]);
    expect(result.confidence).toBe(0.35);
  });
});
