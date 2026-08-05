function assertCollection(collection) {
  if (
    typeof collection !== "object" ||
    collection === null ||
    Array.isArray(collection)
  ) {
    throw new Error(
      "TransactionReviewReadModelAdapter requires a transaction review collection.",
    );
  }

  if (!Array.isArray(collection.items)) {
    throw new Error(
      "Transaction review collection requires items.",
    );
  }

  const requiredMetrics = [
    "needsReviewCount",
    "assignedCount",
    "reviewedCount",
    "ignoredCount",
    "completionPercentage",
  ];

  for (const metric of requiredMetrics) {
    if (typeof collection[metric] !== "number") {
      throw new Error(
        `Transaction review collection requires numeric ${metric}.`,
      );
    }
  }
}

function deepFreeze(value) {
  if (
    typeof value !== "object" ||
    value === null ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  Object.freeze(value);

  for (const nestedValue of Object.values(value)) {
    deepFreeze(nestedValue);
  }

  return value;
}

function averageConfidence(items) {
  if (items.length === 0) {
    return 0;
  }

  const total = items.reduce(
    (sum, item) =>
      sum + (
        typeof item?.confidence === "number"
          ? item.confidence
          : 0
      ),
    0,
  );

  return total / items.length;
}

export class TransactionReviewReadModelAdapter {
  buildQueue(collection) {
    assertCollection(collection);

    return deepFreeze({
      type: "transaction-review-queue",
      items: [...collection.items],
      metrics: {
        totalCount: collection.items.length,
        needsReviewCount: collection.needsReviewCount,
        assignedCount: collection.assignedCount,
        reviewedCount: collection.reviewedCount,
        ignoredCount: collection.ignoredCount,
        completionPercentage:
          collection.completionPercentage,
        averageConfidence:
          averageConfidence(collection.items),
      },
      metadata: {
        provider: "financial-events",
        projectionStatus: "repository-backed",
        source: "transaction-review-collection",
        phase: "2.3B",
      },
    });
  }
}

export const transactionReviewReadModelAdapter =
  new TransactionReviewReadModelAdapter();

Object.freeze(TransactionReviewReadModelAdapter);
