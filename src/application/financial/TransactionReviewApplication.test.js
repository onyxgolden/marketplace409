import { describe, expect, it } from "vitest";

import { TransactionReviewApplication } from "./TransactionReviewApplication";

function buildReviewItem(overrides = {}) {
  return {
    transaction: {
      id: "transaction-1",
      description: "Repair at 170 John",
    },
    needsAssignment: true,
    ...overrides,
  };
}

function buildProperty(overrides = {}) {
  return {
    id: "property-1",
    name: "170 John",
    organization_id: "organization-1",
    ...overrides,
  };
}

describe("TransactionReviewApplication", () => {
  it("prepares selected property assignments", () => {
    const application = new TransactionReviewApplication();
    const reviewItem = buildReviewItem();
    const property = buildProperty();

    const result = application.prepareSelectedPropertyAssignments({
      reviews: [reviewItem],
      properties: [property],
      selectedProperties: {
        0: "property-1",
      },
      selectedReviewItems: {
        0: true,
      },
    });

    expect(result.assignments).toEqual([
      {
        index: 0,
        reviewItem,
        property,
      },
    ]);

    expect(result.statuses).toEqual({
      0: {
        type: "saving",
        message: "Assigning...",
      },
    });

    expect(result.hasAssignments).toBe(true);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assignments)).toBe(true);
    expect(Object.isFrozen(result.statuses)).toBe(true);
  });

  it("returns validation status when a selected item has no property", () => {
    const application = new TransactionReviewApplication();

    const result = application.prepareSelectedPropertyAssignments({
      reviews: [buildReviewItem()],
      properties: [],
      selectedProperties: {},
      selectedReviewItems: {
        0: true,
      },
    });

    expect(result.assignments).toEqual([]);
    expect(result.statuses).toEqual({
      0: {
        type: "error",
        message: "Select a property first.",
      },
    });
    expect(result.hasAssignments).toBe(false);
  });

  it("ignores selected review items that no longer need assignment", () => {
    const application = new TransactionReviewApplication();

    const result = application.prepareSelectedPropertyAssignments({
      reviews: [
        buildReviewItem({
          needsAssignment: false,
        }),
      ],
      properties: [buildProperty()],
      selectedProperties: {
        0: "property-1",
      },
      selectedReviewItems: {
        0: true,
      },
    });

    expect(result.assignments).toEqual([]);
    expect(result.statuses).toEqual({});
    expect(result.hasAssignments).toBe(false);
  });

  it("builds a bulk assignment request payload", () => {
    const application = new TransactionReviewApplication();
    const reviewItem = buildReviewItem();
    const property = buildProperty();

    const result = application.buildBulkAssignmentRequest({
      assignments: [
        {
          index: 0,
          reviewItem,
          property,
        },
      ],
      ownerId: "owner-1",
    });

    expect(result).toEqual({
      assignments: [
        {
          transaction: reviewItem.transaction,
          property,
          ownerId: "owner-1",
          organizationId: "organization-1",
          reviewItem,
        },
      ],
      ownerId: "owner-1",
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.assignments)).toBe(true);
    expect(Object.isFrozen(result.assignments[0])).toBe(true);
  });

  it("creates assignment success status using the property label", () => {
    const application = new TransactionReviewApplication();

    expect(
      application.createAssignmentSuccessStatus({
        id: "property-1",
        name: "170 John",
      })
    ).toEqual({
      type: "success",
      message: "Assigned to 170 John.",
    });
  });
  it("assigns a single property through the assignment API", async () => {
    const application = new TransactionReviewApplication();
    const reviewItem = buildReviewItem();
    const property = buildProperty();
    const apiReviewItem = {
      ...reviewItem,
      resolvedProperty: property,
      needsAssignment: false,
    };

    const fetcher = async (url, options) => {
      expect(url).toBe("/api/transactions/assign-property");
      expect(options.method).toBe("POST");
      expect(JSON.parse(options.body)).toEqual({
        transaction: reviewItem.transaction,
        property,
        ownerId: "owner-1",
        organizationId: "organization-1",
        reviewItem,
      });

      return {
        ok: true,
        json: async () => ({
          success: true,
          reviewItem: apiReviewItem,
        }),
      };
    };

    const result = await application.assignProperty({
      fetcher,
      reviewItem,
      index: 0,
      properties: [property],
      selectedProperties: {
        0: "property-1",
      },
      ownerId: "owner-1",
    });

    expect(result.updatedByIndex).toEqual({
      0: apiReviewItem,
    });
    expect(result.statuses).toEqual({
      0: {
        type: "success",
        message: "Assigned to 170 John.",
      },
    });
  });

  it("creates fallback review item when single assignment response has no review item", async () => {
    const application = new TransactionReviewApplication();
    const reviewItem = buildReviewItem();
    const property = buildProperty();

    const result = await application.assignProperty({
      fetcher: async () => ({
        ok: true,
        json: async () => ({
          success: true,
        }),
      }),
      reviewItem,
      index: 0,
      properties: [property],
      selectedProperties: {
        0: "property-1",
      },
    });

    expect(result.updatedByIndex[0]).toEqual({
      ...reviewItem,
      resolvedProperty: property,
      needsAssignment: false,
      confidence: 1,
      assignmentStatus: "assigned",
      reviewState: "reviewed",
    });
  });

  it("reconciles bulk assignment API response", () => {
    const application = new TransactionReviewApplication();
    const reviewItem = buildReviewItem();
    const property = buildProperty();
    const apiReviewItem = {
      ...reviewItem,
      resolvedProperty: property,
      needsAssignment: false,
    };

    const result = application.reconcileBulkAssignmentResponse({
      assignments: [
        {
          index: 0,
          reviewItem,
          property,
        },
      ],
      payload: {
        assignments: [
          {
            reviewItem: apiReviewItem,
          },
        ],
      },
    });

    expect(result.updatedByIndex).toEqual({
      0: apiReviewItem,
    });
    expect(result.completedSelections).toEqual({
      0: true,
    });
    expect(result.statuses).toEqual({
      0: {
        type: "success",
        message: "Assigned to 170 John.",
      },
    });
  });

  it("creates bulk assignment failure statuses", () => {
    const application = new TransactionReviewApplication();

    const result = application.createBulkAssignmentFailureResult({
      assignments: [
        {
          index: 0,
        },
        {
          index: 2,
        },
      ],
      message: "API failed.",
    });

    expect(result.statuses).toEqual({
      0: {
        type: "error",
        message: "API failed.",
      },
      2: {
        type: "error",
        message: "API failed.",
      },
    });
  });
  it("applies assignment results to presentation state", () => {
    const application = new TransactionReviewApplication();
    const originalReviewItem = buildReviewItem();
    const updatedReviewItem = {
      ...originalReviewItem,
      needsAssignment: false,
    };

    const result = application.applyAssignmentResult({
      currentResult: {
        transactionReview: [originalReviewItem],
        records: [],
      },
      selectedReviewItems: {
        0: true,
        1: true,
      },
      assignmentStatus: {
        1: {
          type: "error",
          message: "Existing status.",
        },
      },
      assignmentResult: {
        updatedByIndex: {
          0: updatedReviewItem,
        },
        completedSelections: {
          0: true,
        },
        statuses: {
          0: {
            type: "success",
            message: "Assigned.",
          },
        },
      },
    });

    expect(result.result.transactionReview).toEqual([updatedReviewItem]);
    expect(result.selectedReviewItems).toEqual({
      1: true,
    });
    expect(result.assignmentStatus).toEqual({
      0: {
        type: "success",
        message: "Assigned.",
      },
      1: {
        type: "error",
        message: "Existing status.",
      },
    });

    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.selectedReviewItems)).toBe(true);
    expect(Object.isFrozen(result.assignmentStatus)).toBe(true);
  });
});
