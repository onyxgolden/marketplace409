function propertyLabel(property) {
  return property.name || property.address || property.id;
}

function selectedIndexesFrom(selectedReviewItems) {
  return Object.entries(selectedReviewItems || {})
    .filter(([, selected]) => selected)
    .map(([index]) => Number(index));
}

export class TransactionReviewApplication {
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
      const propertyId = selectedProperties[index];
      const property = properties.find((candidate) => candidate.id === propertyId);

      if (!reviewItem?.needsAssignment) {
        return;
      }

      if (!property) {
        statuses[index] = {
          type: "error",
          message: "Select a property first.",
        };
        return;
      }

      assignments.push({
        index,
        reviewItem,
        property,
      });

      statuses[index] = {
        type: "saving",
        message: "Assigning...",
      };
    });

    return Object.freeze({
      assignments: Object.freeze([...assignments]),
      statuses: Object.freeze({ ...statuses }),
      hasAssignments: assignments.length > 0,
    });
  }

  buildBulkAssignmentRequest({
    assignments = [],
    ownerId = null,
  } = {}) {
    return Object.freeze({
      assignments: Object.freeze(
        assignments.map(({ reviewItem, property }) =>
          Object.freeze({
            transaction: reviewItem.transaction,
            property,
            ownerId,
            organizationId: property.organization_id ?? null,
            reviewItem,
          })
        )
      ),
      ownerId,
    });
  }

  createAssignmentSuccessStatus(property) {
    return Object.freeze({
      type: "success",
      message: `Assigned to ${propertyLabel(property)}.`,
    });
  }
}
