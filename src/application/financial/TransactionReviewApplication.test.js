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
});
