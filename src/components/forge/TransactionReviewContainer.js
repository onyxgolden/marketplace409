"use client";

import { useState } from "react";
import { TransactionReviewApplication } from "@/application";
import TransactionReviewWorkspace from "@/components/forge/TransactionReviewWorkspace";

export default function TransactionReviewContainer({
  reviews,
  properties,
  ownerId,
  result,
  setResult,
}) {
  const transactionReviewApplication =
    new TransactionReviewApplication();

  const [selectedProperties, setSelectedProperties] = useState({});
  const [selectedReviewItems, setSelectedReviewItems] = useState({});
  const [assignmentStatus, setAssignmentStatus] = useState({});

  function applyAssignmentResult(assignmentResult) {
    const nextState =
      transactionReviewApplication.applyAssignmentResult({
        currentResult: result,
        selectedReviewItems,
        assignmentStatus,
        assignmentResult,
      });

    setResult(nextState.result);
    setSelectedReviewItems(nextState.selectedReviewItems);
    setAssignmentStatus(nextState.assignmentStatus);
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
        reviews,
        properties,
        selectedProperties,
        selectedReviewItems,
        ownerId,
      });

    applyAssignmentResult(assignmentResult);
  }

  return (
    <TransactionReviewWorkspace
      reviews={reviews}
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
