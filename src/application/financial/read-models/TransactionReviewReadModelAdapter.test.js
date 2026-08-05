import {
  describe,
  expect,
  test,
} from "vitest";

import {
  TransactionReviewReadModelAdapter,
} from "./TransactionReviewReadModelAdapter.js";

function buildCollection(overrides = {}) {
  const items =
    overrides.items ||
    [
      Object.freeze({
        id: "review-1",
        confidence: 0.8,
      }),
      Object.freeze({
        id: "review-2",
        confidence: 0.6,
      }),
    ];

  return Object.freeze({
    items: Object.freeze(items),
    needsReviewCount:
      overrides.needsReviewCount ?? 1,
    assignedCount:
      overrides.assignedCount ?? 1,
    reviewedCount:
      overrides.reviewedCount ?? 1,
    ignoredCount:
      overrides.ignoredCount ?? 0,
    completionPercentage:
      overrides.completionPercentage ?? 0.5,
  });
}

describe("TransactionReviewReadModelAdapter", () => {
  test("requires a transaction review collection", () => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    expect(() => adapter.buildQueue(null)).toThrow(
      "TransactionReviewReadModelAdapter requires a transaction review collection.",
    );

    expect(() => adapter.buildQueue([])).toThrow(
      "TransactionReviewReadModelAdapter requires a transaction review collection.",
    );
  });

  test("requires collection items", () => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    expect(() =>
      adapter.buildQueue({
        needsReviewCount: 0,
        assignedCount: 0,
        reviewedCount: 0,
        ignoredCount: 0,
        completionPercentage: 0,
      }),
    ).toThrow(
      "Transaction review collection requires items.",
    );
  });

  test.each([
    "needsReviewCount",
    "assignedCount",
    "reviewedCount",
    "ignoredCount",
    "completionPercentage",
  ])("requires numeric %s", (metric) => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    const collection = {
      ...buildCollection(),
      [metric]: null,
    };

    expect(() =>
      adapter.buildQueue(collection),
    ).toThrow(
      `Transaction review collection requires numeric ${metric}.`,
    );
  });

  test("builds an immutable queue projection", () => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    const collection = buildCollection();

    const projection =
      adapter.buildQueue(collection);

    expect(projection).toEqual({
      type: "transaction-review-queue",
      items: collection.items,
      metrics: {
        totalCount: 2,
        needsReviewCount: 1,
        assignedCount: 1,
        reviewedCount: 1,
        ignoredCount: 0,
        completionPercentage: 0.5,
        averageConfidence: 0.7,
      },
      metadata: {
        provider: "financial-events",
        projectionStatus: "repository-backed",
        source: "transaction-review-collection",
        phase: "2.3B",
      },
    });

    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.items)).toBe(true);
    expect(Object.isFrozen(projection.metrics)).toBe(true);
    expect(Object.isFrozen(projection.metadata)).toBe(true);
  });

  test("preserves review item references", () => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    const collection = buildCollection();
    const projection =
      adapter.buildQueue(collection);

    expect(projection.items[0]).toBe(
      collection.items[0],
    );

    expect(projection.items[1]).toBe(
      collection.items[1],
    );
  });

  test("returns zero average confidence for an empty queue", () => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    const projection =
      adapter.buildQueue(
        buildCollection({
          items: [],
          needsReviewCount: 0,
          assignedCount: 0,
          reviewedCount: 0,
          ignoredCount: 0,
          completionPercentage: 0,
        }),
      );

    expect(projection.metrics).toEqual({
      totalCount: 0,
      needsReviewCount: 0,
      assignedCount: 0,
      reviewedCount: 0,
      ignoredCount: 0,
      completionPercentage: 0,
      averageConfidence: 0,
    });
  });

  test("treats missing item confidence as zero", () => {
    const adapter =
      new TransactionReviewReadModelAdapter();

    const projection =
      adapter.buildQueue(
        buildCollection({
          items: [
            Object.freeze({
              id: "review-1",
              confidence: 0.8,
            }),
            Object.freeze({
              id: "review-2",
            }),
          ],
        }),
      );

    expect(
      projection.metrics.averageConfidence,
    ).toBe(0.4);
  });
});
