function propertyLabel(property) {
  return property.name || property.address || property.id;
}

function selectedIndexesFrom(selectedReviewItems) {
  return Object.entries(selectedReviewItems || {})
    .filter(([, selected]) => selected)
    .map(([index]) => Number(index));
}

function fallbackAssignedReviewItem(reviewItem, property) {
  return Object.freeze({
    ...reviewItem,
    resolvedProperty: property,
    needsAssignment: false,
    confidence: 1,
    assignmentStatus: "assigned",
    reviewState: "reviewed",
  });
}

function assignmentErrorStatus(message) {
  return Object.freeze({
    type: "error",
    message,
  });
}

export class TransactionReviewApplication {
  preparePropertyAssignment({
    reviewItem,
    index,
    properties = [],
    selectedProperties = {},
  } = {}) {
    const propertyId = selectedProperties[index];
    const property = properties.find((candidate) => candidate.id === propertyId);

    if (!property) {
      return Object.freeze({
        assignment: null,
        status: assignmentErrorStatus("Select a property first."),
        hasAssignment: false,
      });
    }

    return Object.freeze({
      assignment: Object.freeze({
        index,
        reviewItem,
        property,
      }),
      status: Object.freeze({
        type: "saving",
        message: "Assigning...",
      }),
      hasAssignment: true,
    });
  }

  prepareSelectedPropertyAssignments({
    reviews = [],
    properties = [],
    selectedProperties = {},
    selectedReviewItems = {},
  } = {}) {
    const selectedIndexes = selectedIndexesFrom(selectedReviewItems);
    const assignments = [];
    const statuses = {};

    selectedIndexes.forEach((index) => {
      const reviewItem = reviews[index];

      if (!reviewItem?.needsAssignment) {
        return;
      }

      const preparedAssignment = this.preparePropertyAssignment({
        reviewItem,
        index,
        properties,
        selectedProperties,
      });

      if (!preparedAssignment.hasAssignment) {
        statuses[index] = preparedAssignment.status;
        return;
      }

      assignments.push(preparedAssignment.assignment);
      statuses[index] = preparedAssignment.status;
    });

    return Object.freeze({
      assignments: Object.freeze([...assignments]),
      statuses: Object.freeze({ ...statuses }),
      hasAssignments: assignments.length > 0,
    });
  }

  buildAssignmentRequest({
    reviewItem,
    property,
    ownerId = null,
  } = {}) {
    return Object.freeze({
      transaction: reviewItem.transaction,
      property,
      ownerId,
      organizationId: property.organization_id ?? null,
      reviewItem,
    });
  }

  buildBulkAssignmentRequest({
    assignments = [],
    ownerId = null,
  } = {}) {
    return Object.freeze({
      assignments: Object.freeze(
        assignments.map(({ reviewItem, property }) =>
          this.buildAssignmentRequest({
            reviewItem,
            property,
            ownerId,
          })
        )
      ),
      ownerId,
    });
  }

  async assignProperty({
    fetcher = fetch,
    reviewItem,
    index,
    properties = [],
    selectedProperties = {},
    ownerId = null,
  } = {}) {
    const preparedAssignment = this.preparePropertyAssignment({
      reviewItem,
      index,
      properties,
      selectedProperties,
    });

    if (!preparedAssignment.hasAssignment) {
      return Object.freeze({
        statuses: Object.freeze({
          [index]: preparedAssignment.status,
        }),
        updatedByIndex: Object.freeze({}),
        completedSelections: Object.freeze({}),
        hasAssignment: false,
      });
    }

    const assignment = preparedAssignment.assignment;

    try {
      const response = await fetcher("/api/transactions/assign-property", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          this.buildAssignmentRequest({
            reviewItem: assignment.reviewItem,
            property: assignment.property,
            ownerId,
          })
        ),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to assign property.");
      }

      const updatedReviewItem =
        payload.reviewItem ||
        fallbackAssignedReviewItem(assignment.reviewItem, assignment.property);

      return Object.freeze({
        statuses: Object.freeze({
          [index]: this.createAssignmentSuccessStatus(assignment.property),
        }),
        updatedByIndex: Object.freeze({
          [index]: updatedReviewItem,
        }),
        completedSelections: Object.freeze({}),
        hasAssignment: true,
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to assign property.";

      return Object.freeze({
        statuses: Object.freeze({
          [index]: assignmentErrorStatus(message),
        }),
        updatedByIndex: Object.freeze({}),
        completedSelections: Object.freeze({}),
        hasAssignment: true,
      });
    }
  }

  async assignSelectedProperties({
    fetcher = fetch,
    reviews = [],
    properties = [],
    selectedProperties = {},
    selectedReviewItems = {},
    ownerId = null,
  } = {}) {
    const preparedAssignments = this.prepareSelectedPropertyAssignments({
      reviews,
      properties,
      selectedProperties,
      selectedReviewItems,
    });

    if (!preparedAssignments.hasAssignments) {
      return Object.freeze({
        statuses: preparedAssignments.statuses,
        updatedByIndex: Object.freeze({}),
        completedSelections: Object.freeze({}),
        hasAssignments: false,
      });
    }

    const assignments = preparedAssignments.assignments;

    try {
      const response = await fetcher("/api/transactions/assign-properties", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          this.buildBulkAssignmentRequest({
            assignments,
            ownerId,
          })
        ),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Unable to assign selected properties.");
      }

      return this.reconcileBulkAssignmentResponse({
        assignments,
        payload,
      });
    } catch (caughtError) {
      const message =
        caughtError instanceof Error
          ? caughtError.message
          : "Unable to assign selected properties.";

      return this.createBulkAssignmentFailureResult({
        assignments,
        message,
      });
    }
  }

  reconcileBulkAssignmentResponse({
    assignments = [],
    payload = {},
  } = {}) {
    const updatedByIndex = {};
    const statuses = {};
    const completedSelections = {};

    assignments.forEach(({ index, reviewItem, property }, assignmentIndex) => {
      const assignmentResult = payload.assignments?.[assignmentIndex];
      const updatedReviewItem =
        assignmentResult?.reviewItem ||
        fallbackAssignedReviewItem(reviewItem, property);

      updatedByIndex[index] = updatedReviewItem;
      completedSelections[index] = true;
      statuses[index] = this.createAssignmentSuccessStatus(property);
    });

    return Object.freeze({
      statuses: Object.freeze({ ...statuses }),
      updatedByIndex: Object.freeze({ ...updatedByIndex }),
      completedSelections: Object.freeze({ ...completedSelections }),
      hasAssignments: assignments.length > 0,
    });
  }

  createBulkAssignmentFailureResult({
    assignments = [],
    message = "Unable to assign selected properties.",
  } = {}) {
    const statuses = {};

    assignments.forEach(({ index }) => {
      statuses[index] = assignmentErrorStatus(message);
    });

    return Object.freeze({
      statuses: Object.freeze({ ...statuses }),
      updatedByIndex: Object.freeze({}),
      completedSelections: Object.freeze({}),
      hasAssignments: assignments.length > 0,
    });
  }

  createAssignmentSuccessStatus(property) {
    return Object.freeze({
      type: "success",
      message: `Assigned to ${propertyLabel(property)}.`,
    });
  }

  applyAssignmentResult({
    currentResult = null,
    selectedReviewItems = {},
    assignmentStatus = {},
    assignmentResult = {},
  } = {}) {
    const nextResult =
      currentResult?.transactionReview
        ? {
            ...currentResult,
            transactionReview: currentResult.transactionReview.map(
              (candidate, candidateIndex) =>
                assignmentResult.updatedByIndex?.[candidateIndex] || candidate
            ),
          }
        : currentResult;

    const nextSelectedReviewItems = { ...selectedReviewItems };

    Object.keys(assignmentResult.completedSelections || {}).forEach((index) => {
      delete nextSelectedReviewItems[index];
    });

    return Object.freeze({
      result: nextResult,
      selectedReviewItems: Object.freeze(nextSelectedReviewItems),
      assignmentStatus: Object.freeze({
        ...assignmentStatus,
        ...(assignmentResult.statuses || {}),
      }),
    });
  }
}
