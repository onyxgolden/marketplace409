"use client";

import { useState } from "react";
import { TransactionReviewApplication } from "@/application";
import TransactionReviewWorkspace from "@/components/forge/TransactionReviewWorkspace";

export default function TransactionReviewContainer({
  reviews,
  properties,
  ownerId,
  initialSelectedProperties = {},
}) {
  const transactionReviewApplication =
    new TransactionReviewApplication();

  const [reviewItems, setReviewItems] = useState(reviews || []);
  const [
    selectedProperties,
    setSelectedProperties,
  ] = useState(
    initialSelectedProperties,
  );
  const [selectedReviewItems, setSelectedReviewItems] = useState({});
  const [assignmentStatus, setAssignmentStatus] = useState({});

  function applyAssignmentResult(assignmentResult) {
    const nextReviews = reviewItems.map(
      (candidate, candidateIndex) =>
        assignmentResult.updatedByIndex?.[candidateIndex] || candidate,
    );

    const nextSelectedReviewItems = {
      ...selectedReviewItems,
    };

    Object.keys(assignmentResult.completedSelections || {}).forEach(
      (index) => {
        delete nextSelectedReviewItems[index];
      },
    );

    setReviewItems(nextReviews);
    setSelectedReviewItems(nextSelectedReviewItems);
    setAssignmentStatus({
      ...assignmentStatus,
      ...(assignmentResult.statuses || {}),
    });
  }

  async function assignProperty(reviewItem, index) {
    const assignmentResult =
      await transactionReviewApplication.assignProperty({
        reviewItem,
        index,
        properties,
        selectedProperties,
        ownerId,
      });

    applyAssignmentResult(assignmentResult);
  }

  async function assignSelectedProperties() {
    const assignmentResult =
      await transactionReviewApplication.assignSelectedProperties({
        reviews: reviewItems,
        properties,
        selectedProperties,
        selectedReviewItems,
        ownerId,
      });

    applyAssignmentResult(assignmentResult);
  }

  return (
    <TransactionReviewWorkspace
      reviews={reviewItems}
      properties={properties}
      selectedProperties={selectedProperties}
      setSelectedProperties={setSelectedProperties}
      selectedReviewItems={selectedReviewItems}
      setSelectedReviewItems={setSelectedReviewItems}
      assignmentStatus={assignmentStatus}
      assignProperty={assignProperty}
      assignSelectedProperties={assignSelectedProperties}
    />
  );
}
